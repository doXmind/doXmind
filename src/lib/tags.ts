/**
 * Obsidian's inline `#tag` grammar.
 *
 * A tag is `#` followed by letters, digits, `_`, `-` or `/`, and must contain at least one
 * character that is not a digit — `#1984` is a year, not a tag. It only opens after whitespace or
 * at the start of a line, which is what keeps `C#` and `src/lib#anchor` out of it.
 *
 * `/` nests: a Page tagged `project/web` answers to `project` as well, so a pane can group them
 * and `tag:project` can find them.
 *
 * This grammar is implemented twice — here for the renderer, and again in
 * `electron/native-workspace.js`, which is CommonJS in the main process and cannot import this.
 * `tests/fixtures/page-tag-contract.json` is what keeps the two honest.
 */

/**
 * The body of a tag, after the `#`.
 *
 * Unicode letters, not just ASCII: `#项目` is a tag in Obsidian and in any workspace not written in
 * English, and an ASCII-only class would silently drop every one of them.
 */
const TAG_BODY = /^[\p{L}\p{N}_\-/]+/u;

/** Whether `body` can be a tag at all: at least one non-digit, no empty path segment. */
export function isTagBody(body: string): boolean {
  if (!body || !/[^\p{Nd}/]/u.test(body)) return false;
  if (body.startsWith("/") || body.endsWith("/") || body.includes("//")) return false;
  return true;
}

/** Whether a `#` at `index` may open a tag, given what precedes it. */
export function canOpenTagAt(source: string, index: number): boolean {
  const previous = index > 0 ? source[index - 1] : "";
  return !previous || /[\s(（【[「]/.test(previous);
}

/**
 * The tag starting at `index`, or null.
 *
 * `end` is exclusive, so the caller can splice or mask exactly the run the tag occupies.
 */
export function tagAt(source: string, index: number): { name: string; end: number } | null {
  if (source[index] !== "#" || !canOpenTagAt(source, index)) return null;
  const body = TAG_BODY.exec(source.slice(index + 1))?.[0] ?? "";
  if (!isTagBody(body)) return null;
  return { name: body, end: index + 1 + body.length };
}

/** Every tag in one line of prose, in order. Callers mask code and links before calling. */
export function tagsInText(source: string): { name: string; from: number; to: number }[] {
  const found: { name: string; from: number; to: number }[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "#") continue;
    const tag = tagAt(source, index);
    if (!tag) continue;
    found.push({ name: tag.name, from: index, to: tag.end });
    index = tag.end - 1;
  }
  return found;
}

/**
 * A tag and every ancestor of it, lower-cased.
 *
 * `project/web` counts towards `project` too, which is what makes a pane groupable and
 * `tag:project` find its children.
 */
export function tagWithAncestors(name: string): string[] {
  const tag = name.trim().toLowerCase().replace(/^#/, "");
  if (!tag) return [];
  const parts = tag.split("/");
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

/** Counts per tag across a workspace, ancestors included. */
export function countTags(pages: readonly { tags?: readonly string[] }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const page of pages) {
    // A Page tagged both `a/b` and `a/c` counts once towards `a`, not twice.
    const seen = new Set<string>();
    for (const tag of page.tags ?? []) {
      for (const name of tagWithAncestors(tag)) seen.add(name);
    }
    for (const name of seen) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}
