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
  if (!searchTerm.trim()) return null;
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
 * Find all keyword matches in a ProseMirror document.
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
    if (node.isText && node.text) {
      const matches = [...node.text.matchAll(regex)];
      matches.forEach((match) => {
        if (match.index !== undefined) {
          results.push({
            from: pos + match.index,
            to: pos + match.index + match[0].length,
          });
        }
      });
      return;
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

  return results;
}
