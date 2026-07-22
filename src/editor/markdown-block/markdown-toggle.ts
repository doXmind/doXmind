export interface MarkdownToggle {
  open: boolean;
  summary: string;
  markdown: string;
}

const DETAILS_OPENING = /^ {0,3}<details(?:[ \t]+open)?[ \t]*>$/i;
const DETAILS_CLOSING = /^ {0,3}<\/details[ \t]*>$/i;

/** Portable toggle grammar: an ordinary HTML details block with Markdown inside. */
export function parseMarkdownToggle(source: string): MarkdownToggle | null {
  const content = source.replace(/(?:(?:\r\n)|\n|\r)+$/, "");
  const lines = content.split(/\r\n|\n|\r/);
  if (lines.length < 3 || !isMarkdownToggleOpeningLine(lines[0])) return null;
  if (!isMarkdownToggleClosingLine(lines.at(-1) ?? "")) return null;

  const summary = lines[1].match(/^ {0,3}<summary>(.*)<\/summary>[ \t]*$/i);
  if (!summary) return null;

  const body = lines.slice(2, -1);
  if (body[0]?.trim() === "") body.shift();
  if (body.at(-1)?.trim() === "") body.pop();
  return {
    open: /[ \t]open[ \t]*>$/i.test(lines[0]),
    summary: summary[1],
    markdown: body.join("\n"),
  };
}

export function markdownToggleTemplate(lineEnding: "\r\n" | "\n" | "\r" = "\n"): string {
  return ["<details>", "<summary>Toggle</summary>", "", "Write something…", "", "</details>"].join(
    lineEnding
  );
}

export function isMarkdownToggleOpeningLine(line: string): boolean {
  return DETAILS_OPENING.test(line);
}

export function isMarkdownToggleClosingLine(line: string): boolean {
  return DETAILS_CLOSING.test(line);
}
