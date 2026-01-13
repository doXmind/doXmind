/**
 * Position Mapper
 *
 * Functions for mapping positions between text content and ProseMirror documents.
 */

import type { DiffHunk } from "@/types/diff";

/**
 * ProseMirror document interface for position mapping
 */
export interface DocWithContent {
  textContent: string;
  nodeSize: number;
}

/**
 * Find text position in ProseMirror document by searching for the text content.
 * This is a simplified approach that works for most cases.
 *
 * @param doc - ProseMirror document
 * @param searchText - Text to find
 * @returns Position range { from, to } or null if not found
 */
export function findTextInDoc(
  doc: DocWithContent,
  searchText: string
): { from: number; to: number } | null {
  const text = doc.textContent;
  const index = text.indexOf(searchText);

  if (index === -1) {
    // Try with normalized whitespace
    const normalizedText = text.replace(/\s+/g, " ");
    const normalizedSearch = searchText.replace(/\s+/g, " ");
    const normalizedIndex = normalizedText.indexOf(normalizedSearch);

    if (normalizedIndex === -1) {
      return null;
    }

    // Map back to original position (approximate)
    return {
      from: normalizedIndex + 1, // ProseMirror positions are 1-indexed for doc content
      to: normalizedIndex + searchText.length + 1,
    };
  }

  // ProseMirror document content starts at position 1 (after the doc node)
  return {
    from: index + 1,
    to: index + searchText.length + 1,
  };
}

/**
 * Find line position in ProseMirror document.
 * Returns the position at the start of the specified line.
 *
 * @param doc - ProseMirror document
 * @param lineNumber - 0-indexed line number
 * @returns Position or document end if line doesn't exist
 */
export function findLinePosition(
  doc: DocWithContent,
  lineNumber: number
): number {
  const text = doc.textContent;
  const lines = text.split("\n");

  if (lineNumber <= 0) {
    return 1; // Start of document content
  }

  if (lineNumber >= lines.length) {
    return doc.nodeSize - 2; // End of document content
  }

  // Calculate position by summing lengths of previous lines
  let pos = 1; // Start after doc node
  for (let i = 0; i < lineNumber; i++) {
    pos += lines[i].length + 1; // +1 for newline
  }

  return pos;
}

/**
 * Map hunk positions after a document change.
 * Uses a simple offset-based approach.
 *
 * @param hunks - Array of hunks to update
 * @param changeFrom - Position where change occurred
 * @param oldLength - Length of removed content
 * @param newLength - Length of inserted content
 * @returns Updated hunks with new positions
 */
export function mapHunkPositions(
  hunks: DiffHunk[],
  changeFrom: number,
  oldLength: number,
  newLength: number
): DiffHunk[] {
  const offset = newLength - oldLength;

  return hunks.map((hunk) => {
    // If hunk is before the change, no adjustment needed
    if (hunk.to <= changeFrom) {
      return hunk;
    }

    // If hunk is after the change, shift both positions
    if (hunk.from >= changeFrom + oldLength) {
      return {
        ...hunk,
        from: hunk.from + offset,
        to: hunk.to + offset,
      };
    }

    // If hunk overlaps with change, it's been modified - mark as processed
    // This shouldn't happen in normal usage but handles edge cases
    return {
      ...hunk,
      status: "rejected" as const,
    };
  });
}

/**
 * Find text with fuzzy matching (handles whitespace differences)
 */
export function fuzzyIndexOf(haystack: string, needle: string): number {
  // First try exact match
  let index = haystack.indexOf(needle);
  if (index !== -1) return index;

  // Try with normalized whitespace
  const normalizedHaystack = haystack.replace(/\s+/g, " ").trim();
  const normalizedNeedle = needle.replace(/\s+/g, " ").trim();

  index = normalizedHaystack.indexOf(normalizedNeedle);
  if (index !== -1) {
    // Map back to original position (approximate)
    // Find the first occurrence that's close to this position
    const words = normalizedNeedle.split(" ");
    if (words.length > 0) {
      const firstWord = words[0];
      let searchStart = 0;
      while (searchStart < haystack.length) {
        const wordIndex = haystack.indexOf(firstWord, searchStart);
        if (wordIndex === -1) break;
        // Check if this is roughly the right position
        const normalizedPos = haystack.slice(0, wordIndex).replace(/\s+/g, " ").trim().length;
        if (Math.abs(normalizedPos - index) < 10) {
          return wordIndex;
        }
        searchStart = wordIndex + 1;
      }
    }
    return index;
  }

  return -1;
}
