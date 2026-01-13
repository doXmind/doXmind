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

  console.log("[SearchExt] findSemanticRanges called with", chunks.length, "chunks");

  const { fullText, posMap } = buildPositionMap(doc);

  console.log("[SearchExt] Document text length:", fullText.length);

  // For each chunk (now sentence-level), find its position in the document
  for (const chunk of chunks) {
    // Clean and normalize the chunk content for matching
    const cleanChunk = chunk.content
      .replace(/<[^>]+>/g, "") // Remove any HTML tags (just in case)
      .trim();

    console.log(
      "[SearchExt] Processing sentence chunk:",
      cleanChunk.slice(0, 60) + (cleanChunk.length > 60 ? "..." : "")
    );

    if (cleanChunk.length < 5) {
      console.log("[SearchExt] Chunk too short, skipping");
      continue;
    }

    const searchText = cleanChunk;
    const normalizedSearch = normalizeText(searchText);
    const normalizedDoc = normalizeText(fullText);

    // Try exact match first
    let idx = normalizedDoc.indexOf(normalizedSearch);

    // If no exact match, try with more aggressive normalization
    if (idx === -1) {
      const searchNoPunct = removePunctuation(normalizedSearch);
      const docNoPunct = removePunctuation(normalizedDoc);
      idx = docNoPunct.indexOf(searchNoPunct);
      console.log("[SearchExt] Tried without punctuation, idx:", idx);
    }

    // If still no match, try finding a key phrase (first 30 chars)
    if (idx === -1 && normalizedSearch.length > 30) {
      const keyPhrase = normalizedSearch.slice(0, 30);
      idx = normalizedDoc.indexOf(keyPhrase);
      console.log("[SearchExt] Tried key phrase match, idx:", idx);
    }

    console.log("[SearchExt] Index found:", idx);

    if (idx !== -1) {
      // Map text index back to document position
      const from = posMap[idx] ?? 0;
      const endIdx = Math.min(idx + searchText.length, posMap.length - 1);
      const to = posMap[endIdx] ?? from;

      console.log("[SearchExt] Position range:", { from, to, searchLen: searchText.length });

      if (from < to) {
        results.push({
          from,
          to,
          score: chunk.score,
        });
      }
    }
  }

  console.log("[SearchExt] Total results:", results.length);

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
