import type {
  MarkdownBlockView,
  Utf16Range,
} from "@/editor/markdown-block/markdown-block-document";
import { editableMarkdownBlockSource } from "@/editor/markdown-block/markdown-block-source";
import { ATX_HEADING_PREFIX } from "@/editor/markdown-block/markdown-source-scanner";

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

/**
 * The line endings the editing surfaces work in.
 *
 * A textarea's `.value` is LF whatever the file holds — the DOM normalises it — and the find
 * matcher counts in the same space. A contenteditable does no such thing, so a Block with CRLF
 * handed to it raw put every offset after the first line ending one character out, and a search
 * hit was highlighted starting on the `\n`.
 */
export function normalizeEditorLineEndings(source: string): string {
  return source.replace(/\r\n|\r/g, "\n");
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

  // A quote repeats its marker on every line, so it needs the per-line projection rather than the
  // prefix one. Single-line quotes go through it too — one line is just the degenerate case, and one
  // path is easier to trust than two.
  if (block.kind === "blockquote") {
    return projectionFromStrippedLines(
      editableSource,
      (line) => line.match(/^ {0,3}>[ \t]?/)?.[0] ?? "",
      sourceSuffix
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

/**
 * A projection that strips a prefix from *every* line, not just the first.
 *
 * `projectionFromParts` can only take characters off the front and back, which is all a list marker
 * or a code fence needs. A quote is the one kind whose delimiter repeats: `> One\n> Two` carries a
 * marker per line, so the prefix model gave up on it entirely and put the raw `>`s in the editing
 * surface — the Block showed its own Markdown the moment it was clicked, which is the one thing the
 * in-place contract exists to prevent.
 *
 * Offsets are mapped through a table rather than arithmetic because the shift is no longer constant:
 * it grows by one prefix at every line boundary.
 */
function projectionFromStrippedLines(
  editableSource: string,
  prefixOf: (line: string) => string,
  sourceSuffix: string
): BlockEditingProjection {
  const prefixes: string[] = [];
  /** Source offset for each editor offset, plus one end sentinel. */
  const editorToSource: number[] = [];
  let editorText = "";

  // Terminators are carried through verbatim rather than normalised. A CRLF file that came back as
  // LF would be a rewrite of bytes the user never touched, which the storage model forbids.
  const terminator = /\r\n|\n|\r/g;
  for (let index = 0; index <= editableSource.length;) {
    terminator.lastIndex = index;
    const match = terminator.exec(editableSource);
    const lineEnd = match ? match.index : editableSource.length;
    const line = editableSource.slice(index, lineEnd);
    const prefix = prefixOf(line);
    prefixes.push(prefix);

    for (let cursor = prefix.length; cursor < line.length; cursor += 1) {
      editorText += line[cursor];
      editorToSource.push(index + cursor);
    }
    if (!match) break;
    for (let cursor = 0; cursor < match[0].length; cursor += 1) {
      editorText += match[0][cursor];
      editorToSource.push(lineEnd + cursor);
    }
    index = lineEnd + match[0].length;
  }
  editorToSource.push(editableSource.length);

  const sourceToEditor = (offset: number) => {
    const target = clampOffset(offset, editableSource.length);
    // First editor offset whose source position has reached the target. A source offset inside a
    // stripped prefix has no editor position of its own, so it resolves to the start of its text.
    for (let index = 0; index < editorToSource.length; index += 1) {
      if (editorToSource[index] >= target) return index;
    }
    return editorText.length;
  };
  const editorToSourceAt = (offset: number) =>
    editorToSource[clampOffset(offset, editorText.length)] ?? editableSource.length;

  return {
    editorText,
    sourcePrefix: prefixes[0] ?? "",
    sourceSuffix,
    toSource(nextEditorText) {
      // Line i keeps the prefix it had. A line the user has just added has none of its own, so it
      // takes the last one, which is what makes Enter inside a quote produce another quoted line.
      // Splitting on a capturing group keeps each terminator with the line it ended.
      const parts = nextEditorText.split(/(\r\n|\n|\r)/);
      const fallback = prefixes[prefixes.length - 1] ?? "";
      let rebuilt = "";
      for (let part = 0, line = 0; part < parts.length; part += 2, line += 1) {
        rebuilt += `${prefixes[line] ?? fallback}${parts[part]}${parts[part + 1] ?? ""}`;
      }
      return `${rebuilt}${sourceSuffix}`;
    },
    editorOffsetToSource: editorToSourceAt,
    sourceOffsetToEditor: sourceToEditor,
    editorRangeToSource(range) {
      return { from: editorToSourceAt(range.from), to: editorToSourceAt(range.to) };
    },
    sourceRangeToEditor(range) {
      return { from: sourceToEditor(range.from), to: sourceToEditor(range.to) };
    },
  };
}

function clampOffset(offset: number, length: number): number {
  return Math.min(length, Math.max(0, offset));
}

function usesPayloadProjection(kind: MarkdownBlockView["kind"], source: string): boolean {
  if (kind === "paragraph" || kind === "heading") return true;
  if (kind === "bullet_list_item" || kind === "ordered_list_item" || kind === "task_list_item") {
    // Multi-line items included. A list marker is a prefix of the first line and nothing else, which
    // is exactly what this projection can express, so the only thing the old single-line guard bought
    // was a Block that showed its own Markdown: a hand-wrapped `- First line\n  second line` gave up
    // on the projection entirely and put `- ` in the editing surface, beside the bullet the preview
    // was already drawing. Continuation lines keep their indentation, which is structural rather than
    // a delimiter — it is part of the payload and rides along untouched.
    return true;
  }
  return false;
}

function sourcePrefixFor(kind: MarkdownBlockView["kind"], source: string): string {
  if (kind === "heading") return ATX_HEADING_PREFIX.exec(source)?.[0] ?? "";
  if (kind === "task_list_item") {
    return source.match(/^[ \t]*[-+*][ \t]+\[[ xX]\](?:[ \t]+|$)/)?.[0] ?? "";
  }
  if (kind === "bullet_list_item") {
    return source.match(/^[ \t]*[-+*](?:[ \t]+|$)/)?.[0] ?? "";
  }
  if (kind === "ordered_list_item") {
    return source.match(/^[ \t]*\d{1,9}[.)](?:[ \t]+|$)/)?.[0] ?? "";
  }
  return "";
}
