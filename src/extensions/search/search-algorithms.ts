/**
 * Search Algorithm Functions
 *
 * Pure functions for text search operations:
 * - Keyword search with regex
 * - Semantic search with position mapping
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { SearchRange, SemanticRange, SemanticChunk } from "./search-types";

/**
 * Escape special regex characters in a string
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a regex from search term with case sensitivity option
 */
export function getRegex(searchTerm: string, caseSensitive: boolean): RegExp | null {
  if (!searchTerm.trim()) return null;
  try {
    const escaped = escapeRegExp(searchTerm);
    return new RegExp(escaped, caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

/**
 * Find all keyword matches in a ProseMirror document
 */
export function processSearches(
  doc: PMNode,
  searchTerm: string,
  caseSensitive: boolean
): SearchRange[] {
  const results: SearchRange[] = [];
  const regex = getRegex(searchTerm, caseSensitive);

  if (!regex) return results;

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;

    const matches = [...node.text.matchAll(regex)];
    matches.forEach((match) => {
      if (match.index !== undefined) {
        results.push({
          from: pos + match.index,
          to: pos + match.index + match[0].length,
        });
      }
    });
  });

  return results;
}

/**
 * Build a position map from document text to document positions
 */
function buildPositionMap(doc: PMNode): { fullText: string; posMap: number[] } {
  let fullText = "";
  const posMap: number[] = []; // posMap[textIndex] = documentPos

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        posMap.push(pos + i);
      }
      fullText += node.text;
    } else if (node.isBlock && fullText.length > 0) {
      // Add newline for block boundaries
      posMap.push(pos);
      fullText += "\n";
    }
  });

  return { fullText, posMap };
}

/**
 * Normalize whitespace: collapse multiple spaces/newlines into single space
 */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Build a normalized position map that maps normalized text indices to document positions
 * This handles whitespace differences between chunk content and document text
 */
function buildNormalizedPositionMap(doc: PMNode): {
  normalizedText: string;
  posMap: number[];
} {
  let normalizedText = "";
  const posMap: number[] = [];

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        const char = node.text[i];
        // Collapse whitespace
        if (/\s/.test(char)) {
          // Only add space if last char wasn't a space
          if (normalizedText.length === 0 || normalizedText[normalizedText.length - 1] !== " ") {
            posMap.push(pos + i);
            normalizedText += " ";
          }
        } else {
          posMap.push(pos + i);
          normalizedText += char;
        }
      }
    } else if (node.isBlock && normalizedText.length > 0) {
      // Add space for block boundaries if not already ending with space
      if (normalizedText[normalizedText.length - 1] !== " ") {
        posMap.push(pos);
        normalizedText += " ";
      }
    }
  });

  return { normalizedText, posMap };
}

/**
 * Find semantic match positions in document
 * Returns ranges where the chunk content appears
 * Optimized for sentence-level chunks from the API
 */
export function findSemanticRanges(
  doc: PMNode,
  chunks: SemanticChunk[]
): SemanticRange[] {
  const results: SemanticRange[] = [];

  const { fullText, posMap } = buildPositionMap(doc);
  // Also build normalized version for fallback matching
  const { normalizedText, posMap: normalizedPosMap } = buildNormalizedPositionMap(doc);

  // For each chunk (now sentence-level), find its position in the document
  for (const chunk of chunks) {
    // Clean and normalize the chunk content for matching
    const cleanChunk = chunk.content
      .replace(/<[^>]+>/g, "") // Remove any HTML tags (just in case)
      .trim();

    if (cleanChunk.length < 5) {
      continue;
    }

    let found = false;

    // Strategy 1: Try direct match in original text first (most accurate)
    let directIdx = fullText.indexOf(cleanChunk);
    if (directIdx !== -1) {
      const from = posMap[directIdx];
      const endIdx = Math.min(directIdx + cleanChunk.length - 1, posMap.length - 1);
      const to = (posMap[endIdx] ?? from) + 1; // +1 because 'to' is exclusive

      if (from !== undefined && from < to) {
        results.push({ from, to, score: chunk.score });
        found = true;
      }
    }

    if (found) continue;

    // Strategy 2: Try case-insensitive match
    const lowerFullText = fullText.toLowerCase();
    const lowerChunk = cleanChunk.toLowerCase();
    directIdx = lowerFullText.indexOf(lowerChunk);
    if (directIdx !== -1) {
      const from = posMap[directIdx];
      const endIdx = Math.min(directIdx + cleanChunk.length - 1, posMap.length - 1);
      const to = (posMap[endIdx] ?? from) + 1;

      if (from !== undefined && from < to) {
        results.push({ from, to, score: chunk.score });
        found = true;
      }
    }

    if (found) continue;

    // Strategy 3: Try normalized whitespace match (handles newlines, indentation)
    const normalizedChunk = normalizeWhitespace(cleanChunk).toLowerCase();
    if (normalizedChunk.length >= 5) {
      const lowerNormalizedText = normalizedText.toLowerCase();
      directIdx = lowerNormalizedText.indexOf(normalizedChunk);
      if (directIdx !== -1) {
        const from = normalizedPosMap[directIdx];
        const endIdx = Math.min(directIdx + normalizedChunk.length - 1, normalizedPosMap.length - 1);
        const to = (normalizedPosMap[endIdx] ?? from) + 1;

        if (from !== undefined && from < to) {
          results.push({ from, to, score: chunk.score });
          found = true;
        }
      }
    }

    if (found) continue;

    // Strategy 4: Try matching without punctuation at the end
    const chunkNoPunctEnd = cleanChunk.replace(/[.,!?;:，。！？；：、]+$/, "");
    if (chunkNoPunctEnd.length >= 5 && chunkNoPunctEnd !== cleanChunk) {
      directIdx = lowerFullText.indexOf(chunkNoPunctEnd.toLowerCase());
      if (directIdx !== -1) {
        const from = posMap[directIdx];
        const endIdx = Math.min(directIdx + chunkNoPunctEnd.length - 1, posMap.length - 1);
        const to = (posMap[endIdx] ?? from) + 1;

        if (from !== undefined && from < to) {
          results.push({ from, to, score: chunk.score });
          found = true;
        }
      }
    }

    if (found) continue;

    // Strategy 5: Try finding a key phrase (first 30 chars, normalized)
    const keyPhrase = normalizeWhitespace(cleanChunk).slice(0, 30).toLowerCase();
    if (keyPhrase.length >= 10) {
      const lowerNormalizedText = normalizedText.toLowerCase();
      directIdx = lowerNormalizedText.indexOf(keyPhrase);
      if (directIdx !== -1) {
        const from = normalizedPosMap[directIdx];
        const endIdx = Math.min(directIdx + keyPhrase.length - 1, normalizedPosMap.length - 1);
        const to = (normalizedPosMap[endIdx] ?? from) + 1;

        if (from !== undefined && from < to) {
          results.push({ from, to, score: chunk.score });
        }
      }
    }
  }

  return dedupeRanges(results);
}

/**
 * Remove overlapping ranges, keeping higher scores
 */
export function dedupeRanges(ranges: SemanticRange[]): SemanticRange[] {
  if (ranges.length === 0) return [];

  // Sort by score (highest first)
  const sorted = [...ranges].sort((a, b) => b.score - a.score);
  const result: SemanticRange[] = [];

  for (const range of sorted) {
    // Check if this range overlaps with any existing range
    const overlaps = result.some(
      (r) => !(range.to <= r.from || range.from >= r.to)
    );
    if (!overlaps) {
      result.push(range);
    }
  }

  // Sort by position for consistent ordering
  return result.sort((a, b) => a.from - b.from);
}
