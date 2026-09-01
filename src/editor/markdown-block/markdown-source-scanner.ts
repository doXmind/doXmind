export interface MarkdownSourceSpan {
  from: number;
  to: number;
  raw: string;
  listDepth?: number;
}

interface SourceLine {
  from: number;
  to: number;
  body: string;
}

interface FenceOpening {
  marker: "`" | "~";
  length: number;
}

/**
 * `indent` and `contentIndent` are Markdown *columns*, not character counts, because a nested item's
 * indentation is measured against its parent's content column and a tab counts as up to four columns.
 */
interface ListOpening {
  indent: number;
  contentIndent: number;
  ordered: boolean;
  start: number | null;
}

interface RawBlockOpening {
  end:
    | { kind: "marker"; pattern: RegExp }
    | { kind: "blank" }
    | { kind: "details"; lineIndex: number };
  canInterruptParagraph: boolean;
}

const TAB_STOP = 4;
const HTML_BLOCK_TAGS =
  "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
const HTML_BLOCK_TAG = new RegExp(`^ {0,3}</?(?:${HTML_BLOCK_TAGS})(?:[ \\t]+|/?>|$)`, "i");
const COMPLETE_HTML_TAG = /^ {0,3}(?:<\/?[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[^<>]*)?\/?>)[ \t]*$/;

/**
 * Project canonical Markdown into contiguous, lossless source spans.
 *
 * The returned `raw` values are views over the input source. No normalization
 * or Markdown rendering occurs in this layer. Fence recognition is
 * intentionally top-level. Every safely recognized logical list item is a
 * separate Block span; continuation source stays attached to its owning item,
 * while fenced and code-indented list-shaped literals fail closed as source.
 */
export function scanMarkdownSource(markdown: string): MarkdownSourceSpan[] {
  if (!markdown) return [];

  const lines = splitSourceLines(markdown);
  const spans: MarkdownSourceSpan[] = [];
  let spanFrom = 0;
  let hasContent = false;
  let hasBoundary = false;
  /** Whether the open paragraph is one a setext underline is allowed to close. */
  let underlinable = false;
  let continuesList = false;
  let listStack: ListOpening[] = [];

  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    const rawOpening = htmlBlockOpening(lines, lineIndex);
    if (rawOpening && (rawOpening.canInterruptParagraph || !hasContent || hasBoundary)) {
      if (line.from > spanFrom) {
        spans.push(sourceSpan(markdown, spanFrom, line.from));
      }

      const raw = rawBlockEnd(lines, lineIndex, rawOpening);
      spans.push(sourceSpan(markdown, line.from, raw.to));
      spanFrom = raw.to;
      hasContent = false;
      hasBoundary = false;
      lineIndex = raw.nextLineIndex;
      continue;
    }

    // A setext underline ends the paragraph above it rather than continuing it, so the heading is a
    // Block of its own even when prose follows on the very next line. Checked before the list branch
    // because a one-character `-` underline is also a bare list marker, and CommonMark reads the
    // underline. `underlinable` is what keeps the second `---` of a frontmatter block, or a line
    // under a thematic break, from claiming the lines above it as a heading.
    if (hasContent && !hasBoundary && underlinable && isSetextUnderlineLine(line)) {
      let headingLastLine = lineIndex;
      while (headingLastLine + 1 < lines.length && isBlankLine(lines[headingLastLine + 1])) {
        headingLastLine += 1;
      }

      const headingTo = lines[headingLastLine].to;
      spans.push(sourceSpan(markdown, spanFrom, headingTo));
      spanFrom = headingTo;
      hasContent = false;
      hasBoundary = false;
      lineIndex = headingLastLine + 1;
      continue;
    }

    const list = listOpening(line, continuesList);
    const listCanInterruptParagraph = !list?.ordered || list.start === 1;
    if (list && (!hasContent || hasBoundary || listCanInterruptParagraph)) {
      if (line.from > spanFrom) {
        spans.push(sourceSpan(markdown, spanFrom, line.from));
      }

      const item = listItemEnd(lines, lineIndex, list);
      const listDepth = updateListStack(listStack, list);
      spans.push(sourceSpan(markdown, line.from, item.to, listDepth));
      spanFrom = item.to;
      hasContent = false;
      hasBoundary = false;
      continuesList = item.continuesList;
      if (!continuesList) listStack = [];
      lineIndex = item.nextLineIndex;
      continue;
    }
    continuesList = false;
    listStack = [];

    if (!isBlankLine(line) && isIndentedCodeLine(line) && (!hasContent || hasBoundary)) {
      if (line.from > spanFrom) {
        spans.push(sourceSpan(markdown, spanFrom, line.from));
      }

      const code = indentedCodeBlockEnd(lines, lineIndex);
      spans.push(sourceSpan(markdown, line.from, code.to));
      spanFrom = code.to;
      hasContent = false;
      hasBoundary = false;
      lineIndex = code.nextLineIndex;
      continue;
    }

    const opening = fenceOpening(line);
    if (opening) {
      if (line.from > spanFrom) {
        spans.push(sourceSpan(markdown, spanFrom, line.from));
      }

      let fenceLastLine = lines.length - 1;
      for (let candidateIndex = lineIndex + 1; candidateIndex < lines.length; candidateIndex += 1) {
        if (isClosingFence(lines[candidateIndex], opening)) {
          fenceLastLine = candidateIndex;
          while (fenceLastLine + 1 < lines.length && isBlankLine(lines[fenceLastLine + 1])) {
            fenceLastLine += 1;
          }
          break;
        }
      }

      const fenceTo = lines[fenceLastLine].to;
      spans.push(sourceSpan(markdown, line.from, fenceTo));
      spanFrom = fenceTo;
      hasContent = false;
      hasBoundary = false;
      lineIndex = fenceLastLine + 1;
      continue;
    }

    if (isAtxHeadingLine(line)) {
      if (line.from > spanFrom) {
        spans.push(sourceSpan(markdown, spanFrom, line.from));
      }

      let headingLastLine = lineIndex;
      while (headingLastLine + 1 < lines.length && isBlankLine(lines[headingLastLine + 1])) {
        headingLastLine += 1;
      }

      const headingTo = lines[headingLastLine].to;
      spans.push(sourceSpan(markdown, line.from, headingTo));
      spanFrom = headingTo;
      hasContent = false;
      hasBoundary = false;
      lineIndex = headingLastLine + 1;
      continue;
    }

    const blank = isBlankLine(line);
    // This line opens the Block's content whenever nothing but blanks precede it, and only a
    // paragraph can be underlined: a thematic break is a Block in its own right.
    if (!blank && (!hasContent || hasBoundary)) {
      underlinable = !isThematicBreakLine(line);
    }
    if (!blank && !hasContent && line.from > spanFrom) {
      spans.push(sourceSpan(markdown, spanFrom, line.from));
      spanFrom = line.from;
      hasContent = true;
      hasBoundary = false;
      lineIndex += 1;
      continue;
    }
    if (!blank && hasContent && hasBoundary) {
      spans.push(sourceSpan(markdown, spanFrom, line.from));
      spanFrom = line.from;
      hasBoundary = false;
      lineIndex += 1;
      continue;
    }

    if (blank) {
      if (hasContent) hasBoundary = true;
    } else {
      hasContent = true;
    }
    lineIndex += 1;
  }

  if (spanFrom < markdown.length) {
    spans.push(sourceSpan(markdown, spanFrom, markdown.length));
  }
  return spans;
}

/** True when the source starts with the same top-level fence grammar used by the scanner. */
export function isTopLevelFencedCodeSource(source: string): boolean {
  if (!source) return false;
  const lineEnd = source.search(/\r\n|\n|\r/);
  const body = lineEnd < 0 ? source : source.slice(0, lineEnd);
  return fenceOpening({ from: 0, to: body.length, body }) !== null;
}

/** True when link-shaped text belongs to a source-only literal Block. */
export function isMarkdownLinkOpaqueBlockSource(source: string): boolean {
  if (isTopLevelFencedCodeSource(source)) return true;
  return /^(?: {4}| {0,3}\t| {0,3}\[[^\]\r\n]+\]:| {0,3}<(?:!--|\/?[A-Za-z]|\?|!\[CDATA\[|![A-Z]))/.test(
    source
  );
}

function sourceSpan(
  markdown: string,
  from: number,
  to: number,
  listDepth?: number
): MarkdownSourceSpan {
  const span = { from, to, raw: markdown.slice(from, to) };
  return listDepth === undefined ? span : { ...span, listDepth };
}

function updateListStack(stack: ListOpening[], opening: ListOpening): number {
  let depth = -1;
  for (let parentDepth = stack.length - 1; parentDepth >= 0; parentDepth -= 1) {
    const parent = stack[parentDepth];
    if (opening.indent >= parent.contentIndent && opening.indent <= parent.contentIndent + 3) {
      depth = parentDepth + 1;
      break;
    }
  }
  if (depth < 0) depth = 0;
  stack.splice(depth, stack.length - depth, opening);
  return depth;
}

function isBlankLine(line: SourceLine): boolean {
  return /^[ \t]*$/.test(line.body);
}

/**
 * CommonMark's ATX heading opener: up to three leading spaces, one to six `#`, then whitespace or
 * the end of the line. Capturing group 1 is the marker.
 *
 * Exported because the scanner and the Block classifier disagreed about it. The classifier
 * anchored at column zero and demanded a space, so an indented heading — anything a Prettier run
 * has touched — and an empty `##` were scanned as headings but classified as raw, which drew them
 * as grey code boxes that the Turn into menu then refused to repair.
 */
export const ATX_HEADING_PREFIX = /^ {0,3}(#{1,6})(?:[ \t]+|(?=\r|\n|$))/;

function isAtxHeadingLine(line: SourceLine): boolean {
  return ATX_HEADING_PREFIX.test(line.body);
}

function isSetextUnderlineLine(line: SourceLine): boolean {
  return /^ {0,3}(?:=+|-+)[ \t]*$/.test(line.body);
}

function isThematicBreakLine(line: SourceLine): boolean {
  return /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line.body);
}

function fenceOpening(line: SourceLine): FenceOpening | null {
  const match = line.body.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!match) return null;
  if (match[1][0] === "`" && match[2].includes("`")) return null;
  return {
    marker: match[1][0] as "`" | "~",
    length: match[1].length,
  };
}

function isClosingFence(line: SourceLine, opening: FenceOpening): boolean {
  const match = line.body.match(/^ {0,3}(`+|~+)[ \t]*$/);
  return match !== null && match[1][0] === opening.marker && match[1].length >= opening.length;
}

function htmlBlockOpening(lines: SourceLine[], lineIndex: number): RawBlockOpening | null {
  const line = lines[lineIndex];
  const source = line.body;
  if (isMarkdownToggleOpeningLine(source)) {
    const closingLineIndex = balancedDetailsClosingLine(lines, lineIndex);
    if (closingLineIndex !== null) {
      return {
        end: { kind: "details", lineIndex: closingLineIndex },
        canInterruptParagraph: true,
      };
    }
  }
  const container = source.match(/^ {0,3}<(script|pre|style|textarea)(?:[ \t]|>|$)/i);
  if (container) {
    return {
      end: {
        kind: "marker",
        pattern: new RegExp(`</${container[1]}[ \\t]*>`, "i"),
      },
      canInterruptParagraph: true,
    };
  }
  if (/^ {0,3}<!--/.test(source)) {
    return { end: { kind: "marker", pattern: /-->/ }, canInterruptParagraph: true };
  }
  if (/^ {0,3}<\?/.test(source)) {
    return { end: { kind: "marker", pattern: /\?>/ }, canInterruptParagraph: true };
  }
  if (/^ {0,3}<!\[CDATA\[/.test(source)) {
    return { end: { kind: "marker", pattern: /\]\]>/ }, canInterruptParagraph: true };
  }
  if (/^ {0,3}<![A-Z]/.test(source)) {
    return { end: { kind: "marker", pattern: />/ }, canInterruptParagraph: true };
  }
  if (HTML_BLOCK_TAG.test(source)) {
    return { end: { kind: "blank" }, canInterruptParagraph: true };
  }
  if (COMPLETE_HTML_TAG.test(source)) {
    return { end: { kind: "blank" }, canInterruptParagraph: false };
  }
  return null;
}

function balancedDetailsClosingLine(lines: SourceLine[], openingLineIndex: number): number | null {
  let depth = 0;
  let fence: FenceOpening | null = null;
  for (let lineIndex = openingLineIndex; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (fence) {
      if (isClosingFence(line, fence)) fence = null;
      continue;
    }
    const nextFence = fenceOpening(line);
    if (nextFence) {
      fence = nextFence;
      continue;
    }
    if (isMarkdownToggleOpeningLine(line.body)) depth += 1;
    if (!isMarkdownToggleClosingLine(line.body)) continue;
    depth -= 1;
    if (depth === 0) return lineIndex;
  }
  return null;
}

function rawBlockEnd(
  lines: SourceLine[],
  openingLineIndex: number,
  opening: RawBlockOpening
): { to: number; nextLineIndex: number } {
  let lastLineIndex = lines.length - 1;
  for (let lineIndex = openingLineIndex; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    let terminated = false;
    if (opening.end.kind === "marker") {
      terminated = opening.end.pattern.test(line.body);
    } else if (opening.end.kind === "details") {
      terminated = lineIndex === opening.end.lineIndex;
    } else {
      terminated = lineIndex > openingLineIndex && isBlankLine(line);
    }
    if (!terminated) continue;

    lastLineIndex = lineIndex;
    while (lastLineIndex + 1 < lines.length && isBlankLine(lines[lastLineIndex + 1])) {
      lastLineIndex += 1;
    }
    break;
  }
  return {
    to: lines[lastLineIndex].to,
    nextLineIndex: lastLineIndex + 1,
  };
}

function isIndentedCodeLine(line: SourceLine): boolean {
  return /^(?: {4}| {0,3}\t)/.test(line.body);
}

function indentedCodeBlockEnd(
  lines: SourceLine[],
  openingLineIndex: number
): { to: number; nextLineIndex: number } {
  let nextLineIndex = openingLineIndex + 1;
  while (nextLineIndex < lines.length) {
    const line = lines[nextLineIndex];
    if (!isBlankLine(line) && !isIndentedCodeLine(line)) break;
    nextLineIndex += 1;
  }
  return {
    to: lines[nextLineIndex - 1].to,
    nextLineIndex,
  };
}

function listOpening(line: SourceLine, allowNested = false): ListOpening | null {
  const match = line.body.match(/^([ \t]*)([-+*]|(\d{1,9})[.)])([ \t]+|$)/);
  if (!match) return null;
  const indent = advanceColumns(0, match[1]);
  if (!allowNested && indent > 3) return null;
  return {
    indent,
    contentIndent: advanceColumns(indent + match[2].length, match[4]),
    ordered: match[3] !== undefined,
    start: match[3] === undefined ? null : Number(match[3]),
  };
}

function listItemEnd(
  lines: SourceLine[],
  openingLineIndex: number,
  opening: ListOpening
): { to: number; nextLineIndex: number; continuesList: boolean } {
  let sawBlank = false;
  let fence: FenceOpening | null = null;
  for (let lineIndex = openingLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const relativeLine = {
      ...line,
      body: stripIndentColumns(line.body, opening.indent),
    };
    if (fence) {
      if (isClosingFence(relativeLine, fence)) fence = null;
      continue;
    }
    const nextFence = fenceOpening(relativeLine);
    if (nextFence) {
      // Only a fence indented into the item's content column belongs to the item. A fence written
      // to the left of that column interrupts the item the way CommonMark reads it, so a code
      // block written under a list stays its own Block instead of disappearing into the last item.
      if (leadingIndentColumns(line.body) < opening.contentIndent) {
        return { to: line.from, nextLineIndex: lineIndex, continuesList: false };
      }
      fence = nextFence;
      continue;
    }
    const candidate = listOpening(line, true);
    if (candidate && candidate.indent <= opening.contentIndent + 3) {
      return { to: line.from, nextLineIndex: lineIndex, continuesList: true };
    }

    if (isBlankLine(line)) {
      sawBlank = true;
      continue;
    }
    if (sawBlank && leadingIndentColumns(line.body) <= opening.indent) {
      return { to: line.from, nextLineIndex: lineIndex, continuesList: false };
    }
    sawBlank = false;
  }
  return { to: lines.at(-1)?.to ?? 0, nextLineIndex: lines.length, continuesList: false };
}

function leadingIndentColumns(source: string): number {
  return advanceColumns(0, source.match(/^[ \t]*/)?.[0] ?? "");
}

/** Advance a column position across literal indentation, expanding each tab to the next tab stop. */
function advanceColumns(startColumn: number, source: string): number {
  let column = startColumn;
  for (const character of source) {
    column = character === "\t" ? column + TAB_STOP - (column % TAB_STOP) : column + 1;
  }
  return column;
}

/**
 * Drop up to `columns` worth of leading indentation so a line can be read relative to its owning
 * list item. A tab that straddles the target is dropped whole; the scanner only uses the result to
 * recognize fences, where over-stripping keeps fenced content attached to its item.
 */
function stripIndentColumns(source: string, columns: number): string {
  let column = 0;
  let offset = 0;
  while (offset < source.length && column < columns) {
    const character = source[offset];
    if (character === " ") column += 1;
    else if (character === "\t") column += TAB_STOP - (column % TAB_STOP);
    else break;
    offset += 1;
  }
  return source.slice(offset);
}

function splitSourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let from = 0;
  for (let offset = 0; offset < source.length; offset += 1) {
    const character = source[offset];
    if (character === "\r" && source[offset + 1] === "\n") {
      lines.push({ from, to: offset + 2, body: source.slice(from, offset) });
      offset += 1;
      from = offset + 1;
    } else if (character === "\r" || character === "\n") {
      lines.push({ from, to: offset + 1, body: source.slice(from, offset) });
      from = offset + 1;
    }
  }
  if (from < source.length) {
    lines.push({ from, to: source.length, body: source.slice(from) });
  }
  return lines;
}
import {
  isMarkdownToggleClosingLine,
  isMarkdownToggleOpeningLine,
} from "@/editor/markdown-block/markdown-toggle";
