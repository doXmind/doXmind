export interface Utf16Range {
  readonly from: number;
  readonly to: number;
}

export interface Utf16Selection {
  readonly anchor: number;
  readonly head: number;
}

export interface MarkdownInlinePatchResult {
  readonly source: string;
  readonly selection?: Utf16Selection;
  readonly applied: boolean;
}

export type MarkdownInlineOffsetAffinity = "backward" | "forward";

export interface MarkdownInlineMarks {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly strike: boolean;
  readonly code: boolean;
  readonly link: boolean;
  readonly wiki: boolean;
  /** Obsidian's `==highlight==`. */
  readonly highlight: boolean;
  /**
   * Obsidian's `%%comment%%`. The text stays visible and dimmed while the Block is being edited —
   * a comment you cannot see is a comment you cannot remove — and is absent from the rendered
   * view, which is the whole point of writing one.
   */
  readonly comment: boolean;
}

export interface MarkdownInlineTextSegment {
  readonly kind: "text";
  readonly text: string;
  readonly sourceFrom: number;
  readonly sourceTo: number;
  readonly visibleFrom: number;
  readonly visibleTo: number;
  readonly editable: true;
  readonly marks: MarkdownInlineMarks;
  readonly linkTarget?: string;
  readonly wikiTarget?: string;
}

export interface MarkdownInlineImageSegment {
  readonly kind: "image";
  readonly text: "\uFFFC";
  readonly sourceFrom: number;
  readonly sourceTo: number;
  readonly visibleFrom: number;
  readonly visibleTo: number;
  readonly editable: false;
  readonly marks: MarkdownInlineMarks;
  readonly imageAlt: string;
  readonly imageTarget: string;
}

export type MarkdownInlineSegment = MarkdownInlineTextSegment | MarkdownInlineImageSegment;

export interface MarkdownInlineProjection {
  readonly source: string;
  readonly visibleText: string;
  readonly segments: readonly MarkdownInlineSegment[];
  visibleOffsetToSource(offset: number, affinity?: MarkdownInlineOffsetAffinity): number;
  sourceOffsetToVisible(offset: number, affinity?: MarkdownInlineOffsetAffinity): number;
  visibleRangeToSource(range: Utf16Range): Utf16Range;
  sourceRangeToVisible(range: Utf16Range): Utf16Range;
}

interface Piece {
  readonly kind: "text" | "image";
  readonly text: string;
  readonly sourceFrom: number;
  readonly sourceTo: number;
  readonly sourceBoundaries: readonly number[];
  readonly editable: boolean;
  readonly marks: MarkdownInlineMarks;
  readonly linkTarget?: string;
  readonly wikiTarget?: string;
  readonly imageAlt?: string;
  readonly imageTarget?: string;
  readonly unsafe?: true;
}

interface Boundary {
  readonly visible: number;
  readonly source: number;
}

interface Delimiter {
  readonly character: "*" | "_" | "~" | "=" | "%";
  readonly width: 1 | 2;
  readonly mark: "bold" | "italic" | "strike" | "highlight" | "comment";
}

/** Delimiters that exist only as a doubled run: `~~`, `==`, `%%`. */
const PAIRED_ONLY_DELIMITERS: Record<string, "strike" | "highlight" | "comment"> = {
  "~": "strike",
  "=": "highlight",
  "%": "comment",
};

interface ParseResult {
  readonly pieces: Piece[];
  readonly cursor: number;
  readonly closed: boolean;
}

interface ParsedLink {
  readonly pieces: Piece[];
  readonly cursor: number;
}

const EMPTY_MARKS: MarkdownInlineMarks = {
  bold: false,
  italic: false,
  strike: false,
  code: false,
  link: false,
  wiki: false,
  highlight: false,
  comment: false,
};

export function projectMarkdownInline(source: string): MarkdownInlineProjection {
  const pieces = new InlineParser(source).parse();
  const { visibleText, segments, boundaries } = materialize(pieces);

  const visibleOffsetToSource = (
    offset: number,
    affinity: MarkdownInlineOffsetAffinity = "forward"
  ) => {
    const clamped = clampOffset(offset, visibleText.length);
    const exact = boundaries.filter((boundary) => boundary.visible === clamped);
    if (exact.length > 0) {
      return affinity === "backward"
        ? Math.min(...exact.map((boundary) => boundary.source))
        : Math.max(...exact.map((boundary) => boundary.source));
    }
    return clampOffset(clamped, source.length);
  };

  const sourceOffsetToVisible = (
    offset: number,
    affinity: MarkdownInlineOffsetAffinity = "forward"
  ) => {
    const clamped = clampOffset(offset, source.length);
    const candidates =
      affinity === "backward"
        ? boundaries.filter((boundary) => boundary.source <= clamped)
        : boundaries.filter((boundary) => boundary.source >= clamped);
    if (candidates.length === 0) {
      return affinity === "backward" ? 0 : visibleText.length;
    }
    const sourceBoundary =
      affinity === "backward"
        ? Math.max(...candidates.map((boundary) => boundary.source))
        : Math.min(...candidates.map((boundary) => boundary.source));
    const exact = candidates.filter((boundary) => boundary.source === sourceBoundary);
    return affinity === "backward"
      ? Math.max(...exact.map((boundary) => boundary.visible))
      : Math.min(...exact.map((boundary) => boundary.visible));
  };

  return {
    source,
    visibleText,
    segments,
    visibleOffsetToSource,
    sourceOffsetToVisible,
    visibleRangeToSource(range) {
      const normalized = normalizeRange(range, visibleText.length);
      if (normalized.from === normalized.to) {
        const offset = visibleOffsetToSource(normalized.from, "forward");
        return { from: offset, to: offset };
      }
      return {
        from: visibleOffsetToSource(normalized.from, "forward"),
        to: visibleOffsetToSource(normalized.to, "backward"),
      };
    },
    sourceRangeToVisible(range) {
      const normalized = normalizeRange(range, source.length);
      if (normalized.from === normalized.to) {
        const offset = sourceOffsetToVisible(normalized.from, "forward");
        return { from: offset, to: offset };
      }
      return {
        from: sourceOffsetToVisible(normalized.from, "forward"),
        to: sourceOffsetToVisible(normalized.to, "backward"),
      };
    },
  };
}

export function applyVisibleTextPatch(
  source: string,
  oldVisible: string,
  newVisible: string,
  selection?: Utf16Selection
): MarkdownInlinePatchResult {
  const projection = projectMarkdownInline(source);
  if (projection.visibleText !== oldVisible) {
    return patchFailure(source, projection, selection);
  }
  if (oldVisible === newVisible) {
    return {
      source,
      ...(selection ? { selection: mapVisibleSelection(projection, selection) } : {}),
      applied: true,
    };
  }

  const difference = minimalUtf16Difference(oldVisible, newVisible);
  const touchesAtomicImage = projection.segments.some(
    (segment) =>
      segment.kind === "image" &&
      difference.oldFrom < segment.visibleTo &&
      difference.oldTo > segment.visibleFrom
  );
  if (touchesAtomicImage) {
    return patchFailure(source, projection, selection);
  }
  const sourceRange = projection.visibleRangeToSource({
    from: difference.oldFrom,
    to: difference.oldTo,
  });
  const replacement = newVisible.slice(difference.newFrom, difference.newTo);
  const insertionAt =
    difference.oldFrom === difference.oldTo
      ? projection.visibleOffsetToSource(difference.oldFrom, "backward")
      : null;
  for (const nextSource of patchCandidates(source, sourceRange, replacement, insertionAt)) {
    const nextProjection = projectMarkdownInline(nextSource);
    if (nextProjection.visibleText !== newVisible) continue;
    return {
      source: nextSource,
      ...(selection ? { selection: mapVisibleSelection(nextProjection, selection) } : {}),
      applied: true,
    };
  }
  return patchFailure(source, projection, selection);
}

/**
 * The source strings worth trying for one visible edit, best first.
 *
 * Every candidate is still accepted only if it reparses to the visible text the user typed, so the
 * extra ones can only rescue an edit that would otherwise be dropped on the floor:
 *
 * - Emptying a span used to leave its delimiters behind — deleting the word in `a **bold** c` wrote
 *   `a **** c`, which CommonMark reads as four literal asterisks the editing surface then hides, so
 *   there is no keystroke that reaches them again. The delimiters leave with the content they wrapped.
 * - A caret between two segments resolves forward, which puts an insertion after a closing delimiter.
 *   `_under_` cannot close against a following word character, so typing right after it reparsed to
 *   something else and the keystroke was silently discarded — the character never appeared and the
 *   file never changed. The backward position keeps the insertion inside the span instead.
 */
function patchCandidates(
  source: string,
  range: Utf16Range,
  replacement: string,
  insertionAt: number | null
): string[] {
  const candidates: string[] = [];
  const push = (from: number, to: number, text: string) => {
    const candidate = `${source.slice(0, from)}${text}${source.slice(to)}`;
    if (!candidates.includes(candidate)) candidates.push(candidate);
  };
  const emptied = replacement ? null : emptiedDelimiterPair(source, range);
  if (emptied) push(emptied.from, emptied.to, "");
  const texts = [escapeVisibleMarkdown(replacement), replacement];
  for (const text of texts) push(range.from, range.to, text);
  if (insertionAt !== null) {
    for (const text of texts) push(insertionAt, insertionAt, text);
  }
  return candidates;
}

/** The delimiter runs either side of a range that an empty replacement would leave with no content. */
function emptiedDelimiterPair(source: string, range: Utf16Range): Utf16Range | null {
  const opening = /(?:\*+|_+|~+)$/.exec(source.slice(0, range.from))?.[0] ?? "";
  const closing = /^(?:\*+|_+|~+)/.exec(source.slice(range.to))?.[0] ?? "";
  if (!opening || opening !== closing) return null;
  return { from: range.from - opening.length, to: range.to + closing.length };
}

class InlineParser {
  constructor(private readonly source: string) {}

  parse(): Piece[] {
    const pieces = this.parseSequence(0, this.source.length, EMPTY_MARKS, null, []).pieces;
    return pieces.some((piece) => piece.unsafe)
      ? literalPieces(this.source, 0, this.source.length, EMPTY_MARKS)
      : pieces;
  }

  private parseSequence(
    from: number,
    to: number,
    marks: MarkdownInlineMarks,
    expected: Delimiter | null,
    ancestors: readonly Delimiter[]
  ): ParseResult {
    const pieces: Piece[] = [];
    let cursor = from;

    while (cursor < to) {
      if (this.isEscapedPunctuationAt(cursor, to)) {
        pieces.push(escapedPiece(this.source, cursor, marks));
        cursor += 2;
        continue;
      }
      const code = this.inlineCodeAt(cursor, to, marks);
      if (code) {
        pieces.push(code.piece);
        cursor = code.cursor;
        continue;
      }
      const unsafeResource = this.unsafeResourceAt(cursor, to);
      if (unsafeResource) {
        pieces.push(...unsafeResource.pieces);
        cursor = unsafeResource.cursor;
        continue;
      }
      const image = this.imageAt(cursor, to, marks);
      if (image) {
        pieces.push(image.piece);
        cursor = image.cursor;
        continue;
      }
      const wiki = this.wikiLinkAt(cursor, to, marks);
      if (wiki) {
        pieces.push(...wiki.pieces);
        cursor = wiki.cursor;
        continue;
      }
      const autolink = this.autolinkAt(cursor, to, marks);
      if (autolink) {
        pieces.push(...autolink.pieces);
        cursor = autolink.cursor;
        continue;
      }
      const link = this.linkAt(cursor, to, marks);
      if (link) {
        pieces.push(...link.pieces);
        cursor = link.cursor;
        continue;
      }
      if (expected && this.canCloseDelimiter(cursor, expected, ancestors, to)) {
        return {
          pieces,
          cursor: cursor + expected.width,
          closed: true,
        };
      }
      if (expected && this.mustReserveDelimiterForAncestor(cursor, expected, ancestors, to)) {
        return { pieces, cursor, closed: false };
      }

      const delimiter = this.openingDelimiterAt(cursor, to);
      if (delimiter) {
        const nested = this.parseSequence(
          cursor + delimiter.width,
          to,
          { ...marks, [delimiter.mark]: true },
          delimiter,
          expected ? [expected, ...ancestors] : ancestors
        );
        if (nested.closed) {
          pieces.push(...nested.pieces);
          cursor = nested.cursor;
          continue;
        }
        pieces.push(...literalPieces(this.source, cursor, cursor + delimiter.width, marks));
        cursor += delimiter.width;
        continue;
      }

      const next = this.nextDelimiter(cursor + 1, to);
      pieces.push(...literalPieces(this.source, cursor, next, marks));
      cursor = next;
    }

    return { pieces, cursor, closed: expected === null };
  }

  private openingDelimiterAt(cursor: number, to: number): Delimiter | null {
    const character = this.source[cursor];
    if (
      character !== "*" &&
      character !== "_" &&
      character !== "~" &&
      character !== "=" &&
      character !== "%"
    ) {
      return null;
    }

    const paired = PAIRED_ONLY_DELIMITERS[character];
    const runLength = this.delimiterRunLength(cursor, character, to);
    const width = paired || runLength >= 2 ? 2 : 1;
    if (paired && runLength < 2) return null;
    const next = this.source[cursor + width] ?? "";
    const previous = this.source[cursor - 1] ?? "";
    if (!next || isWhitespace(next)) return null;
    if (character === "_" && isWordCharacter(previous) && isWordCharacter(next)) {
      return null;
    }

    return {
      character,
      width,
      mark: paired ?? (width === 2 ? "bold" : "italic"),
    };
  }

  private canCloseDelimiter(
    cursor: number,
    expected: Delimiter,
    ancestors: readonly Delimiter[],
    to: number
  ): boolean {
    if (this.source[cursor] !== expected.character) return false;
    const runLength = this.delimiterRunLength(cursor, expected.character, to);
    if (runLength < expected.width) return false;
    const reservedWidth = ancestors
      .filter((delimiter) => delimiter.character === expected.character)
      .reduce((sum, delimiter) => sum + delimiter.width, 0);
    // An ancestor only draws its closer from *this* run when something is left of the run once this
    // delimiter has taken its width — `***bold***` closes both spans out of one run, so the inner one
    // has to leave enough behind. A run that ends exactly where this span closes says the outer span
    // closes somewhere further along, and reserving there meant the inner span never closed at all:
    // `**a *b* c**` rendered `a b c` unfocused but showed `a *b* c` the moment it was clicked, so
    // deleting one of those invented asterisks destroyed a real delimiter.
    const leftover = runLength - expected.width;
    if (leftover > 0 && leftover < reservedWidth) return false;

    const previous = this.source[cursor - 1] ?? "";
    const next = this.source[cursor + expected.width] ?? "";
    if (!previous || isWhitespace(previous)) return false;
    if (expected.character === "_" && isWordCharacter(previous) && isWordCharacter(next)) {
      return false;
    }
    return true;
  }

  private mustReserveDelimiterForAncestor(
    cursor: number,
    expected: Delimiter,
    ancestors: readonly Delimiter[],
    to: number
  ): boolean {
    if (this.source[cursor] !== expected.character) return false;
    const runLength = this.delimiterRunLength(cursor, expected.character, to);
    const matchingAncestor = ancestors.find(
      (delimiter) => delimiter.character === expected.character && runLength >= delimiter.width
    );
    if (!matchingAncestor) return false;
    const previous = this.source[cursor - 1] ?? "";
    return Boolean(previous && !isWhitespace(previous));
  }

  private nextDelimiter(from: number, to: number): number {
    let cursor = from;
    while (cursor < to) {
      const character = this.source[cursor];
      if (
        character === "\\" ||
        character === "`" ||
        character === "!" ||
        character === "[" ||
        character === "<" ||
        character === "*" ||
        character === "_" ||
        character === "~" ||
        character === "=" ||
        character === "%"
      ) {
        return cursor;
      }
      cursor += 1;
    }
    return to;
  }

  private delimiterRunLength(from: number, character: Delimiter["character"], to: number): number {
    let cursor = from;
    while (cursor < to && this.source[cursor] === character) cursor += 1;
    return cursor - from;
  }

  private isEscapedPunctuationAt(cursor: number, to: number): boolean {
    return (
      this.source[cursor] === "\\" && cursor + 1 < to && isAsciiPunctuation(this.source[cursor + 1])
    );
  }

  private inlineCodeAt(
    cursor: number,
    to: number,
    marks: MarkdownInlineMarks
  ): { piece: Piece; cursor: number } | null {
    if (this.source[cursor] !== "`") return null;
    const fenceWidth = this.runLength(cursor, "`", to);
    let close = cursor + fenceWidth;
    while (close < to) {
      const next = this.source.indexOf("`", close);
      if (next < 0 || next >= to) return null;
      const candidateWidth = this.runLength(next, "`", to);
      if (candidateWidth === fenceWidth) {
        const contentFrom = cursor + fenceWidth;
        if (next === contentFrom) return null;
        return {
          piece: {
            kind: "text",
            text: this.source.slice(contentFrom, next),
            sourceFrom: contentFrom,
            sourceTo: next,
            sourceBoundaries: Array.from(
              { length: next - contentFrom + 1 },
              (_, index) => contentFrom + index
            ),
            editable: true,
            marks: { ...marks, code: true },
          },
          cursor: next + fenceWidth,
        };
      }
      close = next + candidateWidth;
    }
    return null;
  }

  private runLength(from: number, character: string, to: number): number {
    let cursor = from;
    while (cursor < to && this.source[cursor] === character) cursor += 1;
    return cursor - from;
  }

  private unsafeResourceAt(cursor: number, to: number): ParsedLink | null {
    const bracket = this.source.startsWith("![", cursor) ? cursor + 1 : cursor;
    if (
      this.source[bracket] !== "[" ||
      this.source[bracket + 1] === "[" ||
      (bracket !== cursor && this.source[cursor] !== "!")
    ) {
      return null;
    }
    const label = this.linkLabelAt(bracket, to);
    if (!label) return null;
    const destination = this.linkDestinationAt(label.close + 1, to);
    if (!destination || isSafeLinkTarget(destination.target)) return null;
    return {
      pieces: literalPieces(this.source, cursor, destination.cursor, EMPTY_MARKS).map((piece) => ({
        ...piece,
        unsafe: true as const,
      })),
      cursor: destination.cursor,
    };
  }

  private linkAt(cursor: number, to: number, marks: MarkdownInlineMarks): ParsedLink | null {
    if (this.source[cursor] !== "[" || this.source[cursor + 1] === "[") {
      return null;
    }
    const label = this.linkLabelAt(cursor, to);
    if (!label) return null;
    const destination = this.linkDestinationAt(label.close + 1, to);
    if (!destination || !isSafeLinkTarget(destination.target)) return null;

    const nested = this.parseSequence(cursor + 1, label.close, { ...marks, link: true }, null, []);
    return {
      pieces: nested.pieces.map((piece) => ({
        ...piece,
        linkTarget: destination.target,
      })),
      cursor: destination.cursor,
    };
  }

  private imageAt(
    cursor: number,
    to: number,
    marks: MarkdownInlineMarks
  ): { piece: Piece; cursor: number } | null {
    if (!this.source.startsWith("![", cursor)) return null;
    const label = this.linkLabelAt(cursor + 1, to);
    if (!label) return null;
    const destination = this.linkDestinationAt(label.close + 1, to);
    if (!destination || !isSafeLinkTarget(destination.target)) return null;
    return {
      piece: {
        kind: "image",
        text: "\uFFFC",
        sourceFrom: cursor,
        sourceTo: destination.cursor,
        sourceBoundaries: [cursor, destination.cursor],
        editable: false,
        marks,
        imageAlt: decodeEscapedText(this.source.slice(cursor + 2, label.close)),
        imageTarget: destination.target,
      },
      cursor: destination.cursor,
    };
  }

  /**
   * A CommonMark autolink: `<https://example.com>` or `<someone@example.com>`.
   *
   * Missing entirely, which cost more than a missing link style. The row only mounts the semantic
   * editor when the projection hides something, so a paragraph whose only markup was an autolink
   * projected to itself, failed that test, and fell back to the raw textarea — the angle brackets
   * popped into view the moment the Block was clicked, on a Block that had been showing clean text a
   * moment earlier.
   */
  private autolinkAt(cursor: number, to: number, marks: MarkdownInlineMarks): ParsedLink | null {
    if (this.source[cursor] !== "<") return null;
    const close = this.source.indexOf(">", cursor + 1);
    if (close < 0 || close >= to) return null;

    const body = this.source.slice(cursor + 1, close);
    // No whitespace and no nested `<`: CommonMark's rule, and what keeps `a < b and c > d` prose from
    // being swallowed as a link.
    if (!body || /[\s<]/u.test(body)) return null;

    const isUri = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*$/u.test(body);
    const isEmail =
      /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/u.test(
        body
      );
    if (!isUri && !isEmail) return null;

    const target = isEmail ? `mailto:${body}` : body;
    if (!isSafeLinkTarget(target)) return null;

    // The brackets produce no piece, so they have no visible position — the same way `[[` and `]]`
    // are hidden — and the visible text is the URL the user wrote.
    return {
      pieces: decodedLiteralPieces(this.source, cursor + 1, close, {
        ...marks,
        link: true,
      }).map((piece) => ({ ...piece, linkTarget: target })),
      cursor: close + 1,
    };
  }

  private wikiLinkAt(cursor: number, to: number, marks: MarkdownInlineMarks): ParsedLink | null {
    if (!this.source.startsWith("[[", cursor)) return null;
    let position = cursor + 2;
    let separator = -1;
    while (position < to - 1) {
      if (
        this.source[position] === "\\" &&
        position + 1 < to &&
        isAsciiPunctuation(this.source[position + 1])
      ) {
        position += 2;
        continue;
      }
      if (this.source[position] === "|" && separator < 0) {
        separator = position;
      }
      if (this.source.startsWith("]]", position)) {
        const targetEnd = separator < 0 ? position : separator;
        const target = decodeEscapedText(this.source.slice(cursor + 2, targetEnd)).trim();
        const visibleFrom = separator < 0 ? cursor + 2 : separator + 1;
        if (!target || visibleFrom === position || /[\u0000-\u001f\u007f]/u.test(target)) {
          return null;
        }
        return {
          pieces: decodedLiteralPieces(this.source, visibleFrom, position, {
            ...marks,
            wiki: true,
          }).map((piece) => ({ ...piece, wikiTarget: target })),
          cursor: position + 2,
        };
      }
      position += 1;
    }
    return null;
  }

  private linkLabelAt(cursor: number, to: number): { close: number } | null {
    let depth = 1;
    let position = cursor + 1;
    while (position < to) {
      if (
        this.source[position] === "\\" &&
        position + 1 < to &&
        isAsciiPunctuation(this.source[position + 1])
      ) {
        position += 2;
        continue;
      }
      if (this.source[position] === "[") depth += 1;
      if (this.source[position] === "]") {
        depth -= 1;
        if (depth === 0) {
          return this.source[position + 1] === "(" ? { close: position } : null;
        }
      }
      position += 1;
    }
    return null;
  }

  private linkDestinationAt(open: number, to: number): { target: string; cursor: number } | null {
    if (this.source[open] !== "(") return null;
    let depth = 1;
    let position = open + 1;
    while (position < to) {
      if (
        this.source[position] === "\\" &&
        position + 1 < to &&
        isAsciiPunctuation(this.source[position + 1])
      ) {
        position += 2;
        continue;
      }
      if (this.source[position] === "(") depth += 1;
      if (this.source[position] === ")") {
        depth -= 1;
        if (depth === 0) {
          const target = normalizedLinkTarget(this.source.slice(open + 1, position));
          return target ? { target, cursor: position + 1 } : null;
        }
      }
      if (this.source[position] === "\n" || this.source[position] === "\r") {
        return null;
      }
      position += 1;
    }
    return null;
  }
}

function literalPieces(
  source: string,
  from: number,
  to: number,
  marks: MarkdownInlineMarks
): Piece[] {
  if (to <= from) return [];
  return [
    {
      kind: "text",
      text: source.slice(from, to),
      sourceFrom: from,
      sourceTo: to,
      sourceBoundaries: Array.from({ length: to - from + 1 }, (_, index) => from + index),
      editable: true,
      marks,
    },
  ];
}

function escapedPiece(source: string, from: number, marks: MarkdownInlineMarks): Piece {
  return {
    kind: "text",
    text: source[from + 1],
    sourceFrom: from,
    sourceTo: from + 2,
    sourceBoundaries: [from, from + 2],
    editable: true,
    marks,
  };
}

function decodedLiteralPieces(
  source: string,
  from: number,
  to: number,
  marks: MarkdownInlineMarks
): Piece[] {
  const pieces: Piece[] = [];
  let cursor = from;
  let literalFrom = from;
  while (cursor < to) {
    if (source[cursor] === "\\" && cursor + 1 < to && isAsciiPunctuation(source[cursor + 1])) {
      pieces.push(...literalPieces(source, literalFrom, cursor, marks));
      pieces.push(escapedPiece(source, cursor, marks));
      cursor += 2;
      literalFrom = cursor;
      continue;
    }
    cursor += 1;
  }
  pieces.push(...literalPieces(source, literalFrom, to, marks));
  return pieces;
}

function materialize(pieces: readonly Piece[]): {
  visibleText: string;
  segments: MarkdownInlineSegment[];
  boundaries: Boundary[];
} {
  const segments: MarkdownInlineSegment[] = [];
  const boundaries: Boundary[] = [];
  let visibleText = "";

  for (const piece of mergeAdjacentPieces(pieces)) {
    const visibleFrom = visibleText.length;
    visibleText += piece.text;
    const visibleTo = visibleText.length;
    piece.sourceBoundaries.forEach((source, index) => {
      boundaries.push({ visible: visibleFrom + index, source });
    });
    segments.push(
      piece.kind === "image"
        ? {
            kind: "image",
            text: "\uFFFC",
            sourceFrom: piece.sourceFrom,
            sourceTo: piece.sourceTo,
            visibleFrom,
            visibleTo,
            editable: false,
            marks: piece.marks,
            imageAlt: piece.imageAlt ?? "",
            imageTarget: piece.imageTarget ?? "",
          }
        : {
            kind: "text",
            text: piece.text,
            sourceFrom: piece.sourceFrom,
            sourceTo: piece.sourceTo,
            visibleFrom,
            visibleTo,
            editable: true,
            marks: piece.marks,
            ...(piece.linkTarget ? { linkTarget: piece.linkTarget } : {}),
            ...(piece.wikiTarget ? { wikiTarget: piece.wikiTarget } : {}),
          }
    );
  }

  if (boundaries.length === 0) boundaries.push({ visible: 0, source: 0 });
  return { visibleText, segments, boundaries };
}

function mergeAdjacentPieces(pieces: readonly Piece[]): Piece[] {
  const merged: Piece[] = [];
  for (const piece of pieces) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.kind === "text" &&
      piece.kind === "text" &&
      previous.sourceTo === piece.sourceFrom &&
      previous.editable === piece.editable &&
      previous.linkTarget === piece.linkTarget &&
      previous.wikiTarget === piece.wikiTarget &&
      sameMarks(previous.marks, piece.marks)
    ) {
      merged[merged.length - 1] = {
        ...previous,
        text: `${previous.text}${piece.text}`,
        sourceTo: piece.sourceTo,
        sourceBoundaries: [...previous.sourceBoundaries, ...piece.sourceBoundaries.slice(1)],
      };
      continue;
    }
    merged.push(piece);
  }
  return merged;
}

function sameMarks(left: MarkdownInlineMarks, right: MarkdownInlineMarks): boolean {
  return (
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.strike === right.strike &&
    left.code === right.code &&
    left.link === right.link &&
    left.wiki === right.wiki
  );
}

function normalizeRange(range: Utf16Range, length: number): Utf16Range {
  const from = clampOffset(Math.min(range.from, range.to), length);
  const to = clampOffset(Math.max(range.from, range.to), length);
  return { from, to };
}

function mapVisibleSelection(
  projection: MarkdownInlineProjection,
  selection: Utf16Selection
): Utf16Selection {
  if (selection.anchor === selection.head) {
    const offset = projection.visibleOffsetToSource(selection.anchor, "forward");
    return { anchor: offset, head: offset };
  }
  const forward = selection.anchor < selection.head;
  return {
    anchor: projection.visibleOffsetToSource(selection.anchor, forward ? "forward" : "backward"),
    head: projection.visibleOffsetToSource(selection.head, forward ? "backward" : "forward"),
  };
}

function patchFailure(
  source: string,
  projection: MarkdownInlineProjection,
  selection?: Utf16Selection
): MarkdownInlinePatchResult {
  return {
    source,
    ...(selection ? { selection: mapVisibleSelection(projection, selection) } : {}),
    applied: false,
  };
}

function minimalUtf16Difference(
  oldText: string,
  newText: string
): {
  oldFrom: number;
  oldTo: number;
  newFrom: number;
  newTo: number;
} {
  let prefix = 0;
  const sharedLength = Math.min(oldText.length, newText.length);
  while (prefix < sharedLength && oldText[prefix] === newText[prefix]) {
    prefix += 1;
  }
  prefix = safeUtf16Boundary(oldText, safeUtf16Boundary(newText, prefix));

  let suffix = 0;
  while (
    suffix < oldText.length - prefix &&
    suffix < newText.length - prefix &&
    oldText[oldText.length - suffix - 1] === newText[newText.length - suffix - 1]
  ) {
    suffix += 1;
  }
  const oldTo = safeUtf16Boundary(oldText, oldText.length - suffix);
  const newTo = safeUtf16Boundary(newText, newText.length - suffix);
  return {
    oldFrom: prefix,
    oldTo,
    newFrom: prefix,
    newTo,
  };
}

function safeUtf16Boundary(text: string, offset: number): number {
  const clamped = clampOffset(offset, text.length);
  if (
    clamped > 0 &&
    clamped < text.length &&
    isHighSurrogate(text.charCodeAt(clamped - 1)) &&
    isLowSurrogate(text.charCodeAt(clamped))
  ) {
    return clamped - 1;
  }
  return clamped;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function clampOffset(offset: number, length: number): number {
  if (!Number.isFinite(offset)) return offset < 0 ? 0 : length;
  return Math.min(length, Math.max(0, Math.trunc(offset)));
}

function isWhitespace(character: string): boolean {
  return /\s/u.test(character);
}

function isWordCharacter(character: string): boolean {
  return Boolean(character && /[\p{L}\p{N}]/u.test(character));
}

function isAsciiPunctuation(character: string): boolean {
  return /^[!-/:-@[-`{-~]$/u.test(character);
}

function normalizedLinkTarget(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const targetSource =
    trimmed.startsWith("<") && trimmed.endsWith(">")
      ? trimmed.slice(1, -1)
      : destinationBeforeTitle(trimmed);
  if (!targetSource || /[\u0000-\u001f\u007f]/u.test(targetSource)) return null;
  return targetSource.replace(/\\([!-/:-@[-`{-~])/gu, "$1");
}

function destinationBeforeTitle(source: string): string {
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\\" && index + 1 < source.length) {
      index += 1;
      continue;
    }
    if (source[index] === "(") depth += 1;
    if (source[index] === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && isWhitespace(source[index])) {
      return source.slice(0, index);
    }
  }
  return source;
}

function isSafeLinkTarget(target: string): boolean {
  const schemeMatch = target.match(/^([A-Za-z][A-Za-z0-9+.-]*):/u);
  if (!schemeMatch) return true;
  return ["http", "https", "mailto", "file"].includes(schemeMatch[1].toLowerCase());
}

function decodeEscapedText(source: string): string {
  return source.replace(/\\([!-/:-@[-`{-~])/gu, "$1");
}

/**
 * Escape what the user typed so it stays literal in the source.
 *
 * Deliberately not `!`. The only thing a bare `!` can start is an image, and that needs a `[` right
 * after it — which this function already escapes, so the `!` can never reach its syntax. Escaping it
 * anyway put a backslash the user never typed into their file: typing `!` at the end of a paragraph
 * wrote `\!`. It renders the same, so nothing looked wrong, but the bytes on disk stopped being the
 * bytes the user wrote, and this Page format is the file.
 */
function escapeVisibleMarkdown(text: string): string {
  return text.replace(/[\\*_~`[\]|]/gu, "\\$&");
}
