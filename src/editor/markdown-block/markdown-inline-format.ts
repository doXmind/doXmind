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
  const activeFence = codeFenceAround(source, from, to);
  const codeSpan = inlineCodeSpanOverlappingSelection(source, from, to);
  if (
    codeSpan &&
    (format !== "code" || (!activeFence && (from !== codeSpan.from || to !== codeSpan.to)))
  ) {
    return null;
  }
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
  if (format === "code") {
    if (activeFence) {
      const before = source.slice(0, from).match(/(`+)[ ]?$/)?.[0] ?? activeFence;
      const after = source.slice(to).match(/^[ ]?(`+)/)?.[0] ?? activeFence;
      const editFrom = from - before.length;
      const selected = source.slice(from, to);
      return {
        from: editFrom,
        to: to + after.length,
        text: selected,
        selection: { anchor: editFrom, head: editFrom + selected.length },
      };
    }
  }

  const wrapper = format === "code" ? codeWrapper(source.slice(from, to)) : SIMPLE_WRAPPERS[format];
  const selected = source.slice(from, to);
  const activeState = markdownInlineFormatState(source, from, to);
  if (activeState[format]) {
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
  const stars = starRunsAround(source, from, to);
  return {
    bold: stars >= 2,
    italic: stars % 2 === 1,
    strike: wraps(SIMPLE_WRAPPERS.strike),
    link: from > 0 && source[from - 1] === "[" && !isImageLabel(source, from) && linkClose !== null,
    code: codeFenceAround(source, from, to) !== null,
  };
}

function starRunsAround(source: string, from: number, to: number): number {
  const before = source.slice(0, from).match(/\*+$/)?.[0].length ?? 0;
  const after = source.slice(to).match(/^\*+/)?.[0].length ?? 0;
  return Math.min(before, after);
}

function createLinkEdit(source: string, from: number, to: number): MarkdownInlineFormatEdit | null {
  const selected = source.slice(from, to);
  if (hasUnescapedCharacter(selected, "]")) return null;
  const close = linkCloseAfter(source, to);
  if (isImageLabel(source, from) && close !== null) return null;
  if (from > 0 && source[from - 1] === "[" && !isImageLabel(source, from) && close !== null) {
    return {
      from: from - 1,
      to: close,
      text: selected,
      selection: { anchor: from - 1, head: from - 1 + selected.length },
    };
  }
  return {
    from,
    to,
    text: `[${selected}](https://)`,
    selection: { anchor: from + 1, head: to + 1 },
  };
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

function codeFenceAround(source: string, from: number, to: number): string | null {
  const before = source.slice(0, from).match(/(`+)[ ]?$/);
  if (!before) return null;
  const after = source.slice(to).match(/^[ ]?(`+)/);
  return after && before[1] === after[1] ? before[1] : null;
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
