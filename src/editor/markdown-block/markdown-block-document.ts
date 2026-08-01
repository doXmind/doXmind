import { Marked } from "marked";

import {
  isTopLevelFencedCodeSource,
  scanMarkdownSource,
} from "@/editor/markdown-block/markdown-source-scanner";
import { parseMarkdownToggle } from "@/editor/markdown-block/markdown-toggle";
import { parseMarkdownImageBlock } from "@/editor/markdown-block/markdown-image";
import { parsePageCollection } from "@/lib/page-collection";

export type MarkdownBlockKind =
  | "paragraph"
  | "heading"
  | "bullet_list_item"
  | "ordered_list_item"
  | "task_list_item"
  | "blockquote"
  | "callout"
  | "toggle"
  | "collection"
  | "image"
  | "thematic_break"
  | "table"
  | "block_math"
  | "mermaid"
  | "fenced_code"
  | "unsupported";

const nativeBlockLexer = new Marked({ gfm: true });

export interface MarkdownBlockView {
  id: string;
  kind: MarkdownBlockKind;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  depth?: number;
  from: number;
  to: number;
  raw: string;
  editable: boolean;
  checked?: boolean;
}

export interface MarkdownBlockSnapshot {
  revision: number;
  markdown: string;
  blocks: readonly MarkdownBlockView[];
}

export interface Utf16Range {
  from: number;
  to: number;
}

export type MarkdownSettableBlockKind =
  | "paragraph"
  | "heading"
  | "bullet_list_item"
  | "ordered_list_item"
  | "task_list_item"
  | "blockquote";

/**
 * Blocks whose source stays directly editable but whose internal structure is
 * not yet exposed to generic split, merge, or kind-conversion commands.
 */
export function isMarkdownSourceOnlyBlockKind(kind: MarkdownBlockKind): boolean {
  return (
    kind === "unsupported" ||
    kind === "fenced_code" ||
    kind === "callout" ||
    kind === "toggle" ||
    kind === "collection" ||
    kind === "image" ||
    kind === "thematic_break" ||
    kind === "table" ||
    kind === "block_math" ||
    kind === "mermaid"
  );
}

export type MarkdownBlockCommand =
  | {
      type: "replaceText";
      blockId: string;
      range: Utf16Range;
      text: string;
      /** Composition updates after the first one share one undo checkpoint. */
      recordHistory?: boolean;
    }
  | {
      type: "move";
      blockId: string;
      beforeId: string | null;
    }
  | {
      type: "moveBlocks";
      blockIds: readonly string[];
      beforeId: string | null;
    }
  | {
      type: "indentBlocks";
      blockIds: readonly string[];
    }
  | {
      type: "outdentBlocks";
      blockIds: readonly string[];
    }
  | {
      type: "split";
      blockId: string;
      at: number;
      to?: number;
    }
  | {
      type: "mergeBackward";
      blockId: string;
    }
  | {
      type: "duplicate";
      blockId: string;
    }
  | {
      type: "duplicateBlocks";
      blockIds: readonly string[];
    }
  | {
      type: "delete";
      blockId: string;
    }
  | {
      type: "deleteBlocks";
      blockIds: readonly string[];
    }
  | {
      type: "replaceBlocks";
      blockIds: readonly string[];
      markdown: string;
    }
  | {
      type: "setKind";
      blockId: string;
      kind: MarkdownSettableBlockKind;
      level?: 1 | 2 | 3 | 4 | 5 | 6;
    }
  | {
      type: "insertAfter";
      blockId: string;
      raw?: string;
      /** Insert above the anchor instead of below it (Notion's ⌥-click on the gutter `+`). */
      before?: boolean;
    }
  | {
      type: "setTaskChecked";
      blockId: string;
      checked: boolean;
    };

export interface MarkdownBlockApplyResult {
  snapshot: MarkdownBlockSnapshot;
  selection?: { blockId: string; anchor: number; head: number };
}

interface MarkdownBlockSpan {
  id: string;
  kind: MarkdownBlockKind;
  editable: boolean;
  depth?: number;
  from: number;
  to: number;
}

interface MarkdownBlockSource {
  id: string;
  kind: MarkdownBlockKind;
  raw: string;
  editable: boolean;
  depth?: number;
}

interface MarkdownBlockState {
  markdown: string;
  blocks: MarkdownBlockSpan[];
}

type ListItemBlockKind = "bullet_list_item" | "ordered_list_item" | "task_list_item";

interface ListItemSourceSyntax {
  kind: ListItemBlockKind;
  prefix: string;
  nextPrefix: string;
  nestingIndent: string;
  /** Leading indentation in characters, for slicing source. */
  indent: number;
  /** Leading indentation in Markdown columns, for measuring nesting against a parent. */
  indentColumns: number;
  /** Column where this item's content starts — the column a child item nests against. */
  contentIndent: number;
  contentFrom: number;
  checked?: boolean;
  checkboxOffset?: number;
}

interface BlockquoteSourceSyntax {
  prefix: string;
  contentFrom: number;
}

/**
 * Source-backed Page model for block editing.
 *
 * Markdown is the only mutable state. Blocks are a session-local projection;
 * their ids never cross the storage boundary.
 */
export class MarkdownBlockDocument {
  /**
   * How many states the undo and redo stacks hold. Each entry keeps a whole Markdown string, so an
   * unbounded stack grows with the Page for as long as the session lives.
   */
  private static readonly HISTORY_LIMIT = 200;

  private revision = 0;
  private markdown: string;
  private blocks: MarkdownBlockSpan[];
  private nextBlockNumber: number;
  private undoStack: MarkdownBlockState[] = [];
  private redoStack: MarkdownBlockState[] = [];
  /**
   * End of the last typed edit, used to fold a typing run into one history entry.
   *
   * Without this every keystroke was its own undo step, so Mod+Z walked back one character at a
   * time and felt broken. Deliberately keyed on position rather than on a clock: a run continues
   * only while the next edit starts exactly where the previous one ended, which is deterministic
   * and needs no timer to reason about or to test.
   */
  private lastTypedEdit: { blockId: string; sourceEnd: number } | null = null;

  private constructor(markdown: string, blocks: MarkdownBlockSpan[], nextBlockNumber: number) {
    this.markdown = markdown;
    this.blocks = blocks;
    this.nextBlockNumber = nextBlockNumber;
  }

  static fromMarkdown(markdown: string): MarkdownBlockDocument {
    const sources = scanMarkdownSource(markdown);
    const sourceBlocks: MarkdownBlockSource[] = [];
    let nextId = 1;

    for (const source of sources) {
      sourceBlocks.push(blockFromSource(source.raw, `block-${nextId}`, source.listDepth));
      nextId += 1;
    }

    if (sourceBlocks.length === 0) {
      sourceBlocks.push({ id: "block-1", kind: "paragraph", raw: "", editable: true });
      nextId = 2;
    }
    return new MarkdownBlockDocument(markdown, spansFromSources(sourceBlocks), nextId);
  }

  getSnapshot(): MarkdownBlockSnapshot {
    const blocks = this.blocks.map((block) => blockViewFromSpan(this.markdown, block));
    return {
      revision: this.revision,
      markdown: this.markdown,
      blocks,
    };
  }

  /**
   * End the current typing run, so the next keystroke starts a fresh undo entry.
   *
   * The caller owns the events a position test cannot see: moving to another Block, finishing an IME
   * composition, blurring the editor, or simply pausing.
   */
  flushHistory(): void {
    this.lastTypedEdit = null;
  }

  undo(): MarkdownBlockSnapshot {
    this.lastTypedEdit = null;
    const previous = this.undoStack.pop();
    if (!previous) return this.getSnapshot();
    this.pushRedo(this.cloneState());
    this.restoreState(previous);
    this.revision += 1;
    return this.getSnapshot();
  }

  redo(): MarkdownBlockSnapshot {
    this.lastTypedEdit = null;
    const next = this.redoStack.pop();
    if (!next) return this.getSnapshot();
    this.pushUndo(this.cloneState());
    this.restoreState(next);
    this.revision += 1;
    return this.getSnapshot();
  }

  apply(command: MarkdownBlockCommand): MarkdownBlockApplyResult {
    // Only typing can extend a run. Every structural command is its own undo step, so a split, a
    // move or an indent can never be swallowed into the keystrokes around it.
    if (command.type !== "replaceText") this.lastTypedEdit = null;
    if (command.type === "outdentBlocks") {
      if (command.blockIds.length === 0) return { snapshot: this.getSnapshot() };
      const sourceBlocks = this.sourceBlocks();
      const { firstIndex, length } = contiguousBlockRange(
        sourceBlocks,
        command.blockIds,
        command.type
      );
      const selected = sourceBlocks.slice(firstIndex, firstIndex + length);
      if (selected.some((block) => listItemFamily(block.kind) === null)) {
        throw new Error("outdentBlocks only supports list and task Blocks");
      }
      const firstDepth = selected[0].depth ?? 0;
      if (firstDepth === 0) throw new Error("a top-level list Block cannot be outdented");

      let parentIndex = firstIndex - 1;
      while (parentIndex >= 0) {
        const candidate = sourceBlocks[parentIndex];
        if (listItemFamily(candidate.kind) === null) break;
        if ((candidate.depth ?? 0) === firstDepth - 1) break;
        parentIndex -= 1;
      }
      const parent = sourceBlocks[parentIndex];
      const firstSyntax = listItemSyntax(selected[0].raw, true);
      const parentSyntax = parent ? listItemSyntax(parent.raw, true) : null;
      if (!parent || !firstSyntax || !parentSyntax) {
        throw new Error("outdentBlocks requires a source-backed list parent");
      }
      const indentationWidth = firstSyntax.indent - parentSyntax.indent;
      if (indentationWidth <= 0) {
        throw new Error("outdentBlocks cannot determine a safe source indentation");
      }

      let endIndex = firstIndex + length;
      const selectedRootDepth = Math.min(...selected.map((block) => block.depth ?? 0));
      while (
        endIndex < sourceBlocks.length &&
        listItemFamily(sourceBlocks[endIndex].kind) !== null &&
        (sourceBlocks[endIndex].depth ?? 0) > selectedRootDepth
      ) {
        endIndex += 1;
      }
      const outdented = sourceBlocks
        .slice(firstIndex, endIndex)
        .map((candidate) => outdentSourceLines(candidate.raw, indentationWidth));
      if (outdented.some((raw) => raw === null)) {
        throw new Error("outdentBlocks cannot preserve a continuation line safely");
      }

      this.recordHistory();
      for (let blockIndex = firstIndex; blockIndex < endIndex; blockIndex += 1) {
        const candidate = sourceBlocks[blockIndex];
        sourceBlocks[blockIndex] = {
          ...candidate,
          raw: outdented[blockIndex - firstIndex] as string,
          depth: (candidate.depth ?? 0) - 1,
        };
      }
      this.commitSources(sourceBlocks);
      this.revision += 1;
      return {
        snapshot: this.getSnapshot(),
        selection: { blockId: selected[0].id, anchor: 0, head: 0 },
      };
    }

    if (command.type === "indentBlocks") {
      if (command.blockIds.length === 0) return { snapshot: this.getSnapshot() };
      const sourceBlocks = this.sourceBlocks();
      const { firstIndex, length } = contiguousBlockRange(
        sourceBlocks,
        command.blockIds,
        command.type
      );
      const selected = sourceBlocks.slice(firstIndex, firstIndex + length);
      if (selected.some((block) => listItemFamily(block.kind) === null)) {
        throw new Error("indentBlocks only supports list and task Blocks");
      }
      const firstDepth = selected[0].depth ?? 0;
      let parentIndex = firstIndex - 1;
      while (parentIndex >= 0) {
        const candidate = sourceBlocks[parentIndex];
        if (listItemFamily(candidate.kind) === null) break;
        const candidateDepth = candidate.depth ?? 0;
        if (candidateDepth === firstDepth) break;
        if (candidateDepth < firstDepth) {
          parentIndex = -1;
          break;
        }
        parentIndex -= 1;
      }
      const parent = sourceBlocks[parentIndex];
      if (!parent || (parent.depth ?? 0) !== firstDepth) {
        throw new Error("indentBlocks requires a previous sibling");
      }
      const parentSyntax = listItemSyntax(parent.raw, true);
      if (!parentSyntax) throw new Error("indentBlocks requires a source-backed list sibling");
      const nestingIndent = nestingIndentInto(
        parentSyntax,
        listItemSyntax(selected[0].raw, true) ?? parentSyntax
      );

      let endIndex = firstIndex + length;
      const selectedRootDepth = Math.min(...selected.map((block) => block.depth ?? 0));
      while (
        endIndex < sourceBlocks.length &&
        listItemFamily(sourceBlocks[endIndex].kind) !== null &&
        (sourceBlocks[endIndex].depth ?? 0) > selectedRootDepth
      ) {
        endIndex += 1;
      }

      this.recordHistory();
      for (let blockIndex = firstIndex; blockIndex < endIndex; blockIndex += 1) {
        const candidate = sourceBlocks[blockIndex];
        sourceBlocks[blockIndex] = {
          ...candidate,
          raw: indentSourceLines(candidate.raw, nestingIndent),
          depth: (candidate.depth ?? 0) + 1,
        };
      }
      this.commitSources(sourceBlocks);
      this.revision += 1;
      return {
        snapshot: this.getSnapshot(),
        selection: { blockId: selected[0].id, anchor: 0, head: 0 },
      };
    }

    if (command.type === "moveBlocks") {
      if (command.blockIds.length === 0) return { snapshot: this.getSnapshot() };
      const sourceBlocks = this.sourceBlocks();
      const { firstIndex, length } = contiguousBlockRange(
        sourceBlocks,
        command.blockIds,
        command.type
      );
      assertListDescendantsSelected(sourceBlocks, firstIndex, length, command.type);
      const targetIndex =
        command.beforeId === null
          ? sourceBlocks.length
          : sourceBlocks.findIndex((block) => block.id === command.beforeId);
      if (targetIndex < 0) throw new Error(`unknown before block: ${command.beforeId}`);

      const lastIndex = firstIndex + length - 1;
      if (
        (command.beforeId !== null && targetIndex >= firstIndex && targetIndex <= lastIndex) ||
        targetIndex === lastIndex + 1 ||
        (command.beforeId === null && lastIndex === sourceBlocks.length - 1)
      ) {
        return { snapshot: this.getSnapshot() };
      }

      const reordered = [...sourceBlocks];
      const selected = reordered.splice(firstIndex, length);
      if (firstIndex > 0 && firstIndex < reordered.length) {
        reordered[firstIndex - 1] = ensureMovedBlockBoundary(
          reordered[firstIndex - 1],
          reordered[firstIndex],
          listLoosenessAt(sourceBlocks, reordered[firstIndex - 1].id),
          preferredLineEnding(
            reordered[firstIndex - 1].raw,
            reordered[firstIndex].raw,
            this.markdown
          )
        );
      }
      const beforeIndex =
        command.beforeId === null
          ? reordered.length
          : reordered.findIndex((block) => block.id === command.beforeId);
      if (beforeIndex < 0) throw new Error(`unknown before block: ${command.beforeId}`);

      const normalized = normalizeMovedListIndent(reordered, beforeIndex, selected);
      // Committing the un-shifted range would write the very indentation the shift exists to avoid,
      // so an unverifiable drop is refused outright rather than landed as source.
      if (normalized === null) return { snapshot: this.getSnapshot() };
      reordered.splice(beforeIndex, 0, ...normalized);
      for (const boundaryIndex of [beforeIndex - 1, beforeIndex + selected.length - 1]) {
        if (boundaryIndex < 0 || boundaryIndex >= reordered.length - 1) continue;
        // Looseness belongs to the list, not to the Block that arrived in it, so it is read from
        // whichever side of this junction was already there before anything moved.
        const stationary =
          boundaryIndex < beforeIndex ? reordered[boundaryIndex] : reordered[boundaryIndex + 1];
        reordered[boundaryIndex] = ensureMovedBlockBoundary(
          reordered[boundaryIndex],
          reordered[boundaryIndex + 1],
          listLoosenessAt(sourceBlocks, stationary.id),
          preferredLineEnding(
            reordered[boundaryIndex].raw,
            reordered[boundaryIndex + 1].raw,
            this.markdown
          )
        );
      }
      // Fail closed: a reorder that would reinterpret a Block it never touched keeps the old bytes.
      const movedIds = new Set(selected.map((block) => block.id));
      if (!moveKeepsBystandersIntact(reordered, sourceBlocks, movedIds)) {
        return { snapshot: this.getSnapshot() };
      }
      this.recordHistory();
      this.commitSources(reordered);
      this.revision += 1;
      return {
        snapshot: this.getSnapshot(),
        selection: { blockId: selected[0].id, anchor: 0, head: 0 },
      };
    }

    if (command.type === "duplicateBlocks") {
      if (command.blockIds.length === 0) return { snapshot: this.getSnapshot() };
      const sourceBlocks = this.sourceBlocks();
      const { firstIndex, length: requestedLength } = contiguousBlockRange(
        sourceBlocks,
        command.blockIds,
        command.type
      );
      const length = listDescendantRangeEnd(sourceBlocks, firstIndex, requestedLength) - firstIndex;
      const selected = sourceBlocks.slice(firstIndex, firstIndex + length);
      this.recordHistory();
      const duplicates = selected.map((block) => {
        const duplicate = { ...block, id: `block-${this.nextBlockNumber}` };
        this.nextBlockNumber += 1;
        return duplicate;
      });
      const lastIndex = firstIndex + selected.length - 1;
      sourceBlocks[lastIndex] = ensureDuplicateInsertionBoundary(
        sourceBlocks[lastIndex],
        duplicates[0],
        sourceBlocks[lastIndex + 1],
        preferredLineEnding(sourceBlocks[lastIndex].raw, duplicates[0].raw, this.markdown)
      );
      sourceBlocks.splice(lastIndex + 1, 0, ...duplicates);
      this.commitSources(sourceBlocks);
      this.revision += 1;
      return {
        snapshot: this.getSnapshot(),
        selection: { blockId: duplicates[0].id, anchor: 0, head: 0 },
      };
    }

    if (command.type === "deleteBlocks") {
      if (command.blockIds.length === 0) return { snapshot: this.getSnapshot() };
      const sourceBlocks = this.sourceBlocks();
      const { firstIndex, length: requestedLength } = contiguousBlockRange(
        sourceBlocks,
        command.blockIds,
        command.type
      );
      const length = listDescendantRangeEnd(sourceBlocks, firstIndex, requestedLength) - firstIndex;
      const selected = sourceBlocks.slice(firstIndex, firstIndex + length);
      this.recordHistory();
      if (selected.length === sourceBlocks.length) {
        const empty = {
          ...selected[0],
          kind: "paragraph" as const,
          raw: "",
          editable: true,
        };
        this.commitSources([empty]);
        this.revision += 1;
        return {
          snapshot: this.getSnapshot(),
          selection: { blockId: empty.id, anchor: 0, head: 0 },
        };
      }

      sourceBlocks.splice(firstIndex, selected.length);
      if (firstIndex > 0 && firstIndex < sourceBlocks.length) {
        sourceBlocks[firstIndex - 1] = ensureDeletionBoundary(
          sourceBlocks[firstIndex - 1],
          sourceBlocks[firstIndex],
          preferredLineEnding(
            sourceBlocks[firstIndex - 1].raw,
            sourceBlocks[firstIndex].raw,
            this.markdown
          )
        );
      }
      this.commitSources(sourceBlocks);
      this.revision += 1;
      const focus = sourceBlocks[Math.min(firstIndex, sourceBlocks.length - 1)];
      return {
        snapshot: this.getSnapshot(),
        selection: { blockId: focus.id, anchor: 0, head: 0 },
      };
    }

    if (command.type === "replaceBlocks") {
      if (command.blockIds.length === 0 || command.markdown.length === 0) {
        return { snapshot: this.getSnapshot() };
      }
      const sourceBlocks = this.sourceBlocks();
      const { firstIndex, length: requestedLength } = contiguousBlockRange(
        sourceBlocks,
        command.blockIds,
        command.type
      );
      const length = listDescendantRangeEnd(sourceBlocks, firstIndex, requestedLength) - firstIndex;
      const replacementSpans = scanMarkdownSource(command.markdown);
      if (replacementSpans.length === 0) return { snapshot: this.getSnapshot() };

      const replacements = replacementSpans.map((span, replacementIndex) => {
        const id =
          replacementIndex === 0 ? sourceBlocks[firstIndex].id : `block-${this.nextBlockNumber++}`;
        return blockFromSource(span.raw, id, span.listDepth);
      });
      const newline = preferredLineEnding(
        command.markdown,
        sourceBlocks[firstIndex - 1]?.raw ?? "",
        sourceBlocks[firstIndex + length]?.raw ?? "",
        this.markdown
      );
      const previous = sourceBlocks[firstIndex - 1];
      const following = sourceBlocks[firstIndex + length];
      if (previous) {
        sourceBlocks[firstIndex - 1] = ensureDeletionBoundary(previous, replacements[0], newline);
      }
      if (following) {
        const lastReplacementIndex = replacements.length - 1;
        replacements[lastReplacementIndex] = ensureDeletionBoundary(
          replacements[lastReplacementIndex],
          following,
          newline
        );
      }

      this.recordHistory();
      sourceBlocks.splice(firstIndex, length, ...replacements);
      this.commitSources(sourceBlocks);
      this.revision += 1;
      const focus = replacements.at(-1) as MarkdownBlockSource;
      const cursor = splitBlockSource(focus.raw).content.length;
      return {
        snapshot: this.getSnapshot(),
        selection: { blockId: focus.id, anchor: cursor, head: cursor },
      };
    }

    const index = this.blocks.findIndex((block) => block.id === command.blockId);
    if (index < 0) throw new Error(`unknown block: ${command.blockId}`);

    const sourceBlocks = this.sourceBlocks();
    const block = sourceBlocks[index];
    if (!block.editable && (command.type === "replaceText" || command.type === "split")) {
      throw new Error("unsupported blocks cannot be edited as text");
    }
    if (block.kind === "unsupported" && command.type === "split") {
      throw new Error("raw blocks cannot be split structurally");
    }
    if (block.kind === "unsupported" && command.type === "mergeBackward") {
      throw new Error("raw blocks cannot be merged structurally");
    }
    if (
      command.type === "split" &&
      block.kind !== "unsupported" &&
      isMarkdownSourceOnlyBlockKind(block.kind)
    ) {
      throw new Error(`${block.kind} blocks cannot be split structurally`);
    }
    if (command.type === "setTaskChecked") {
      const task = listItemSyntax(block.raw, block.depth !== undefined);
      if (task?.kind !== "task_list_item" || task.checkboxOffset === undefined) {
        throw new Error("only task list items have a checkbox");
      }
      const current = block.raw[task.checkboxOffset].toLowerCase() === "x";
      if (current === command.checked) return { snapshot: this.getSnapshot() };
      this.recordHistory();
      sourceBlocks[index] = {
        ...block,
        raw:
          block.raw.slice(0, task.checkboxOffset) +
          (command.checked ? "x" : " ") +
          block.raw.slice(task.checkboxOffset + 1),
      };
      this.commitSources(sourceBlocks);
      this.revision += 1;
      return { snapshot: this.getSnapshot() };
    }
    if (command.type === "move") {
      if (listItemFamily(block.kind) !== null) {
        const blockDepth = block.depth ?? 0;
        let subtreeEndIndex = index + 1;
        while (
          subtreeEndIndex < sourceBlocks.length &&
          listItemFamily(sourceBlocks[subtreeEndIndex].kind) !== null &&
          (sourceBlocks[subtreeEndIndex].depth ?? 0) > blockDepth
        ) {
          subtreeEndIndex += 1;
        }
        if (subtreeEndIndex > index + 1) {
          return this.apply({
            type: "moveBlocks",
            blockIds: sourceBlocks.slice(index, subtreeEndIndex).map((candidate) => candidate.id),
            beforeId: command.beforeId,
          });
        }
      }
      const targetIndex =
        command.beforeId === null
          ? sourceBlocks.length
          : sourceBlocks.findIndex((candidate) => candidate.id === command.beforeId);
      if (targetIndex < 0) throw new Error(`unknown before block: ${command.beforeId}`);
      if (
        command.beforeId === block.id ||
        (command.beforeId === null && index === sourceBlocks.length - 1) ||
        targetIndex === index + 1
      ) {
        return { snapshot: this.getSnapshot() };
      }

      const reordered = [...sourceBlocks];
      reordered.splice(index, 1);
      const removalBoundaryIndex = index - 1;
      if (removalBoundaryIndex >= 0 && removalBoundaryIndex < reordered.length - 1) {
        reordered[removalBoundaryIndex] = ensureBlockBoundary(
          reordered[removalBoundaryIndex],
          reordered[removalBoundaryIndex + 1],
          preferredLineEnding(
            reordered[removalBoundaryIndex].raw,
            reordered[removalBoundaryIndex + 1].raw,
            this.markdown
          )
        );
      }
      const beforeIndex =
        command.beforeId === null
          ? reordered.length
          : reordered.findIndex((candidate) => candidate.id === command.beforeId);
      if (beforeIndex < 0) throw new Error(`unknown before block: ${command.beforeId}`);
      this.recordHistory();
      reordered.splice(beforeIndex, 0, block);
      // Only the two boundaries touching the insertion point are new. Do not
      // normalize unrelated blocks merely because one block moved.
      for (const boundaryIndex of [beforeIndex - 1, beforeIndex]) {
        if (boundaryIndex >= 0 && boundaryIndex < reordered.length - 1) {
          reordered[boundaryIndex] = ensureBlockBoundary(
            reordered[boundaryIndex],
            reordered[boundaryIndex + 1],
            preferredLineEnding(
              reordered[boundaryIndex].raw,
              reordered[boundaryIndex + 1].raw,
              this.markdown
            )
          );
        }
      }
      this.commitSources(reordered);
      this.revision += 1;
      return { snapshot: this.getSnapshot() };
    }

    if (command.type === "split") {
      const { content, separator } = splitBlockSource(block.raw);
      if (command.at < 0 || (command.to ?? command.at) < command.at) {
        throw new RangeError("split position is outside the block");
      }
      const listItem = listItemSyntax(block.raw, block.depth !== undefined);
      // A caret can legitimately sit before a Block's source marker: the marker is hidden
      // from the visible projection, so visible offset 0 maps to source offset 0. Clamp into
      // the content region instead of rejecting the split.
      const contentFloor = listItem?.contentFrom ?? blockquoteSyntax(block.raw)?.contentFrom ?? 0;
      const at = Math.min(Math.max(command.at, contentFloor), content.length);
      const splitTo = Math.min(Math.max(command.to ?? command.at, at), content.length);
      if (
        listItem &&
        content.slice(listItem.contentFrom).length === 0 &&
        at === listItem.contentFrom &&
        splitTo === listItem.contentFrom
      ) {
        this.recordHistory();
        sourceBlocks[index] = {
          ...block,
          kind: "paragraph",
          raw: separator,
          editable: true,
        };
        normalizeNeighborBoundaries(sourceBlocks, index, this.markdown);
        this.commitSources(sourceBlocks);
        this.revision += 1;
        return {
          snapshot: this.getSnapshot(),
          selection: { blockId: block.id, anchor: 0, head: 0 },
        };
      }
      const blockquote = blockquoteSyntax(block.raw);
      if (blockquote && at < content.length) {
        this.recordHistory();
        const newline = preferredLineEnding(block.raw, this.markdown);
        const inserted = newline + blockquote.prefix;
        sourceBlocks[index] = blockFromSource(
          content.slice(0, at) + inserted + content.slice(splitTo) + separator,
          block.id
        );
        this.commitSources(sourceBlocks);
        this.revision += 1;
        const cursor = at + inserted.length;
        return {
          snapshot: this.getSnapshot(),
          selection: { blockId: block.id, anchor: cursor, head: cursor },
        };
      }
      this.recordHistory();
      const leftContent = content.slice(0, at);
      const rightContent = content.slice(splitTo);
      // Dividing a heading has to leave two headings. Only a list item carried its marker across, so
      // the tail of a heading arrived as bare text and reclassified itself as a paragraph — splitting
      // "## Heading two" in the middle silently demoted the half the caret moved into.
      //
      // Deliberately not applied when the tail is empty: Enter at the END of a heading should start
      // an ordinary paragraph, which is the authoring flow both reference products have, and which
      // this already did correctly. Nor when the caret sits inside the `##` marker itself, where
      // there is no body to carry.
      const headingMarker =
        block.kind === "heading" ? (/^#{1,6}[ \t]+/.exec(content)?.[0] ?? "") : "";
      const carriesHeading =
        headingMarker.length > 0 && at >= headingMarker.length && rightContent.trim().length > 0;
      const rightRaw = listItem
        ? listItem.nextPrefix + rightContent
        : carriesHeading
          ? headingMarker + rightContent
          : rightContent;
      const newline = preferredLineEnding(block.raw, this.markdown);
      // Enter at the very end makes a Block with nothing but line endings in it. No scan can produce
      // such a Block, so it dies on the next reload while its blank lines stay — and because the
      // anchor's whole separator was carried onto both halves, every press left two more of them
      // behind, without bound. Cap what the contentless half carries at the boundary it needs, so a
      // repeated press settles instead of accumulating. Anything shorter is left exactly as it is.
      const separatorLimit = index + 1 < sourceBlocks.length ? 2 : 1;
      const rightSeparator =
        rightRaw.length > 0 || countLineEndings(separator) <= separatorLimit
          ? separator
          : newline.repeat(separatorLimit);
      let left = reclassifyEditableSource(block, leftContent);
      const right = blockFromSource(
        rightRaw + rightSeparator,
        `block-${this.nextBlockNumber}`,
        listItem ? block.depth : undefined
      );
      this.nextBlockNumber += 1;
      left = ensureBlockBoundary(left, right, newline);
      sourceBlocks.splice(index, 1, left, right);
      this.commitSources(sourceBlocks);
      this.revision += 1;
      return {
        snapshot: this.getSnapshot(),
        selection: {
          blockId: right.id,
          anchor: listItem?.nextPrefix.length ?? 0,
          head: listItem?.nextPrefix.length ?? 0,
        },
      };
    }

    if (command.type === "mergeBackward") {
      const currentListItem = listItemSyntax(block.raw, block.depth !== undefined);
      const previousBlock = index > 0 ? sourceBlocks[index - 1] : null;
      const unwrapCurrent =
        block.kind === "blockquote" ||
        (currentListItem !== null &&
          (previousBlock === null ||
            listItemFamily(previousBlock.kind) !== listItemFamily(block.kind)));
      if (unwrapCurrent) {
        const subtreeEndIndex = listDescendantRangeEnd(sourceBlocks, index, 1);
        const { content, separator } = splitBlockSource(block.raw);
        sourceBlocks[index] = blockFromSource(
          plainBlockContent(block, content) + separator,
          block.id
        );
        normalizeNeighborBoundaries(sourceBlocks, index, this.markdown);
        // Losing the marker also loses the column the children nested against: children indented
        // four columns read back as an indented code block once the blank line lands in front of
        // them, so they stop being list items on disk while the live view still shows them.
        // `setKind` refuses the same intent; a keystroke goes inert rather than throwing.
        if (!listDescendantsSurviveSource(sourceBlocks, index, subtreeEndIndex)) {
          return { snapshot: this.getSnapshot() };
        }
        this.recordHistory();
        this.commitSources(sourceBlocks);
        this.revision += 1;
        return {
          snapshot: this.getSnapshot(),
          selection: { blockId: block.id, anchor: 0, head: 0 },
        };
      }
      if (index === 0) return { snapshot: this.getSnapshot() };
      const previous = sourceBlocks[index - 1];
      if (
        !previous.editable ||
        !block.editable ||
        isMarkdownSourceOnlyBlockKind(previous.kind) ||
        isMarkdownSourceOnlyBlockKind(block.kind) ||
        // Text joined onto a setext heading lands on the underline and stops it being one, so the
        // heading above would quietly dissolve into a paragraph.
        isSetextHeadingBlock(previous)
      ) {
        // Backspace at the start of a Block whose neighbour has no text representation is a
        // no-op, not an error: a divider, image, table or diagram cannot absorb text. Returning
        // the snapshot unchanged keeps the keystroke inert instead of throwing out of a key
        // handler and tearing down the editing surface.
        return { snapshot: this.getSnapshot() };
      }
      this.recordHistory();
      const previousParts = splitBlockSource(previous.raw);
      const currentParts = splitBlockSource(block.raw);
      const cursor = previousParts.content.length;
      // What joins the previous Block is this one's *text*, never its Markdown marker. Slicing at
      // `contentFrom` only knew how to drop a list marker, so backspacing at the start of a heading
      // merged the literal `## ` into the paragraph above it: "Alpha" and "## Heading" became
      // "Alpha## Heading" on disk. `plainBlockContent` is the function that already answers this for
      // every kind, and is what the unwrap branch above uses.
      const merged = reclassifyEditableSource(
        previous,
        previousParts.content +
          plainBlockContent(block, currentParts.content) +
          currentParts.separator
      );
      sourceBlocks.splice(index - 1, 2, merged);
      this.commitSources(sourceBlocks);
      this.revision += 1;
      return {
        snapshot: this.getSnapshot(),
        selection: { blockId: previous.id, anchor: cursor, head: cursor },
      };
    }

    if (command.type === "duplicate") {
      return this.apply({ type: "duplicateBlocks", blockIds: [block.id] });
    }

    if (command.type === "delete") {
      if (listItemFamily(block.kind) !== null) {
        return this.apply({ type: "deleteBlocks", blockIds: [block.id] });
      }
      this.recordHistory();
      if (sourceBlocks.length === 1) {
        sourceBlocks[0] = { ...block, kind: "paragraph", raw: "", editable: true };
        this.commitSources(sourceBlocks);
        this.revision += 1;
        return {
          snapshot: this.getSnapshot(),
          selection: { blockId: block.id, anchor: 0, head: 0 },
        };
      }
      sourceBlocks.splice(index, 1);
      if (index > 0 && index < sourceBlocks.length) {
        sourceBlocks[index - 1] = ensureBlockBoundary(
          sourceBlocks[index - 1],
          sourceBlocks[index],
          preferredLineEnding(sourceBlocks[index - 1].raw, sourceBlocks[index].raw, this.markdown)
        );
      }
      this.commitSources(sourceBlocks);
      this.revision += 1;
      const focus = sourceBlocks[Math.min(index, sourceBlocks.length - 1)];
      return {
        snapshot: this.getSnapshot(),
        selection: { blockId: focus.id, anchor: 0, head: 0 },
      };
    }

    if (command.type === "setKind") {
      if (!block.editable) throw new Error("unsupported blocks cannot change kind");
      if (block.kind === "unsupported") {
        throw new Error("raw blocks cannot change kind structurally");
      }
      if (isMarkdownSourceOnlyBlockKind(block.kind)) {
        throw new Error(`${block.kind} blocks cannot change kind structurally`);
      }
      const { content, separator } = splitBlockSource(block.raw);
      const plain = plainBlockContent(block, content);
      const currentListItem = listItemSyntax(block.raw, true);
      if (currentListItem && !isListItemBlockKind(command.kind)) {
        const subtreeEndIndex = listDescendantRangeEnd(sourceBlocks, index, 1);
        if ((block.depth ?? 0) > 0 || subtreeEndIndex > index + 1) {
          throw new Error("list hierarchy cannot be preserved by this Block kind");
        }
      }
      if (currentListItem && isListItemBlockKind(command.kind)) {
        if (command.kind === block.kind) return { snapshot: this.getSnapshot() };
        const indentation = currentListItem.prefix.slice(0, currentListItem.indent);
        const nextPrefix = `${indentation}${listMarkerForKind(command.kind)}`;
        const nextListItem = listItemSyntax(`${nextPrefix}${plain}${separator}`, true);
        if (!nextListItem) throw new Error("the new list kind cannot be represented safely");
        const indentationDelta =
          nextListItem.nestingIndent.length - currentListItem.nestingIndent.length;
        const adjustedPlain = shiftContinuationIndentation(plain, indentationDelta);
        if (adjustedPlain === null) {
          throw new Error("the new list kind cannot preserve continuation indentation safely");
        }
        const next: MarkdownBlockSource = {
          ...block,
          kind: command.kind,
          raw: `${nextPrefix}${adjustedPlain}${separator}`,
        };
        const subtreeEndIndex = listDescendantRangeEnd(sourceBlocks, index, 1);
        const descendantSources = sourceBlocks
          .slice(index + 1, subtreeEndIndex)
          .map((descendant) => {
            if (indentationDelta > 0) {
              return indentSourceLines(descendant.raw, " ".repeat(indentationDelta));
            }
            if (indentationDelta < 0) {
              return outdentSourceLines(descendant.raw, -indentationDelta);
            }
            return descendant.raw;
          });
        if (descendantSources.some((raw) => raw === null)) {
          throw new Error("the new list kind cannot preserve descendant indentation safely");
        }
        this.recordHistory();
        sourceBlocks[index] = next;
        for (
          let descendantIndex = index + 1;
          descendantIndex < subtreeEndIndex;
          descendantIndex += 1
        ) {
          sourceBlocks[descendantIndex] = {
            ...sourceBlocks[descendantIndex],
            raw: descendantSources[descendantIndex - index - 1] as string,
          };
        }
        this.commitSources(sourceBlocks);
        this.revision += 1;
        return { snapshot: this.getSnapshot() };
      }
      let next: MarkdownBlockSource;
      if (command.kind === "heading") {
        if (/\r\n|\n|\r/.test(plain)) {
          throw new Error("a multi-line paragraph cannot become a heading");
        }
        const level = command.level ?? 1;
        next = {
          ...block,
          kind: "heading",
          raw: `${"#".repeat(level)} ${plain}${separator}`,
        };
      } else if (command.kind === "paragraph") {
        next = {
          ...block,
          kind: "paragraph",
          raw: plain + separator,
        };
      } else if (command.kind === "blockquote") {
        next = {
          ...block,
          kind: "blockquote",
          raw: prefixSourceLines(plain, "> ") + separator,
        };
      } else {
        if (/\r\n|\n|\r/.test(plain)) {
          throw new Error("a multi-line Block cannot become a list item");
        }
        const prefix =
          command.kind === "ordered_list_item"
            ? "1. "
            : command.kind === "task_list_item"
              ? "- [ ] "
              : "- ";
        next = {
          ...block,
          kind: command.kind,
          raw: prefix + plain + separator,
        };
      }
      if (next.kind === block.kind && next.raw === block.raw) {
        return { snapshot: this.getSnapshot() };
      }
      this.recordHistory();
      sourceBlocks[index] = next;
      normalizeNeighborBoundaries(sourceBlocks, index, this.markdown);
      this.commitSources(sourceBlocks);
      this.revision += 1;
      return { snapshot: this.getSnapshot() };
    }

    if (command.type === "insertAfter") {
      this.recordHistory();
      const newline = preferredLineEnding(
        block.raw,
        sourceBlocks[index + 1]?.raw ?? "",
        this.markdown
      );
      // Inserting next to a list item continues the list at the anchor's own depth. Emitting a
      // bare paragraph instead used to reflow every following sibling: the plain line ended the
      // list, so `  - c` reparsed at depth 0 and the whole subtree jumped 24px left.
      const listItem = listItemSyntax(block.raw, block.depth !== undefined);
      const raw = command.raw ?? (listItem ? listItem.nextPrefix : "");
      const inserted = blockFromSource(
        raw,
        `block-${this.nextBlockNumber}`,
        listItem ? block.depth : undefined
      );
      this.nextBlockNumber += 1;
      if (command.before) {
        const previous = index > 0 ? sourceBlocks[index - 1] : null;
        const joined = ensureBlockBoundary(inserted, block, newline);
        sourceBlocks.splice(index, 1, joined, block);
        if (previous) sourceBlocks[index - 1] = ensureBlockBoundary(previous, joined, newline);
      } else {
        // Land after the anchor's whole subtree so a new sibling never wedges itself between a
        // parent list item and its own children.
        const subtreeEnd = listDescendantRangeEnd(sourceBlocks, index, 1);
        const previous = sourceBlocks[subtreeEnd - 1];
        const next = sourceBlocks[subtreeEnd] ?? null;
        const joined = next ? ensureBlockBoundary(inserted, next, newline) : inserted;
        sourceBlocks[subtreeEnd - 1] = ensureBlockBoundary(previous, joined, newline);
        sourceBlocks.splice(subtreeEnd, 0, joined);
      }
      this.commitSources(sourceBlocks);
      this.revision += 1;
      const cursor = splitBlockSource(inserted.raw).content.length;
      return {
        snapshot: this.getSnapshot(),
        selection: { blockId: inserted.id, anchor: cursor, head: cursor },
      };
    }

    if (
      command.range.from < 0 ||
      command.range.to < command.range.from ||
      command.range.to > block.raw.length
    ) {
      throw new RangeError("replaceText range is outside the block");
    }

    const raw =
      block.raw.slice(0, command.range.from) + command.text + block.raw.slice(command.range.to);
    if (raw === block.raw) return { snapshot: this.getSnapshot() };
    // Keep the whole span, not just its text: the scan is the only thing that knows a line's list
    // depth, because depth is measured against the *previous* item's content column. Classifying a
    // span on its own text loses that — `    - c` in isolation is an indented code block.
    const rescanned = scanMarkdownSource(raw);
    // Reclassification is pure, so the resulting kind can be known before anything is mutated. A
    // Markdown autoformat (`# ` becoming a heading) has to be its own undo step, or one Mod+Z would
    // take back both the transform and the words typed after it.
    const structureUnchanged =
      rescanned.length <= 1 &&
      reclassifyEditableSource(block, rescanned[0]?.raw ?? raw).kind === block.kind;
    const continuesRun = this.continuesTypingRun(
      block.id,
      command.range,
      command.text,
      structureUnchanged
    );
    if (command.recordHistory !== false && !continuesRun) this.recordHistory();
    this.lastTypedEdit = structureUnchanged
      ? { blockId: block.id, sourceEnd: command.range.from + command.text.length }
      : null;
    const spans =
      rescanned.length > 0
        ? rescanned
        : [{ raw, listDepth: undefined } as (typeof rescanned)[number]];
    const replacementSources = spans.map((span, replacementIndex) => {
      // The host Block keeps going through reclassification, which is what makes an autoformat
      // preserve its identity while typing. Spans split off by this edit are built the way
      // `fromMarkdown` builds them, carrying the depth the scan measured.
      if (replacementIndex === 0) return reclassifyEditableSource(block, span.raw);
      const id = `block-${this.nextBlockNumber}`;
      this.nextBlockNumber += 1;
      return blockFromSource(span.raw, id, span.listDepth);
    });
    sourceBlocks.splice(index, 1, ...replacementSources);
    this.commitSources(sourceBlocks);
    this.revision += 1;
    const cursor = command.range.from + command.text.length;
    let localCursor = cursor;
    let selectionBlock = replacementSources[0];
    for (
      let replacementIndex = 0;
      replacementIndex < replacementSources.length;
      replacementIndex += 1
    ) {
      const candidate = replacementSources[replacementIndex];
      if (
        localCursor <= candidate.raw.length ||
        replacementIndex === replacementSources.length - 1
      ) {
        selectionBlock = candidate;
        break;
      }
      localCursor -= candidate.raw.length;
    }
    return {
      snapshot: this.getSnapshot(),
      selection: {
        blockId: selectionBlock.id,
        anchor: localCursor,
        head: localCursor,
      },
    };
  }

  private sourceBlocks(): MarkdownBlockSource[] {
    return this.blocks.map((block) => ({
      id: block.id,
      kind: block.kind,
      editable: block.editable,
      depth: block.depth,
      raw: this.markdown.slice(block.from, block.to),
    }));
  }

  private commitSources(blocks: MarkdownBlockSource[]): void {
    reprojectListDepths(blocks);
    this.markdown = blocks.map((block) => block.raw).join("");
    this.blocks = spansFromSources(blocks);
  }

  private cloneState(): MarkdownBlockState {
    return {
      markdown: this.markdown,
      blocks: this.blocks.map((block) => ({ ...block })),
    };
  }

  private restoreState(state: MarkdownBlockState): void {
    this.markdown = state.markdown;
    this.blocks = state.blocks.map((block) => ({ ...block }));
  }

  private recordHistory(): void {
    this.pushUndo(this.cloneState());
    this.redoStack = [];
  }

  private pushUndo(state: MarkdownBlockState): void {
    this.undoStack.push(state);
    if (this.undoStack.length > MarkdownBlockDocument.HISTORY_LIMIT) this.undoStack.shift();
  }

  private pushRedo(state: MarkdownBlockState): void {
    this.redoStack.push(state);
    if (this.redoStack.length > MarkdownBlockDocument.HISTORY_LIMIT) this.redoStack.shift();
  }

  /**
   * Whether this edit continues the current typing run and so needs no new history entry.
   *
   * A run continues while the user keeps typing forward from where they were, or keeps deleting
   * backwards from where they were, within one Block, without crossing a word or line boundary and
   * without changing what kind of Block it is. Whitespace ends a run, which gives Mod+Z word-level
   * granularity rather than either one-character-at-a-time or one-giant-step.
   */
  private continuesTypingRun(
    blockId: string,
    range: Utf16Range,
    text: string,
    structureUnchanged: boolean
  ): boolean {
    const run = this.lastTypedEdit;
    if (!run || run.blockId !== blockId || !structureUnchanged) return false;
    if (/[\s\r\n]/.test(text)) return false;
    const isInsertion = range.from === range.to && text.length > 0;
    if (isInsertion) return run.sourceEnd === range.from;
    const isDeletion = text.length === 0 && range.to > range.from;
    return isDeletion && run.sourceEnd === range.to;
  }
}

function contiguousBlockRange(
  blocks: readonly MarkdownBlockSource[],
  blockIds: readonly string[],
  commandType:
    | "deleteBlocks"
    | "duplicateBlocks"
    | "indentBlocks"
    | "moveBlocks"
    | "outdentBlocks"
    | "replaceBlocks"
): { firstIndex: number; length: number } {
  const indexes = blockIds.map((blockId) => blocks.findIndex((block) => block.id === blockId));
  if (indexes.some((index) => index < 0)) {
    throw new Error(`${commandType} contains an unknown block`);
  }
  const firstIndex = indexes[0];
  if (indexes.some((index, offset) => index !== firstIndex + offset)) {
    throw new Error(`${commandType} requires contiguous Blocks in document order`);
  }
  return { firstIndex, length: indexes.length };
}

function listDescendantRangeEnd(
  blocks: readonly MarkdownBlockSource[],
  firstIndex: number,
  length: number
): number {
  let endIndex = firstIndex + length;
  for (let blockIndex = firstIndex; blockIndex < endIndex; blockIndex += 1) {
    const block = blocks[blockIndex];
    if (listItemFamily(block.kind) === null) continue;
    const depth = block.depth ?? 0;
    let descendantIndex = blockIndex + 1;
    while (
      descendantIndex < blocks.length &&
      listItemFamily(blocks[descendantIndex].kind) !== null &&
      (blocks[descendantIndex].depth ?? 0) > depth
    ) {
      descendantIndex += 1;
    }
    endIndex = Math.max(endIndex, descendantIndex);
  }
  return endIndex;
}

/**
 * Whether the Blocks in `[index, endIndex)` still scan back to the kinds they claim.
 *
 * Only the rewritten Block and its own descendants are re-scanned: what a nested item means depends
 * on the item above it, never on what follows the subtree.
 */
function listDescendantsSurviveSource(
  blocks: readonly MarkdownBlockSource[],
  index: number,
  endIndex: number
): boolean {
  if (endIndex <= index + 1) return true;
  const region = blocks.slice(index, endIndex);
  const scanned = scanMarkdownSource(region.map((block) => block.raw).join(""));
  if (scanned.length !== region.length) return false;
  return region.every(
    (block, offset) =>
      blockFromSource(scanned[offset].raw, block.id, scanned[offset].listDepth).kind === block.kind
  );
}

function assertListDescendantsSelected(
  blocks: readonly MarkdownBlockSource[],
  firstIndex: number,
  length: number,
  commandType: "moveBlocks"
): void {
  const lastIndex = firstIndex + length - 1;
  for (let blockIndex = firstIndex; blockIndex <= lastIndex; blockIndex += 1) {
    const block = blocks[blockIndex];
    if (listItemFamily(block.kind) === null) continue;
    const depth = block.depth ?? 0;
    let descendantIndex = blockIndex + 1;
    while (
      descendantIndex < blocks.length &&
      listItemFamily(blocks[descendantIndex].kind) !== null &&
      (blocks[descendantIndex].depth ?? 0) > depth
    ) {
      if (descendantIndex > lastIndex) {
        throw new Error(`${commandType} must include all list descendants`);
      }
      descendantIndex += 1;
    }
  }
}

function reprojectListDepths(blocks: MarkdownBlockSource[]): void {
  const stack: ListItemSourceSyntax[] = [];
  for (const block of blocks) {
    if (listItemFamily(block.kind) === null) {
      stack.length = 0;
      block.depth = undefined;
      continue;
    }
    const syntax = listItemSyntax(block.raw, true);
    if (!syntax) {
      stack.length = 0;
      block.depth = undefined;
      continue;
    }
    let depth = -1;
    for (let parentDepth = stack.length - 1; parentDepth >= 0; parentDepth -= 1) {
      const parent = stack[parentDepth];
      const parentContentIndent = parent.contentIndent;
      if (
        syntax.indentColumns >= parentContentIndent &&
        syntax.indentColumns <= parentContentIndent + 3
      ) {
        depth = parentDepth + 1;
        break;
      }
    }
    if (depth < 0) depth = 0;
    block.depth = depth;
    stack.splice(depth, stack.length - depth, syntax);
  }
}

function normalizeNeighborBoundaries(
  blocks: MarkdownBlockSource[],
  blockIndex: number,
  fallbackSource: string
): void {
  for (const boundaryIndex of [blockIndex - 1, blockIndex]) {
    if (boundaryIndex < 0 || boundaryIndex >= blocks.length - 1) continue;
    blocks[boundaryIndex] = ensureBlockBoundary(
      blocks[boundaryIndex],
      blocks[boundaryIndex + 1],
      preferredLineEnding(blocks[boundaryIndex].raw, blocks[boundaryIndex + 1].raw, fallbackSource)
    );
  }
}

function ensureBlockBoundary(
  left: MarkdownBlockSource,
  right: MarkdownBlockSource,
  newline: "\r\n" | "\n" | "\r"
): MarkdownBlockSource {
  const { content, separator } = splitBlockSource(left.raw);
  if (listItemsShareContainer(left, right)) {
    if (countLineEndings(separator) === 1) return left;
    return { ...left, raw: `${content}${newline}` };
  }
  const requiredLineEndings = 2;
  if (countLineEndings(separator) >= requiredLineEndings) return left;
  return {
    ...left,
    raw: `${content}${newline.repeat(requiredLineEndings)}`,
  };
}

/**
 * `ensureBlockBoundary`, but a junction inside one list is written with the number of line endings
 * that list already used.
 *
 * Forcing exactly one turned a list the user had deliberately spaced out into a tight one every time
 * Alt+Arrow touched it; keeping the moved Block's own separator does the opposite, carrying the
 * blank line that used to end a list into the middle of a tight one. `looseness` is measured on the
 * source before the move, from the side of the junction that did not move — `null` when the source
 * shows no junction to measure, which falls back to the plain boundary rule.
 */
function ensureMovedBlockBoundary(
  left: MarkdownBlockSource,
  right: MarkdownBlockSource,
  looseness: number | null,
  newline: "\r\n" | "\n" | "\r"
): MarkdownBlockSource {
  if (looseness === null || !listItemsShareContainer(left, right)) {
    return ensureBlockBoundary(left, right, newline);
  }
  const { content, separator } = splitBlockSource(left.raw);
  if (countLineEndings(separator) === looseness) return left;
  return { ...left, raw: `${content}${newline.repeat(looseness)}` };
}

/**
 * Line endings the list this Block belongs to puts between its own items, or `null` when the source
 * holds no such junction next to it.
 *
 * A blank line *between* two items makes the list loose; the blank line *after* its last item is
 * only the boundary with whatever follows. Both live in the same place — the left Block's separator
 * — so telling them apart means looking at a junction that is still intact.
 */
function listLoosenessAt(blocks: readonly MarkdownBlockSource[], blockId: string): number | null {
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index < 0) return null;
  for (const leftIndex of [index, index - 1]) {
    const left = blocks[leftIndex];
    const right = blocks[leftIndex + 1];
    if (!left || !right || !listItemsShareContainer(left, right)) continue;
    return countLineEndings(splitBlockSource(left.raw).separator);
  }
  return null;
}

/**
 * Whether every Block the move did not pick up still means what it meant before.
 *
 * `normalizeMovedListIndent` validates the range being moved; nothing validated the Blocks left
 * behind. Dropping a paragraph between two nested items ends the list, so the item under the drop
 * keeps the two leading spaces the user can see and silently stops being a child of anything — one
 * dragged paragraph, and an unrelated item loses the indentation it visibly had. Checked on the
 * final bytes, after the boundaries are repaired, because a mid-repair candidate reads as a lazy
 * continuation and would refuse drops that are perfectly safe.
 */
function moveKeepsBystandersIntact(
  reordered: readonly MarkdownBlockSource[],
  previous: readonly MarkdownBlockSource[],
  movedIds: ReadonlySet<string>
): boolean {
  const scanned = scanMarkdownSource(reordered.map((block) => block.raw).join(""));
  if (scanned.length !== reordered.length) return false;
  const before = new Map(previous.map((block) => [block.id, block]));
  return reordered.every((block, index) => {
    const was = before.get(block.id);
    if (!was) return true;
    const now = blockFromSource(scanned[index].raw, block.id, scanned[index].listDepth);
    if (now.kind !== was.kind) return false;
    // A Block that moved is allowed to be re-indented; one that stayed put is not.
    return movedIds.has(block.id) || (now.depth ?? null) === (was.depth ?? null);
  });
}

function ensureDuplicateInsertionBoundary(
  left: MarkdownBlockSource,
  right: MarkdownBlockSource,
  following: MarkdownBlockSource | undefined,
  newline: "\r\n" | "\n" | "\r"
): MarkdownBlockSource {
  if (listItemFamily(left.kind) !== null && listItemFamily(right.kind) !== null) {
    const { content, separator } = splitBlockSource(left.raw);
    if (following && listItemFamily(following.kind) !== null && countLineEndings(separator) >= 1) {
      return left;
    }
    if (countLineEndings(separator) === 1) return left;
    return { ...left, raw: `${content}${newline}` };
  }
  return ensureBlockBoundary(left, right, newline);
}

function ensureDeletionBoundary(
  left: MarkdownBlockSource,
  right: MarkdownBlockSource,
  newline: "\r\n" | "\n" | "\r"
): MarkdownBlockSource {
  if (listItemFamily(left.kind) !== null && listItemFamily(right.kind) !== null) {
    const { content, separator } = splitBlockSource(left.raw);
    if (countLineEndings(separator) >= 1) return left;
    return { ...left, raw: `${content}${newline}` };
  }
  return ensureBlockBoundary(left, right, newline);
}

function listItemsShareContainer(left: MarkdownBlockSource, right: MarkdownBlockSource): boolean {
  const leftFamily = listItemFamily(left.kind);
  return leftFamily !== null && leftFamily === listItemFamily(right.kind);
}

function listItemFamily(kind: MarkdownBlockKind): "bullet" | "ordered" | null {
  if (kind === "bullet_list_item" || kind === "task_list_item") return "bullet";
  if (kind === "ordered_list_item") return "ordered";
  return null;
}

function isListItemBlockKind(kind: MarkdownBlockKind): kind is ListItemBlockKind {
  return listItemFamily(kind) !== null;
}

function listMarkerForKind(kind: ListItemBlockKind): string {
  if (kind === "ordered_list_item") return "1. ";
  if (kind === "task_list_item") return "- [ ] ";
  return "- ";
}

function plainBlockContent(block: MarkdownBlockSource, content: string): string {
  if (block.kind === "heading") {
    // A setext heading's syntax is its underline, so that is what comes off. Leaving it on made the
    // heading's own text carry a `===` line into whatever the Block turned into.
    const underline = SETEXT_UNDERLINE.exec(content);
    if (underline) return content.slice(0, underline.index);
    return content.replace(/^#{1,6}[ \t]+/, "");
  }
  const listItem = listItemSyntax(block.raw, block.depth !== undefined);
  if (listItem) return content.slice(listItem.contentFrom);
  if (block.kind === "blockquote") {
    return content.replace(/(^|(?:\r\n|\n|\r)) {0,3}>[ \t]?/g, "$1");
  }
  return content;
}

function prefixSourceLines(source: string, prefix: string): string {
  if (!source) return prefix;
  return source.replace(/(^|(?:\r\n|\n|\r))/g, `$1${prefix}`);
}

/**
 * Re-indent a moved list range so its indentation still means something where it landed.
 *
 * Without this, dragging a depth-2 item to the top of the Page left `    - c` — four leading spaces,
 * which Markdown reads as an indented code block. The Block silently stopped being a list item, and
 * that is the user's file, not a view. The shift is applied to the whole range so nesting *within*
 * the moved subtree is preserved, and it is validated by re-scanning: `null` means the result would
 * not parse back to the intended kinds, and the caller must abandon the move. Keeping the
 * un-shifted bytes instead is not a safe fallback — those are exactly the bytes that corrupt.
 */
function normalizeMovedListIndent(
  reordered: readonly MarkdownBlockSource[],
  beforeIndex: number,
  selected: readonly MarkdownBlockSource[]
): MarkdownBlockSource[] | null {
  const moved = [...selected];
  if (moved.every((block) => listItemFamily(block.kind) === null)) return moved;

  const rootDepth = Math.min(...moved.map((block) => block.depth ?? 0));
  const previous = beforeIndex > 0 ? reordered[beforeIndex - 1] : null;
  const previousSyntax = previous ? listItemSyntax(previous.raw, true) : null;
  // A list item may nest at most one level deeper than the item above it; anything else is top level.
  const maxDepth = previousSyntax ? (previous?.depth ?? 0) + 1 : 0;
  const targetDepth = Math.min(rootDepth, Math.max(maxDepth, 0));
  const delta = targetDepth - rootDepth;
  if (delta === 0) return moved;

  const unit = previousSyntax?.nestingIndent || "  ";
  const shifted = moved.map((block) => {
    const depth = Math.max((block.depth ?? 0) + delta, 0);
    let raw = block.raw;
    if (delta > 0) {
      for (let step = 0; step < delta; step += 1) raw = indentSourceLines(raw, unit);
    } else {
      raw = dedentSourceLines(raw, unit.length * -delta);
    }
    return { ...block, raw, depth };
  });

  // Fail closed: the shift is only worth anything if it round-trips to the same Block kinds.
  const candidate = [
    ...reordered.slice(0, beforeIndex),
    ...shifted,
    ...reordered.slice(beforeIndex),
  ];
  const scanned = scanMarkdownSource(candidate.map((block) => block.raw).join(""));
  if (scanned.length !== candidate.length) return null;
  for (const [index, block] of shifted.entries()) {
    const span = scanned[beforeIndex + index];
    if (!span || blockFromSource(span.raw, block.id, span.listDepth).kind !== block.kind) {
      return null;
    }
  }
  return shifted;
}

/** Remove up to `width` leading spaces or tabs from every line. */
function dedentSourceLines(source: string, width: number): string {
  if (width <= 0) return source;
  return source.replace(/^[ \t]*/gm, (match) => match.slice(Math.min(width, match.length)));
}

function indentSourceLines(source: string, indentation: string): string {
  if (!source) return source;
  return indentation + source.replace(/(\r\n|\n|\r(?!\n))(?=.)/g, `$1${indentation}`);
}

function outdentSourceLines(source: string, indentationWidth: number): string | null {
  const indentation = " ".repeat(indentationWidth);
  const parts = source.split(/(\r\n|\n|\r)/);
  for (let partIndex = 0; partIndex < parts.length; partIndex += 2) {
    const line = parts[partIndex];
    if (!line) continue;
    if (/^[ \t]*$/.test(line)) {
      parts[partIndex] = line.slice(Math.min(indentationWidth, line.match(/^ */)?.[0].length ?? 0));
      continue;
    }
    if (!line.startsWith(indentation)) return null;
    parts[partIndex] = line.slice(indentationWidth);
  }
  return parts.join("");
}

function shiftContinuationIndentation(source: string, indentationDelta: number): string | null {
  if (indentationDelta === 0 || !source) return source;
  const indentation = " ".repeat(Math.abs(indentationDelta));
  const parts = source.split(/(\r\n|\n|\r)/);
  for (let partIndex = 2; partIndex < parts.length; partIndex += 2) {
    const line = parts[partIndex];
    if (!line || /^[ \t]*$/.test(line)) continue;
    if (indentationDelta > 0) {
      parts[partIndex] = indentation + line;
      continue;
    }
    if (!line.startsWith(indentation)) return null;
    parts[partIndex] = line.slice(indentation.length);
  }
  return parts.join("");
}

function splitBlockSource(raw: string): { content: string; separator: string } {
  const match = raw.match(/((?:\r\n|\n|\r)(?:[ \t]*(?:\r\n|\n|\r))*[ \t]*)$/);
  if (!match) return { content: raw, separator: "" };
  return { content: raw.slice(0, -match[1].length), separator: match[1] };
}

function countLineEndings(source: string): number {
  let count = 0;
  for (let offset = 0; offset < source.length; offset += 1) {
    if (source[offset] === "\r" && source[offset + 1] === "\n") {
      count += 1;
      offset += 1;
    } else if (source[offset] === "\r" || source[offset] === "\n") {
      count += 1;
    }
  }
  return count;
}

function preferredLineEnding(...sources: string[]): "\r\n" | "\n" | "\r" {
  for (const source of sources) {
    const match = source.match(/\r\n|\n|\r/);
    if (match) return match[0] as "\r\n" | "\n" | "\r";
  }
  return "\n";
}

function blockFromSource(raw: string, id: string, listDepth?: number): MarkdownBlockSource {
  const heading = raw.match(/^(#{1,6})[ \t]+[^\r\n]*(?:(?:\r\n|\n)+)?$/);
  if (heading) {
    return {
      id,
      kind: "heading",
      raw,
      editable: true,
    };
  }

  if (isSetextHeadingSource(raw)) {
    return {
      id,
      kind: "heading",
      raw,
      editable: true,
    };
  }

  if (mermaidFenceSource(raw)) {
    return {
      id,
      kind: "mermaid",
      raw,
      editable: true,
    };
  }

  if (pageCollectionFenceSource(raw)) {
    return {
      id,
      kind: "collection",
      raw,
      editable: true,
    };
  }

  if (isTopLevelFencedCodeSource(raw)) {
    return {
      id,
      kind: "fenced_code",
      raw,
      editable: true,
    };
  }

  if (parseMarkdownImageBlock(raw).ok) {
    return {
      id,
      kind: "image",
      raw,
      editable: true,
    };
  }

  // A spaced divider is marker-then-space, so the list pattern claims it before the thematic-break
  // check further down ever runs. CommonMark gives the break precedence; the list reading is never
  // the right one.
  const listItem = isSpacedThematicBreakSource(raw)
    ? null
    : listItemSyntax(raw, listDepth !== undefined);
  if (listItem) {
    return {
      id,
      kind: listItem.kind,
      raw,
      editable: true,
      depth: listDepth ?? 0,
    };
  }

  if (calloutSource(raw)) {
    return {
      id,
      kind: "callout",
      raw,
      editable: true,
    };
  }

  if (parseMarkdownToggle(raw)) {
    return {
      id,
      kind: "toggle",
      raw,
      editable: true,
    };
  }

  if (blockquoteSyntax(raw)) {
    return {
      id,
      kind: "blockquote",
      raw,
      editable: true,
    };
  }

  if (blockMathSource(raw)) {
    return {
      id,
      kind: "block_math",
      raw,
      editable: true,
    };
  }

  if (singleNativeToken(raw, "hr")) {
    return {
      id,
      kind: "thematic_break",
      raw,
      editable: true,
    };
  }

  if (singleNativeToken(raw, "table")) {
    return {
      id,
      kind: "table",
      raw,
      editable: true,
    };
  }

  if (isUnsupportedBlockSource(raw) || !isNativeParagraphSource(raw)) {
    return { id, kind: "unsupported", raw, editable: true };
  }
  return { id, kind: "paragraph", raw, editable: true };
}

/** The `=` or `-` run underlining a setext heading, matched with the line ending in front of it. */
const SETEXT_UNDERLINE = /(?:\r\n|\n|\r) {0,3}(=+|-+)[ \t]*$/;

/**
 * A heading written with an underline rather than an ATX marker.
 *
 * `---` is a thematic break, a setext underline and a frontmatter delimiter depending only on what
 * sits above it, so the underline's shape cannot decide on its own. The lexer settles it: a setext
 * heading lexes as exactly one heading token, while `---\ntitle: x\n---` lexes as a break followed
 * by one and stays a raw Block. Gated on the cheap shape test so the lexer never runs for a source
 * that could not be one either way.
 */
function isSetextHeadingSource(raw: string): boolean {
  const { content } = splitBlockSource(raw);
  if (!SETEXT_UNDERLINE.test(content)) return false;
  const tokens = nativeBlockLexer.lexer(content);
  return tokens.length === 1 && tokens[0].type === "heading";
}

/** True for a heading Block already classified as one, written in setext form. */
function isSetextHeadingBlock(block: MarkdownBlockSource): boolean {
  return block.kind === "heading" && SETEXT_UNDERLINE.test(splitBlockSource(block.raw).content);
}

/** A single-line thematic break whose markers are separated, like `* * *` or `- - -`. */
function isSpacedThematicBreakSource(raw: string): boolean {
  const { content } = splitBlockSource(raw);
  return /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(content);
}

function pageCollectionFenceSource(raw: string): boolean {
  const result = parsePageCollection(splitBlockSource(raw).content);
  return result.ok || result.diagnostics[0].code !== "invalid-fence";
}

function isUnsupportedBlockSource(raw: string): boolean {
  return /^(?: {0,3}(?:`{3,}|~{3,})| {4}\S| {0,3}\[[^\]\r\n]+\]:| {0,3}<(?:!--|\/?[A-Za-z]))/.test(
    raw
  );
}

function listItemSyntax(raw: string, allowNested = false): ListItemSourceSyntax | null {
  const { content } = splitBlockSource(raw);

  const task = content.match(/^([ \t]*)([-+*])([ \t]+)\[([ xX])\]([ \t]+|$)/);
  if (task) {
    const indentColumns = advanceMarkdownColumns(0, task[1]);
    if (!allowNested && indentColumns > 3) return null;
    const prefix = task[0];
    const checkboxOffset = task[1].length + task[2].length + task[3].length + 1;
    const uncheckedPrefix =
      prefix.slice(0, checkboxOffset) + " " + prefix.slice(checkboxOffset + 1);
    return {
      kind: "task_list_item",
      prefix,
      nextPrefix: uncheckedPrefix.endsWith("]") ? `${uncheckedPrefix} ` : uncheckedPrefix,
      nestingIndent: " ".repeat(task[2].length + task[3].length),
      indent: task[1].length,
      indentColumns,
      contentIndent: advanceMarkdownColumns(indentColumns + task[2].length, task[3]),
      contentFrom: prefix.length,
      checked: task[4].toLowerCase() === "x",
      checkboxOffset,
    };
  }

  const bullet = content.match(/^([ \t]*)([-+*])([ \t]+|$)/);
  if (bullet) {
    const indentColumns = advanceMarkdownColumns(0, bullet[1]);
    if (!allowNested && indentColumns > 3) return null;
    const prefix = bullet[0];
    return {
      kind: "bullet_list_item",
      prefix,
      nextPrefix: bullet[3] ? prefix : `${prefix} `,
      nestingIndent: " ".repeat(bullet[2].length + bullet[3].length),
      indent: bullet[1].length,
      indentColumns,
      contentIndent: advanceMarkdownColumns(indentColumns + bullet[2].length, bullet[3]),
      contentFrom: prefix.length,
    };
  }

  const ordered = content.match(/^([ \t]*)(\d{1,9})([.)])([ \t]+|$)/);
  if (ordered) {
    const indentColumns = advanceMarkdownColumns(0, ordered[1]);
    if (!allowNested && indentColumns > 3) return null;
    const prefix = ordered[0];
    const ordinal = Number(ordered[2]);
    const nextOrdinal = ordinal < 999_999_999 ? ordinal + 1 : ordinal;
    return {
      kind: "ordered_list_item",
      prefix,
      nextPrefix: `${ordered[1]}${nextOrdinal}${ordered[3]}${ordered[4] || " "}`,
      nestingIndent: " ".repeat(ordered[2].length + ordered[3].length + ordered[4].length),
      indent: ordered[1].length,
      indentColumns,
      contentIndent: advanceMarkdownColumns(
        indentColumns + ordered[2].length + ordered[3].length,
        ordered[4]
      ),
      contentFrom: prefix.length,
    };
  }
  return null;
}

/**
 * Indentation that moves `child` into `parent`'s content column.
 *
 * `nestingIndent` is always spaces, so prefixing it to a tab-indented sibling did not move the
 * sibling at all — two spaces in front of a tab still land on the same tab stop, and the Block kept
 * its old depth while the file gained junk whitespace. Widen the unit until the column really moves.
 */
function nestingIndentInto(parent: ListItemSourceSyntax, child: ListItemSourceSyntax): string {
  const childIndentation = child.prefix.slice(0, child.indent);
  let indentation = parent.nestingIndent;
  // Terminates: the measured column is never below the number of spaces prefixed.
  while (advanceMarkdownColumns(0, indentation + childIndentation) < parent.contentIndent) {
    indentation += " ";
  }
  return indentation;
}

/**
 * Advance a Markdown column position across literal indentation, expanding tabs to the next tab
 * stop. Mirrors the source scanner so Block depths survive a reprojection unchanged.
 */
function advanceMarkdownColumns(startColumn: number, source: string): number {
  let column = startColumn;
  for (const character of source) {
    column = character === "\t" ? column + 4 - (column % 4) : column + 1;
  }
  return column;
}

function blockquoteSyntax(raw: string): BlockquoteSourceSyntax | null {
  const { content } = splitBlockSource(raw);
  if (!content) return null;
  const lines = content.split(/\r\n|\n|\r/);
  let firstPrefix: string | null = null;
  for (const line of lines) {
    const match = line.match(/^ {0,3}>[ \t]?/);
    if (!match) return null;
    const payload = line.slice(match[0].length);
    if (/^ {0,3}(?:>|[-+*](?:[ \t]+|$)|\d{1,9}[.)](?:[ \t]+|$)|`{3,}|~{3,})/.test(payload)) {
      return null;
    }
    firstPrefix ??= match[0];
  }
  return firstPrefix === null ? null : { prefix: firstPrefix, contentFrom: firstPrefix.length };
}

function calloutSource(raw: string): boolean {
  if (!blockquoteSyntax(raw)) return false;
  const { content } = splitBlockSource(raw);
  const firstLine = content.split(/\r\n|\n|\r/, 1)[0];
  const payload = firstLine.replace(/^ {0,3}>[ \t]?/, "");
  return /^\[![A-Za-z][A-Za-z0-9_-]*\][+-]?(?:[ \t]+.*)?$/.test(payload);
}

function blockMathSource(raw: string): boolean {
  const { content } = splitBlockSource(raw);
  const singleLine = content.match(/^ {0,3}\$\$(?!\$)(.+?)\$\$[ \t]*$/);
  if (singleLine) return true;
  const lines = content.split(/\r\n|\n|\r/);
  return (
    lines.length >= 3 &&
    /^ {0,3}\$\$[ \t]*$/.test(lines[0]) &&
    /^ {0,3}\$\$[ \t]*$/.test(lines.at(-1) ?? "")
  );
}

function mermaidFenceSource(raw: string): boolean {
  const { content } = splitBlockSource(raw);
  const lines = content.split(/\r\n|\n|\r/);
  if (lines.length < 2) return false;
  const opening = lines[0].match(/^ {0,3}(`{3,}|~{3,})[ \t]*mermaid[ \t]*$/i);
  if (!opening) return false;
  const closing = lines.at(-1)?.match(/^ {0,3}(`+|~+)[ \t]*$/);
  return (
    closing !== undefined &&
    closing !== null &&
    closing[1][0] === opening[1][0] &&
    closing[1].length >= opening[1].length
  );
}

function singleNativeToken(raw: string, type: "hr" | "table"): boolean {
  const { content } = splitBlockSource(raw);
  if (!content.trim()) return false;
  const tokens = nativeBlockLexer.lexer(content);
  return tokens.length === 1 && tokens[0].type === type;
}

function isNativeParagraphSource(raw: string): boolean {
  const { content } = splitBlockSource(raw);
  if (!content.trim()) return true;
  const tokens = nativeBlockLexer.lexer(content);
  return tokens.length === 1 && tokens[0].type === "paragraph";
}

function reclassifyEditableSource(previous: MarkdownBlockSource, raw: string): MarkdownBlockSource {
  return blockFromSource(raw, previous.id, previous.depth);
}

function spansFromSources(blocks: MarkdownBlockSource[]): MarkdownBlockSpan[] {
  let offset = 0;
  return blocks.map((block) => {
    const from = offset;
    offset += block.raw.length;
    const depth = listItemFamily(block.kind) === null ? undefined : (block.depth ?? 0);
    return {
      id: block.id,
      kind: block.kind,
      editable: block.editable,
      ...(depth === undefined ? {} : { depth }),
      from,
      to: offset,
    };
  });
}

function blockViewFromSpan(markdown: string, block: MarkdownBlockSpan): MarkdownBlockView {
  const raw = markdown.slice(block.from, block.to);
  const listItem = listItemSyntax(raw, block.depth !== undefined);
  return {
    ...block,
    level: block.kind === "heading" ? headingLevel(raw) : undefined,
    checked: listItem?.checked,
    raw,
  };
}

/**
 * The level of a heading Block, from its ATX marker or from its underline.
 *
 * No lexing here: the Block is already classified, so a heading that carries no `#` marker can only
 * be a setext one, and this runs for every Block of every snapshot.
 */
function headingLevel(raw: string): 1 | 2 | 3 | 4 | 5 | 6 | undefined {
  const atx = raw.match(/^(#{1,6})[ \t]+/);
  if (atx) return atx[1].length as 1 | 2 | 3 | 4 | 5 | 6;
  const underline = SETEXT_UNDERLINE.exec(splitBlockSource(raw).content)?.[1];
  if (!underline) return undefined;
  return underline[0] === "=" ? 1 : 2;
}
