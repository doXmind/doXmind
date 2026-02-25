/**
 * Word-Level Diff Computation
 *
 * Computes word-level diffs between old and new text for Notion-style
 * inline diff visualization. Uses jsdiff's diffWords algorithm.
 */

import { diffWords } from "diff";

export interface WordDiffSegment {
  text: string;
  type: "equal" | "added" | "removed";
}

/**
 * Compute word-level diff between old and new plain text.
 * Returns an array of segments indicating equal, added, or removed text.
 *
 * @param oldText - Original plain text
 * @param newText - New plain text
 * @returns Array of diff segments
 */
export function computeWordDiff(oldText: string, newText: string): WordDiffSegment[] {
  if (!oldText && !newText) return [];
  if (!oldText) return [{ text: newText, type: "added" }];
  if (!newText) return [{ text: oldText, type: "removed" }];

  const changes = diffWords(oldText, newText);

  return changes.map((change) => ({
    text: change.value,
    type: change.added ? "added" : change.removed ? "removed" : "equal",
  }));
}
