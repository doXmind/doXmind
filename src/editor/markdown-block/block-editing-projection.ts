import type {
  MarkdownBlockView,
  Utf16Range,
} from "@/editor/markdown-block/markdown-block-document";
import { editableMarkdownBlockSource } from "@/editor/markdown-block/markdown-block-source";

export interface BlockEditingProjection {
  readonly editorText: string;
  readonly sourcePrefix: string;
  readonly sourceSuffix: string;
  toSource(nextEditorText: string): string;
  editorOffsetToSource(offset: number): number;
  sourceOffsetToEditor(offset: number): number;
  editorRangeToSource(range: Utf16Range): Utf16Range;
  sourceRangeToEditor(range: Utf16Range): Utf16Range;
}

export function createBlockEditingProjection(
  block: Pick<MarkdownBlockView, "kind" | "raw">
): BlockEditingProjection {
  const editableSource = editableMarkdownBlockSource(block.raw);
  const sourceSuffix = block.raw.slice(editableSource.length);

  // A delimited Block edits as its payload alone: nobody wants to see, step over, or accidentally
  // break the ``` lines that only exist to tell the parser where the code stops.
  const delimited = splitDelimitedBlockSource(block.kind, editableSource);
  if (delimited) {
    return projectionFromParts(
      delimited.payload,
      delimited.prefix,
      delimited.suffix + sourceSuffix
    );
  }

  if (!usesPayloadProjection(block.kind, editableSource)) {
    return projectionFromParts(editableSource, "", sourceSuffix);
  }

  const sourcePrefix = sourcePrefixFor(block.kind, editableSource);
  const editorText = editableSource.slice(sourcePrefix.length);

  return projectionFromParts(editorText, sourcePrefix, sourceSuffix);
}

export interface DelimitedBlockSourceSplit {
  /** Opening delimiter line including its line ending, e.g. "```ts\n". */
  readonly prefix: string;
  /** Everything between the delimiters — the text the user actually edits. */
  readonly payload: string;
  /** Line ending plus the closing delimiter line, or "" when the Block is unterminated. */
  readonly suffix: string;
  /** Info string on the opening fence, e.g. "ts". Empty for a bare fence. */
  readonly infoString: string;
  /** The opening delimiter run itself, e.g. "```" or "~~~". */
  readonly delimiter: string;
  /** Source offset where `infoString` starts, for rewriting just the language. */
  readonly infoStringFrom: number;
  readonly infoStringTo: number;
}

const FENCE_OPENING = /^[ \t]*(`{3,}|~{3,})([^\r\n]*)(\r\n|\n|\r)/;

/**
 * Split a fenced Block into `prefix + payload + suffix`.
 *
 * Fails closed — returns null — whenever the split would be ambiguous, because `toSource`
 * reassembles these three parts verbatim and a payload line that could itself pass for a closing
 * delimiter would let an edit silently re-cut the Block somewhere else. An unterminated Block still
 * projects: its suffix is empty, so round-tripping cannot invent a delimiter the file never had.
 */
export function splitDelimitedBlockSource(
  kind: MarkdownBlockView["kind"],
  source: string
): DelimitedBlockSourceSplit | null {
  // `block_math` is deliberately excluded. A fence tolerates an empty payload — "```ts\n\n```" is
  // still one code Block — but "$$\n\n$$" is a blank line between two `$$` paragraphs, so deleting
  // an equation's contents would silently disintegrate the Block. Its delimiters stay visible until
  // there is a safe empty state for them.
  const pattern = kind === "fenced_code" || kind === "mermaid" ? FENCE_OPENING : null;
  if (!pattern) return null;
  const opening = pattern.exec(source);
  if (!opening) return null;

  const prefix = opening[0];
  const delimiter = opening[1];
  const info = opening[2];
  const trimmedInfo = info.trim();
  // Where a language would be written: on the existing token, or immediately after the run.
  const delimiterEnd = prefix.indexOf(opening[1]) + opening[1].length;
  const infoStringFrom = trimmedInfo ? prefix.indexOf(trimmedInfo, delimiterEnd) : delimiterEnd;
  const rest = source.slice(prefix.length);

  // A closing line is the delimiter run on its own line, at least as long as the opening run.
  const closing = new RegExp(`^[ \\t]*${delimiter[0]}{${delimiter.length},}[ \\t]*$`);
  const lines = rest.split(/(\r\n|\n|\r)/);
  const closingIndices: number[] = [];
  for (let index = 0; index < lines.length; index += 2) {
    if (closing.test(lines[index])) closingIndices.push(index);
  }
  if (closingIndices.length > 1) return null;
  if (closingIndices.length === 0) {
    return {
      prefix,
      payload: rest,
      suffix: "",
      infoString: trimmedInfo,
      delimiter,
      infoStringFrom,
      infoStringTo: infoStringFrom + trimmedInfo.length,
    };
  }

  const closingIndex = closingIndices[0];
  // The closing line must be last; anything after it belongs to a different Block.
  if (lines.slice(closingIndex + 1).some((part) => part.length > 0)) return null;
  const payload = lines.slice(0, Math.max(closingIndex - 1, 0)).join("");
  const suffix = rest.slice(payload.length);
  return {
    prefix,
    payload,
    suffix,
    infoString: trimmedInfo,
    delimiter,
    infoStringFrom,
    infoStringTo: infoStringFrom + trimmedInfo.length,
  };
}

function projectionFromParts(
  editorText: string,
  sourcePrefix: string,
  sourceSuffix: string
): BlockEditingProjection {
  const editorOffsetToSource = (offset: number) =>
    sourcePrefix.length + clampOffset(offset, editorText.length);
  const sourceOffsetToEditor = (offset: number) =>
    clampOffset(offset - sourcePrefix.length, editorText.length);

  return {
    editorText,
    sourcePrefix,
    sourceSuffix,
    toSource(nextEditorText) {
      return `${sourcePrefix}${nextEditorText}${sourceSuffix}`;
    },
    editorOffsetToSource,
    sourceOffsetToEditor,
    editorRangeToSource(range) {
      return {
        from: editorOffsetToSource(range.from),
        to: editorOffsetToSource(range.to),
      };
    },
    sourceRangeToEditor(range) {
      return {
        from: sourceOffsetToEditor(range.from),
        to: sourceOffsetToEditor(range.to),
      };
    },
  };
}

function clampOffset(offset: number, length: number): number {
  return Math.min(length, Math.max(0, offset));
}

function usesPayloadProjection(kind: MarkdownBlockView["kind"], source: string): boolean {
  if (kind === "paragraph" || kind === "heading") return true;
  if (
    kind === "bullet_list_item" ||
    kind === "ordered_list_item" ||
    kind === "task_list_item" ||
    kind === "blockquote"
  ) {
    return !/[\r\n]/.test(source);
  }
  return false;
}

function sourcePrefixFor(kind: MarkdownBlockView["kind"], source: string): string {
  if (kind === "heading") return source.match(/^#{1,6}[ \t]+/)?.[0] ?? "";
  if (kind === "task_list_item") {
    return source.match(/^[ \t]*[-+*][ \t]+\[[ xX]\](?:[ \t]+|$)/)?.[0] ?? "";
  }
  if (kind === "bullet_list_item") {
    return source.match(/^[ \t]*[-+*](?:[ \t]+|$)/)?.[0] ?? "";
  }
  if (kind === "ordered_list_item") {
    return source.match(/^[ \t]*\d{1,9}[.)](?:[ \t]+|$)/)?.[0] ?? "";
  }
  if (kind === "blockquote" && !/[\r\n]/.test(source)) {
    return source.match(/^ {0,3}>[ \t]?/)?.[0] ?? "";
  }
  return "";
}
