/**
 * Search Algorithm Functions
 *
 * Pure functions for text search operations:
 * - Keyword search with regex
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { SearchRange } from "./search-types";

/**
 * Escape special regex characters in a string
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a regex from search term with case sensitivity, whole word, and regex options
 */
export function getRegex(
  searchTerm: string,
  caseSensitive: boolean,
  wholeWord: boolean = false,
  useRegex: boolean = false
): RegExp | null {
  // Whitespace is a legitimate thing to search for; only an empty term is a no-op.
  if (!searchTerm) return null;
  try {
    let pattern: string;
    if (useRegex) {
      pattern = searchTerm;
    } else {
      pattern = escapeRegExp(searchTerm);
    }
    if (wholeWord) {
      pattern = `\\b${pattern}\\b`;
    }
    return new RegExp(pattern, caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

/**
 * Placeholder for inline leaf nodes (inline math, mentions) when flattening a
 * textblock. Every inline leaf has nodeSize 1, so a single character keeps the
 * flattened string index-aligned with document positions, and the character
 * itself is one a user will not be searching for.
 */
const LEAF_PLACEHOLDER = "￼";

/**
 * Find all keyword matches in a ProseMirror document.
 * Matching runs over each textblock's concatenated inline text, so a match is
 * found even when marks split it into several text nodes (`**nee**dle`).
 * Also searches inside atom node attributes (mermaid code, math latex).
 */
export function processSearches(
  doc: PMNode,
  searchTerm: string,
  caseSensitive: boolean,
  wholeWord: boolean = false,
  useRegex: boolean = false
): SearchRange[] {
  const results: SearchRange[] = [];
  const regex = getRegex(searchTerm, caseSensitive, wholeWord, useRegex);

  if (!regex) return results;

  doc.descendants((node, pos) => {
    // Text nodes are matched through their parent textblock, never on their own.
    if (node.isText) return false;

    if (node.isTextblock) {
      const text = node.textBetween(0, node.content.size, undefined, LEAF_PLACEHOLDER);
      const contentStart = pos + 1;
      regex.lastIndex = 0;
      for (const match of text.matchAll(regex)) {
        if (match.index === undefined || match[0].length === 0) continue;
        results.push({
          from: contentStart + match.index,
          to: contentStart + match.index + match[0].length,
        });
      }
      // Keep descending: inline atoms inside the block are searched below.
    }

    // Search inside atom nodes with content in attributes (mermaid charts, math blocks)
    if (node.isAtom) {
      const attrText = (node.attrs.code as string) || (node.attrs.latex as string) || "";
      if (!attrText) return;

      // Reset regex lastIndex for re-use
      regex.lastIndex = 0;
      if (regex.test(attrText)) {
        // Highlight the entire atom node (can't select text within it)
        results.push({ from: pos, to: pos + node.nodeSize });
      }
    }
  });

  // Textblock matches are collected before the atoms nested inside them.
  return results.sort((a, b) => a.from - b.from);
}
