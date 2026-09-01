/**
 * Obsidian-style search syntax, parsed in the renderer into criteria the workspace scan evaluates.
 *
 * Supported: `file:` `path:` `tag:` `content:`, a leading `-` to negate any term, `OR` between
 * terms (looser than the implicit AND), `"quoted phrases"`, and `/regex/flags`.
 *
 * Deliberately absent, so nobody re-derives them as oversights: `line:` and `section:` need a
 * structural index this search does not build; `task:` needs the Block kinds; and parentheses need
 * a real grammar rather than the two precedence levels here. A query using one of those falls
 * through to a plain content term, which finds the literal text rather than failing.
 */

export type SearchField = "content" | "file" | "path" | "tag";

export interface SearchTerm {
  field: SearchField;
  /** Lower-cased for every field but `regex`, which keeps the user's case unless `i` is set. */
  value: string;
  negated: boolean;
  regex: RegExp | null;
}

export interface SearchCriteria {
  /** Every group must match; within a group, any one term is enough. `OR` opens a new alternative. */
  groups: SearchTerm[][];
}

export interface ParsedSearchQuery {
  criteria: SearchCriteria;
  /** The plain text left over, for highlighting and for the backend's own prefilter. */
  text: string;
  error: string | null;
}

/** Only flags that cannot make a pattern catastrophically expensive or stateful. */
const ALLOWED_REGEX_FLAGS = /^[imsu]*$/;

export function parseSearchQuery(input: string): ParsedSearchQuery {
  const groups: SearchTerm[][] = [];
  const plain: string[] = [];
  let error: string | null = null;
  // `a OR b c` is `(a OR b) AND c`: an OR joins the term after it to the group before it.
  let joinPrevious = false;

  for (const token of tokenizeSearchQuery(input)) {
    if (token.toUpperCase() === "OR") {
      joinPrevious = groups.length > 0;
      continue;
    }
    const parsed = parseTerm(token);
    if (!parsed) continue;
    if (parsed.error) {
      error = parsed.error;
      continue;
    }
    const { term } = parsed;
    // Only a bare positive content word is worth highlighting; the rest are constraints.
    if (term.field === "content" && !term.negated && !term.regex) plain.push(term.value);

    if (joinPrevious) groups[groups.length - 1].push(term);
    else groups.push([term]);
    joinPrevious = false;
  }

  return { criteria: { groups }, text: plain.join(" "), error };
}

function parseTerm(token: string): { term: SearchTerm; error?: string } | null {
  let rest = token;
  let negated = false;
  if (rest.startsWith("-") && rest.length > 1) {
    negated = true;
    rest = rest.slice(1);
  }

  let field: SearchField = "content";
  const colon = rest.indexOf(":");
  if (colon > 0) {
    const candidate = rest.slice(0, colon).toLowerCase();
    if (
      candidate === "file" ||
      candidate === "path" ||
      candidate === "tag" ||
      candidate === "content"
    ) {
      field = candidate;
      rest = rest.slice(colon + 1);
    }
  }

  rest = unquote(rest);
  if (!rest) return null;

  const asRegex = rest.length > 1 && rest.startsWith("/") && rest.lastIndexOf("/") > 0;
  if (asRegex) {
    const close = rest.lastIndexOf("/");
    const flags = rest.slice(close + 1);
    if (!ALLOWED_REGEX_FLAGS.test(flags)) {
      return {
        term: { field, value: rest, negated, regex: null },
        error: `Unsupported regex flags: ${flags}`,
      };
    }
    try {
      const regex = new RegExp(rest.slice(1, close), flags);
      return { term: { field, value: rest, negated, regex } };
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return { term: { field, value: rest, negated, regex: null }, error: detail };
    }
  }

  return { term: { field, value: rest.toLowerCase(), negated, regex: null } };
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  return value;
}

/** Split on whitespace, keeping `"a b"` and `/a b/` together. */
export function tokenizeSearchQuery(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "/" | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (
      char === '"' ||
      (char === "/" && (current === "" || current.endsWith(":") || current === "-"))
    ) {
      quote = char as '"' | "/";
      current += char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * Whether the query says something a plain word could not.
 *
 * A field prefix, a negation or a regex is a complete query however short — `tag:x` must not wait
 * for a third character — while a bare word still has to clear the minimum length, because one
 * letter matches most of a workspace.
 */
export function hasStructuredCriteria(criteria: SearchCriteria): boolean {
  return criteria.groups.some((group) =>
    group.some((term) => term.field !== "content" || term.negated || term.regex !== null)
  );
}
