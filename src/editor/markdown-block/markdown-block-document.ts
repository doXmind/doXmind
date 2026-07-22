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
      type: "delete";
      blockId: string;
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
  from: number;
  to: number;
}

interface MarkdownBlockSource {
  id: string;
  kind: MarkdownBlockKind;
  raw: string;
  editable: boolean;
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
  private revision = 0;
  private markdown: string;
  private blocks: MarkdownBlockSpan[];
  private nextBlockNumber: number;
  private undoStack: MarkdownBlockState[] = [];
  private redoStack: MarkdownBlockState[] = [];

  private constructor(markdown: string, blocks: MarkdownBlockSpan[], nextBlockNumber: number) {
    this.markdown = markdown;
    this.blocks = blocks;
    this.nextBlockNumber = nextBlockNumber;
  }

  static fromMarkdown(markdown: string): MarkdownBlockDocument {
    const sources = scanMarkdownSource(markdown).map((span) => span.raw);
    const sourceBlocks: MarkdownBlockSource[] = [];
    let nextId = 1;

    for (const raw of sources) {
      sourceBlocks.push(blockFromSource(raw, `block-${nextId}`));
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

  undo(): MarkdownBlockSnapshot {
    const previous = this.undoStack.pop();
    if (!previous) return this.getSnapshot();
    this.redoStack.push(this.cloneState());
    this.restoreState(previous);
    this.revision += 1;
    return this.getSnapshot();
  }

  redo(): MarkdownBlockSnapshot {
    const next = this.redoStack.pop();
    if (!next) return this.getSnapshot();
    this.undoStack.push(this.cloneState());
    this.restoreState(next);
    this.revision += 1;
    return this.getSnapshot();
  }

  apply(command: MarkdownBlockCommand): MarkdownBlockApplyResult {
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
      const task = listItemSyntax(block.raw);
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
      const splitTo = command.to ?? command.at;
      if (command.at < 0 || splitTo < command.at || splitTo > content.length) {
        throw new RangeError("split position is outside the block");
      }
      const listItem = listItemSyntax(block.raw);
      if (listItem && command.at < listItem.contentFrom) {
        throw new RangeError("a list item cannot split inside its source marker");
      }
      if (
        listItem &&
        content.slice(listItem.contentFrom).length === 0 &&
        command.at === listItem.contentFrom &&
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
      if (blockquote && command.at < blockquote.contentFrom) {
        throw new RangeError("a blockquote cannot split inside its source marker");
      }
      if (blockquote && command.at < content.length) {
        this.recordHistory();
        const newline = preferredLineEnding(block.raw, this.markdown);
        const inserted = newline + blockquote.prefix;
        sourceBlocks[index] = blockFromSource(
          content.slice(0, command.at) + inserted + content.slice(splitTo) + separator,
          block.id
        );
        this.commitSources(sourceBlocks);
        this.revision += 1;
        const cursor = command.at + inserted.length;
        return {
          snapshot: this.getSnapshot(),
          selection: { blockId: block.id, anchor: cursor, head: cursor },
        };
      }
      this.recordHistory();
      const leftContent = content.slice(0, command.at);
      const rightContent = content.slice(splitTo);
      const rightRaw = listItem ? listItem.nextPrefix + rightContent : rightContent;
      let left = reclassifyEditableSource(block, leftContent);
      const right = blockFromSource(rightRaw + separator, `block-${this.nextBlockNumber}`);
      this.nextBlockNumber += 1;
      left = ensureBlockBoundary(left, right, preferredLineEnding(block.raw, this.markdown));
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
      const currentListItem = listItemSyntax(block.raw);
      const previousBlock = index > 0 ? sourceBlocks[index - 1] : null;
      const unwrapCurrent =
        block.kind === "blockquote" ||
        (currentListItem !== null &&
          (previousBlock === null ||
            listItemFamily(previousBlock.kind) !== listItemFamily(block.kind)));
      if (unwrapCurrent) {
        this.recordHistory();
        const { content, separator } = splitBlockSource(block.raw);
        sourceBlocks[index] = blockFromSource(
          plainBlockContent(block, content) + separator,
          block.id
        );
        normalizeNeighborBoundaries(sourceBlocks, index, this.markdown);
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
        isMarkdownSourceOnlyBlockKind(block.kind)
      ) {
        throw new Error("unsupported blocks cannot be merged as text");
      }
      this.recordHistory();
      const previousParts = splitBlockSource(previous.raw);
      const currentParts = splitBlockSource(block.raw);
      const cursor = previousParts.content.length;
      const merged = reclassifyEditableSource(
        previous,
        previousParts.content +
          currentParts.content.slice(currentListItem?.contentFrom ?? 0) +
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
      this.recordHistory();
      const duplicate = {
        ...block,
        id: `block-${this.nextBlockNumber}`,
      };
      this.nextBlockNumber += 1;
      const newline = preferredLineEnding(block.raw, this.markdown);
      const original = ensureBlockBoundary(block, duplicate, newline);
      const copy = sourceBlocks[index + 1]
        ? ensureBlockBoundary(duplicate, sourceBlocks[index + 1], newline)
        : duplicate;
      sourceBlocks.splice(index, 1, original, copy);
      this.commitSources(sourceBlocks);
      this.revision += 1;
      return {
        snapshot: this.getSnapshot(),
        selection: { blockId: duplicate.id, anchor: 0, head: 0 },
      };
    }

    if (command.type === "delete") {
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
      const raw = command.raw ?? "";
      const inserted: MarkdownBlockSource = {
        id: `block-${this.nextBlockNumber}`,
        kind: "paragraph",
        raw,
        editable: true,
      };
      this.nextBlockNumber += 1;
      const newline = preferredLineEnding(
        block.raw,
        sourceBlocks[index + 1]?.raw ?? "",
        this.markdown
      );
      sourceBlocks[index] = ensureBlockSeparator(block, newline);
      const normalized =
        index < sourceBlocks.length - 1 ? ensureBlockSeparator(inserted, newline) : inserted;
      sourceBlocks.splice(index + 1, 0, normalized);
      this.commitSources(sourceBlocks);
      this.revision += 1;
      const cursor = splitBlockSource(raw).content.length;
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
    if (command.recordHistory !== false) this.recordHistory();
    const rescanned = scanMarkdownSource(raw).map((span) => span.raw);
    const replacementSources = (rescanned.length > 0 ? rescanned : [raw]).map(
      (source, replacementIndex) => {
        if (replacementIndex === 0) return reclassifyEditableSource(block, source);
        const seed: MarkdownBlockSource = {
          id: `block-${this.nextBlockNumber}`,
          kind: "paragraph",
          raw: source,
          editable: true,
        };
        this.nextBlockNumber += 1;
        return reclassifyEditableSource(seed, source);
      }
    );
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
      raw: this.markdown.slice(block.from, block.to),
    }));
  }

  private commitSources(blocks: MarkdownBlockSource[]): void {
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
    this.undoStack.push(this.cloneState());
    this.redoStack = [];
  }
}

function ensureBlockSeparator(
  block: MarkdownBlockSource,
  newline: "\r\n" | "\n" | "\r"
): MarkdownBlockSource {
  const { content, separator } = splitBlockSource(block.raw);
  if (countLineEndings(separator) >= 2) return block;
  return {
    ...block,
    raw: `${content}${newline}${newline}`,
  };
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

function listItemsShareContainer(left: MarkdownBlockSource, right: MarkdownBlockSource): boolean {
  const leftFamily = listItemFamily(left.kind);
  return leftFamily !== null && leftFamily === listItemFamily(right.kind);
}

function listItemFamily(kind: MarkdownBlockKind): "bullet" | "ordered" | null {
  if (kind === "bullet_list_item" || kind === "task_list_item") return "bullet";
  if (kind === "ordered_list_item") return "ordered";
  return null;
}

function plainBlockContent(block: MarkdownBlockSource, content: string): string {
  if (block.kind === "heading") return content.replace(/^#{1,6}[ \t]+/, "");
  const listItem = listItemSyntax(block.raw);
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

function blockFromSource(raw: string, id: string): MarkdownBlockSource {
  const heading = raw.match(/^(#{1,6})[ \t]+[^\r\n]*(?:(?:\r\n|\n)+)?$/);
  if (heading) {
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

  const listItem = listItemSyntax(raw);
  if (listItem) {
    return {
      id,
      kind: listItem.kind,
      raw,
      editable: true,
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

function pageCollectionFenceSource(raw: string): boolean {
  const result = parsePageCollection(splitBlockSource(raw).content);
  return result.ok || result.diagnostics[0].code !== "invalid-fence";
}

function isUnsupportedBlockSource(raw: string): boolean {
  return /^(?: {0,3}(?:`{3,}|~{3,})| {4}\S| {0,3}\[[^\]\r\n]+\]:| {0,3}<(?:!--|\/?[A-Za-z]))/.test(
    raw
  );
}

function listItemSyntax(raw: string): ListItemSourceSyntax | null {
  const { content } = splitBlockSource(raw);
  if (/\r\n|\n|\r/.test(content)) return null;

  const task = content.match(/^( {0,3})([-+*])([ \t]+)\[([ xX])\]([ \t]+|$)/);
  if (task) {
    const prefix = task[0];
    const checkboxOffset = task[1].length + task[2].length + task[3].length + 1;
    const uncheckedPrefix =
      prefix.slice(0, checkboxOffset) + " " + prefix.slice(checkboxOffset + 1);
    return {
      kind: "task_list_item",
      prefix,
      nextPrefix: uncheckedPrefix.endsWith("]") ? `${uncheckedPrefix} ` : uncheckedPrefix,
      contentFrom: prefix.length,
      checked: task[4].toLowerCase() === "x",
      checkboxOffset,
    };
  }

  const bullet = content.match(/^( {0,3})([-+*])([ \t]+|$)/);
  if (bullet) {
    const prefix = bullet[0];
    return {
      kind: "bullet_list_item",
      prefix,
      nextPrefix: bullet[3] ? prefix : `${prefix} `,
      contentFrom: prefix.length,
    };
  }

  const ordered = content.match(/^( {0,3})(\d{1,9})([.)])([ \t]+|$)/);
  if (ordered) {
    const prefix = ordered[0];
    const ordinal = Number(ordered[2]);
    const nextOrdinal = ordinal < 999_999_999 ? ordinal + 1 : ordinal;
    return {
      kind: "ordered_list_item",
      prefix,
      nextPrefix: `${ordered[1]}${nextOrdinal}${ordered[3]}${ordered[4] || " "}`,
      contentFrom: prefix.length,
    };
  }
  return null;
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
  return blockFromSource(raw, previous.id);
}

function spansFromSources(blocks: MarkdownBlockSource[]): MarkdownBlockSpan[] {
  let offset = 0;
  return blocks.map((block) => {
    const from = offset;
    offset += block.raw.length;
    return {
      id: block.id,
      kind: block.kind,
      editable: block.editable,
      from,
      to: offset,
    };
  });
}

function blockViewFromSpan(markdown: string, block: MarkdownBlockSpan): MarkdownBlockView {
  const raw = markdown.slice(block.from, block.to);
  const heading = block.kind === "heading" ? raw.match(/^(#{1,6})[ \t]+/) : null;
  const listItem = listItemSyntax(raw);
  return {
    ...block,
    level: heading?.[1].length as 1 | 2 | 3 | 4 | 5 | 6 | undefined,
    checked: listItem?.checked,
    raw,
  };
}
