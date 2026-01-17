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
 * Normalize text for fuzzy matching
 */
function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Remove punctuation from text for matching
 */
function removePunctuation(text: string): string {
  return text.replace(/[.,!?;:，。！？；：、]/g, "");
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

  // For each chunk (now sentence-level), find its position in the document
  for (const chunk of chunks) {
    // Clean and normalize the chunk content for matching
    const cleanChunk = chunk.content
      .replace(/<[^>]+>/g, "") // Remove any HTML tags (just in case)
      .trim();

    if (cleanChunk.length < 5) {
      continue;
    }

    // Strategy 1: Try direct match in original text first (most accurate)
    let directIdx = fullText.indexOf(cleanChunk);
    if (directIdx !== -1) {
      const from = posMap[directIdx];
      const endIdx = Math.min(directIdx + cleanChunk.length - 1, posMap.length - 1);
      const to = (posMap[endIdx] ?? from) + 1; // +1 because 'to' is exclusive

      if (from !== undefined && from < to) {
        results.push({ from, to, score: chunk.score });
        continue;
      }
    }

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
        continue;
      }
    }

    // Strategy 3: Try matching without punctuation at the end
    const chunkNoPunctEnd = cleanChunk.replace(/[.,!?;:，。！？；：、]+$/, "");
    if (chunkNoPunctEnd.length >= 5 && chunkNoPunctEnd !== cleanChunk) {
      directIdx = lowerFullText.indexOf(chunkNoPunctEnd.toLowerCase());
      if (directIdx !== -1) {
        const from = posMap[directIdx];
        const endIdx = Math.min(directIdx + chunkNoPunctEnd.length - 1, posMap.length - 1);
        const to = (posMap[endIdx] ?? from) + 1;

        if (from !== undefined && from < to) {
          results.push({ from, to, score: chunk.score });
          continue;
        }
      }
    }

    // Strategy 4: Try finding a key phrase (first 40 chars)
    if (cleanChunk.length > 40) {
      const keyPhrase = cleanChunk.slice(0, 40).toLowerCase();
      directIdx = lowerFullText.indexOf(keyPhrase);
      if (directIdx !== -1) {
        const from = posMap[directIdx];
        // Use the key phrase length for more accurate end position
        const endIdx = Math.min(directIdx + 39, posMap.length - 1);
        const to = (posMap[endIdx] ?? from) + 1;

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
