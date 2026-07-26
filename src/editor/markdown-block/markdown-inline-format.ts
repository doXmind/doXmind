import type { InlineFormatState } from "@/editor/markdown-block/inline-format-toolbar";

export type MarkdownInlineFormat = "bold" | "italic" | "strike" | "link" | "code";

export interface MarkdownInlineFormatEdit {
  from: number;
  to: number;
  text: string;
  selection: { anchor: number; head: number };
}

interface Wrapper {
  open: string;
  close: string;
}

interface InlineResource {
  kind: "image" | "link";
  from: number;
  to: number;
  labelFrom: number;
  labelTo: number;
}

interface InlineCodeSpan {
  from: number;
  to: number;
}

const SIMPLE_WRAPPERS: Record<Exclude<MarkdownInlineFormat, "link" | "code">, Wrapper> = {
  bold: { open: "**", close: "**" },
  italic: { open: "*", close: "*" },
  strike: { open: "~~", close: "~~" },
};

export function createMarkdownInlineFormatEdit(
  source: string,
  from: number,
  to: number,
  format: MarkdownInlineFormat
): MarkdownInlineFormatEdit | null {
  if (from < 0 || to <= from || to > source.length) return null;
  const codeSpan = inlineCodeSpanOverlappingSelection(source, from, to);
  // Toggling code off. The toolbar reports code for any selection the span contains, including one
  // whose ends straddle a delimiter — an inline code chip is drawn with padding, so a drag beginning
  // a pixel inside its left edge anchors outside the opening backtick. The untoggle has to accept the
  // same set the toolbar lights up for; a pressed button that does nothing is worse than an unlit one.
  //
  // Unwrap the span, not the selection: the selection's ends are exactly what is unreliable here, so
  // the delimiters are found from the span. This is also why a selection covering a whole chip removes
  // its code rather than nesting a longer fence around the literal backticks — the semantic editor
  // hides the delimiters, so a drag over a chip means "this chip", never "these six characters".
  if (format === "code" && codeSpan && selectionIsInlineCode(source, from, to)) {
    const fence = backtickRunLength(source, codeSpan.from);
    const content = source.slice(codeSpan.from + fence, codeSpan.to - fence);
    // A multi-backtick fence pads its content by one space either side so the content's own backticks
    // cannot close it. Those spaces belong to the fence, so they leave with it.
    const bare =
      fence > 1 && content.startsWith(" ") && content.endsWith(" ")
        ? content.slice(1, -1)
        : content;
    return {
      from: codeSpan.from,
      to: codeSpan.to,
      text: bare,
      selection: { anchor: codeSpan.from, head: codeSpan.from + bare.length },
    };
  }

  // Every legitimate code selection has returned by now. Anything else that touches a span would
  // rewrite one end of it and leave the other, so refuse rather than corrupt the source.
  if (codeSpan) return null;

  const resource = inlineResourceOverlappingSelection(source, from, to);
  if (
    resource &&
    (resource.kind === "image" ||
      format !== "link" ||
      from !== resource.labelFrom ||
      to !== resource.labelTo)
  ) {
    return null;
  }
  if (format === "link") return createLinkEdit(source, from, to);
  const wrapper = format === "code" ? codeWrapper(source.slice(from, to)) : SIMPLE_WRAPPERS[format];
  const selected = source.slice(from, to);
  // Code is fully handled above; the arithmetic here removes exactly `wrapper.open.length` characters
  // either side of the selection, which only holds for wrappers that abut it.
  const activeState = markdownInlineFormatState(source, from, to);
  if (format !== "code" && activeState[format]) {
    const editFrom = from - wrapper.open.length;
    return {
      from: editFrom,
      to: to + wrapper.close.length,
      text: selected,
      selection: { anchor: editFrom, head: editFrom + selected.length },
    };
  }

  const spacedCode = format === "code" && wrapper.open.length > 1;
  const prefix = spacedCode ? `${wrapper.open} ` : wrapper.open;
  const suffix = spacedCode ? ` ${wrapper.close}` : wrapper.close;
  return {
    from,
    to,
    text: `${prefix}${selected}${suffix}`,
    selection: {
      anchor: from + prefix.length,
      head: from + prefix.length + selected.length,
    },
  };
}

export function markdownInlineFormatState(
  source: string,
  from: number,
  to: number
): InlineFormatState {
  const wraps = (wrapper: Wrapper) =>
    from >= wrapper.open.length &&
    source.slice(from - wrapper.open.length, from) === wrapper.open &&
    source.slice(to, to + wrapper.close.length) === wrapper.close;
  const linkClose = linkCloseAfter(source, to);
  const emphasis = emphasisRunsAround(source, from, to);
  return {
    bold: emphasis >= 2,
    italic: emphasis % 2 === 1,
    strike: wraps(SIMPLE_WRAPPERS.strike),
    link: from > 0 && source[from - 1] === "[" && !isImageLabel(source, from) && linkClose !== null,
    code: selectionIsInlineCode(source, from, to),
  };
}

/**
 * Length of the emphasis run wrapping the selection, in either `*` or `_`.
 *
 * `_` used to be missing, which mattered more than it sounds: it is Prettier's default emphasis
 * character, so `_italic_` is what most formatted files actually contain. The preview rendered those
 * words in italics and the toolbar reported nothing, and pressing Italic on one wrapped it again —
 * `_*important*_` — leaving the text looking unchanged and the source worse.
 *
 * The intraword rule is CommonMark's and, more to the point, is already what
 * `markdown-inline-projection.ts` uses to decide what to render, so `snake_case_name` is not
 * emphasis here either. The two have to agree; a toolbar that contradicts the text under it is the
 * same defect in the other direction.
 */
function emphasisRunsAround(source: string, from: number, to: number): number {
  for (const mark of ["*", "_"] as const) {
    const opening = source.slice(0, from).match(mark === "*" ? /\*+$/ : /_+$/)?.[0].length ?? 0;
    const closing = source.slice(to).match(mark === "*" ? /^\*+/ : /^_+/)?.[0].length ?? 0;
    const run = Math.min(opening, closing);
    if (run === 0) continue;
    if (mark === "_") {
      const beforeOpening = source[from - run - 1] ?? "";
      const afterClosing = source[to + run] ?? "";
      const intrawordOpen = isWordCharacter(beforeOpening) && isWordCharacter(source[from] ?? "");
      const intrawordClose = isWordCharacter(source[to - 1] ?? "") && isWordCharacter(afterClosing);
      if (intrawordOpen || intrawordClose) continue;
    }
    return run;
  }
  return 0;
}

function isWordCharacter(character: string): boolean {
  return /[\p{L}\p{N}]/u.test(character);
}

function createLinkEdit(source: string, from: number, to: number): MarkdownInlineFormatEdit | null {
  const selected = source.slice(from, to);
  if (hasUnescapedCharacter(selected, "]")) return null;
  const close = linkCloseAfter(source, to);
  if (isImageLabel(source, from) && close !== null) return null;
  if (from > 0 && source[from - 1] === "[" && !isImageLabel(source, from) && close !== null) {
    // Toggling off an existing link unwraps it back to its label.
    return {
      from: from - 1,
      to: close,
      text: selected,
      selection: { anchor: from - 1, head: from - 1 + selected.length },
    };
  }
  // Applying a link needs a destination, which only the user has. `createMarkdownLinkEdit` takes
  // one; writing `[label](https://)` here produced a link that goes nowhere and, worse, put the
  // selection over the label so the next keystroke rewrote the text instead of the URL.
  return null;
}

/**
 * Wrap a selection in a link with a real destination.
 *
 * Separate from the toggle path in `createMarkdownInlineFormatEdit` because applying a link is the
 * one inline format that needs input beyond the selection itself.
 */
export function createMarkdownLinkEdit(
  source: string,
  from: number,
  to: number,
  url: string
): MarkdownInlineFormatEdit | null {
  if (from < 0 || to < from || to > source.length) return null;
  const destination = url.trim();
  if (!destination) return null;
  const selected = source.slice(from, to);
  if (hasUnescapedCharacter(selected, "]")) return null;
  if (inlineCodeSpanOverlappingSelection(source, from, to)) return null;
  const existing = inlineResourceOverlappingSelection(source, from, to);
  if (existing) {
    // Retarget a link the selection already sits inside, rather than nesting one inside another.
    if (existing.kind === "image") return null;
    const label = source.slice(existing.labelFrom, existing.labelTo);
    const text = `[${label}](${encodeLinkDestination(destination)})`;
    return {
      from: existing.from,
      to: existing.to,
      text,
      selection: { anchor: existing.from, head: existing.from + text.length },
    };
  }
  const label = selected || destination;
  const text = `[${label}](${encodeLinkDestination(destination)})`;
  return {
    from,
    to,
    text,
    selection: { anchor: from + 1, head: from + 1 + label.length },
  };
}

/** Wrap a destination in angle brackets when it contains characters that would end it early. */
function encodeLinkDestination(url: string): string {
  return /[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, "")}>` : url;
}

function isImageLabel(source: string, from: number): boolean {
  return from > 1 && source[from - 2] === "!" && !isEscaped(source, from - 2);
}

function linkCloseAfter(source: string, to: number): number | null {
  if (source.slice(to, to + 2) !== "](" || isEscaped(source, to)) return null;
  return parenthesizedClose(source, to + 1);
}

function parenthesizedClose(source: string, open: number): number | null {
  if (source[open] !== "(" || isEscaped(source, open)) return null;
  let depth = 1;
  for (let index = open + 1; index < source.length; index += 1) {
    if (isEscaped(source, index)) continue;
    if (source[index] === "(") {
      depth += 1;
    } else if (source[index] === ")") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return null;
}

function inlineResourceOverlappingSelection(
  source: string,
  from: number,
  to: number
): InlineResource | null {
  for (let open = 0; open < source.length; open += 1) {
    if (source[open] !== "[" || isEscaped(source, open)) continue;
    const labelTo = closingBracket(source, open);
    if (labelTo === null || source[labelTo + 1] !== "(") continue;
    const resourceTo = parenthesizedClose(source, labelTo + 1);
    if (resourceTo === null) continue;
    const image = open > 0 && source[open - 1] === "!" && !isEscaped(source, open - 1);
    const resource: InlineResource = {
      kind: image ? "image" : "link",
      from: image ? open - 1 : open,
      to: resourceTo,
      labelFrom: open + 1,
      labelTo,
    };
    if (from < resource.to && to > resource.from) return resource;
    open = resourceTo - 1;
  }
  return null;
}

function closingBracket(source: string, open: number): number | null {
  let depth = 1;
  for (let index = open + 1; index < source.length; index += 1) {
    if (isEscaped(source, index)) continue;
    if (source[index] === "[") {
      depth += 1;
    } else if (source[index] === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function isEscaped(source: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function hasUnescapedCharacter(source: string, character: string): boolean {
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === character && !isEscaped(source, index)) return true;
  }
  return false;
}

function codeWrapper(selected: string): Wrapper {
  const runs = selected.match(/`+/g) ?? [];
  const length = Math.max(1, ...runs.map((run) => run.length + 1));
  const fence = "`".repeat(length);
  return { open: fence, close: fence };
}

/**
 * Whether a selection is inside a code span, allowing its ends to sit on the delimiters.
 *
 * The question the toolbar asks is what the selection is already in, which is looser than what the
 * edit path used to test — that the selection is *exactly* a span's content. An inline code chip is drawn with padding, so a drag that begins a pixel inside its
 * left edge anchors in the *preceding* text node, one character before the opening backtick, and the
 * strict test then reported no code at all: selecting a `project-collage-v3.json` chip left the
 * toolbar's code button unlit even though the whole chip was highlighted.
 *
 * Anything the span fully contains counts, and so does a selection that swallows the delimiters
 * themselves, which is what a drag from just outside either edge produces.
 */
function selectionIsInlineCode(source: string, from: number, to: number): boolean {
  const span = inlineCodeSpanOverlappingSelection(source, from, to);
  if (!span) return false;
  const fence = backtickRunLength(source, span.from);
  const contentFrom = span.from + fence;
  const contentTo = span.to - fence;
  // Inside the content, or a selection that reaches out over the delimiters but no further.
  const insideContent = from >= contentFrom && to <= contentTo;
  const wrapsWholeSpan =
    from >= span.from && to <= span.to && from <= contentFrom && to >= contentTo;
  return insideContent || wrapsWholeSpan;
}

function inlineCodeSpanOverlappingSelection(
  source: string,
  from: number,
  to: number
): InlineCodeSpan | null {
  for (let index = 0; index < source.length;) {
    if (source[index] !== "`" || isEscaped(source, index)) {
      index += 1;
      continue;
    }

    const fenceLength = backtickRunLength(source, index);
    const contentFrom = index + fenceLength;
    let cursor = contentFrom;
    while (cursor < source.length) {
      if (source[cursor] !== "`" || isEscaped(source, cursor)) {
        cursor += 1;
        continue;
      }
      const closingLength = backtickRunLength(source, cursor);
      if (closingLength === fenceLength) {
        const codeSpan = { from: index, to: cursor + closingLength };
        if (from < codeSpan.to && to > codeSpan.from) return codeSpan;
        index = cursor + closingLength;
        break;
      }
      cursor += closingLength;
    }
    if (cursor >= source.length) return null;
  }
  return null;
}

function backtickRunLength(source: string, from: number): number {
  let to = from;
  while (source[to] === "`") to += 1;
  return to - from;
}
