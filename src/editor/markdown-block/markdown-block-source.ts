/** Exact source exposed to a Block editor, excluding its authored Page separator. */
export function editableMarkdownBlockSource(raw: string): string {
  const separator = raw.match(/((?:\r\n|\n|\r)(?:[ \t]*(?:\r\n|\n|\r))*[ \t]*)$/)?.[1];
  return separator ? raw.slice(0, -separator.length) : raw;
}
