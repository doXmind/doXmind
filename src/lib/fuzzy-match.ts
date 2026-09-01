/**
 * Feishu-style relevance tiers, shared by every list the user filters by typing.
 *
 * The tiers are declaration-order-independent: a stronger kind of match wins wherever it is found,
 * so `bt` reaches "Bulleted list" by initials and `tbl` reaches "Table" as a subsequence.
 */
export const SCORE_PREFIX = 100;
export const SCORE_CONTAINS = 60;
export const SCORE_ACRONYM = 45;

/**
 * Score one already-lowercased candidate against an already-lowercased query.
 *
 * Both sides are normalized by the caller — `query.trim().toLocaleLowerCase()` — because a list
 * scores many candidates per keystroke and re-lowercasing the query each time is wasted work.
 */
export function scoreFuzzyText(text: string, query: string): number {
  if (text.startsWith(query)) return SCORE_PREFIX;
  if (text.includes(query)) return SCORE_CONTAINS;
  if (matchesAcronym(text, query)) return SCORE_ACRONYM;
  return 0;
}

/** `bl` matches "Bulleted list" by word initials, `tbl` matches "Table" as a subsequence. */
function matchesAcronym(text: string, query: string): boolean {
  const acronym = text
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((word) => word[0])
    .join("");
  if (acronym === query) return true;
  return isSubsequence(text.replace(/\s+/g, ""), query);
}

function isSubsequence(haystack: string, needle: string): boolean {
  let cursor = 0;
  for (const character of haystack) {
    if (character === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return true;
  }
  return false;
}
