/**
 * Diff Review Extension - Position Mapping Utilities
 *
 * Functions for finding text positions in ProseMirror documents,
 * accounting for node boundaries.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { TextPosition } from "./diff-types";

/**
 * Find ALL occurrences of a text string in the document.
 * Unlike simple textContent.indexOf(), this correctly accounts for node boundaries.
 * Returns array of { from, to, blockStart } positions.
 * blockStart is the position of the containing block node (paragraph, etc.)
 */
export function findAllTextInDocument(
  doc: PMNode,
  searchText: string
): TextPosition[] {
  const results: TextPosition[] = [];

  // Walk through all text nodes and build a mapping
  let textOffset = 0;
  const textPositions: Array<{
    start: number;
    end: number;
    pos: number;
    blockPos: number;
  }> = [];

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      // Find the containing block node position
      // Walk up to find the block-level parent
      let blockPos = pos;
      doc.nodesBetween(0, pos + 1, (n, p) => {
        if (n.isBlock && p <= pos && p + n.nodeSize > pos) {
          blockPos = p;
        }
      });

      textPositions.push({
        start: textOffset,
        end: textOffset + node.text.length,
        pos: pos,
        blockPos: blockPos,
      });
      textOffset += node.text.length;
    }
    return true;
  });

  // Now find ALL occurrences of searchText in the concatenated text
  const fullText = doc.textContent;
  let searchStart = 0;

  while (searchStart < fullText.length) {
    const textIndex = fullText.indexOf(searchText, searchStart);
    if (textIndex === -1) break;

    const textEndIndex = textIndex + searchText.length;

    // Find the starting position
    let fromPos: number | null = null;
    let toPos: number | null = null;
    let blockStart: number | null = null;

    for (const tp of textPositions) {
      // Check if search start falls within this text node
      if (fromPos === null && textIndex >= tp.start && textIndex < tp.end) {
        const offsetInNode = textIndex - tp.start;
        fromPos = tp.pos + offsetInNode;
        blockStart = tp.blockPos;
      }

      // Check if search end falls within this text node
      if (toPos === null && textEndIndex > tp.start && textEndIndex <= tp.end) {
        const offsetInNode = textEndIndex - tp.start;
        toPos = tp.pos + offsetInNode;
      }

      if (fromPos !== null && toPos !== null) break;
    }

    if (fromPos !== null && toPos !== null && blockStart !== null) {
      results.push({ from: fromPos, to: toPos, blockStart });
    }

    // Move past this occurrence
    searchStart = textIndex + 1;
  }

  return results;
}

/**
 * Find the ProseMirror position of a text string in the document.
 * Unlike simple textContent.indexOf(), this correctly accounts for node boundaries.
 * Returns { from, to, blockStart } or null if not found.
 * blockStart is the position of the containing block node (paragraph, etc.)
 *
 * @param doc - The ProseMirror document node
 * @param searchText - The text to search for
 * @param excludePositions - Set of 'from' positions to exclude (already used by other hunks)
 */
export function findTextInDocument(
  doc: PMNode,
  searchText: string,
  excludePositions?: Set<number>
): TextPosition | null {
  const allOccurrences = findAllTextInDocument(doc, searchText);

  if (allOccurrences.length === 0) return null;

  // If no exclusions, return the first occurrence
  if (!excludePositions || excludePositions.size === 0) {
    return allOccurrences[0];
  }

  // Find the first occurrence that's not excluded
  for (const occurrence of allOccurrences) {
    if (!excludePositions.has(occurrence.from)) {
      return occurrence;
    }
  }

  // All occurrences are excluded, return null
  return null;
}
