/**
 * Search Algorithm Functions
 *
 * Pure functions for text search operations:
 * - Keyword search with regex
 * - Semantic search with position mapping
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { SearchRange, SemanticRange, SemanticChunk } from "./search-types";
import type { TextPosition } from "../diff-review/diff-types";
import { findTextInDocument } from "../diff-review/position-mapping";

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

/**
 * Normalize text for fuzzy matching - removes extra whitespace,
 * markdown syntax, and converts to lowercase for comparison.
 */
function normalizeForMatch(text: string): string {
  return text
    .replace(/#{1,6}\s*/g, "") // Remove markdown headers
    .replace(/[*_~`]/g, "") // Remove markdown emphasis
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Extract link text
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim()
    .toLowerCase();
}

/**
 * Find approximate match in document text using normalized comparison.
 * Finds ALL text nodes containing matching words and returns a range covering them.
 */
function findFuzzyMatch(doc: PMNode, searchText: string): TextPosition | null {
  const normalizedSearch = normalizeForMatch(searchText);

  if (normalizedSearch.length < 10) return null;

  // Extract significant words (longer than 3 chars)
  const searchWords = normalizedSearch.split(" ").filter((w) => w.length > 3);

  if (searchWords.length < 2) return null;

  // Use ALL significant words for better coverage
  const significantWords = searchWords;

  // Collect text nodes with positions
  const textSegments: Array<{
    pos: number;
    endPos: number;
    text: string;
    normalizedText: string;
    matchedWords: Set<string>;
  }> = [];

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      const normalizedText = normalizeForMatch(node.text);
      const matchedWords = new Set<string>();

      for (const word of significantWords) {
        if (normalizedText.includes(word)) {
          matchedWords.add(word);
        }
      }

      textSegments.push({
        pos,
        endPos: pos + node.text.length,
        text: node.text,
        normalizedText,
        matchedWords,
      });
    }
  });

  // Find all segments that have ANY matching words
  const matchingSegments = textSegments.filter((s) => s.matchedWords.size > 0);

  if (matchingSegments.length === 0) return null;

  // Count total unique words matched across all segments
  const allMatchedWords = new Set<string>();
  for (const segment of matchingSegments) {
    for (const word of segment.matchedWords) {
      allMatchedWords.add(word);
    }
  }

  // Need at least 40% of words to match somewhere in the document
  if (allMatchedWords.size < Math.ceil(significantWords.length * 0.4)) {
    return null;
  }

  // Find contiguous groups of matching segments (within 500 chars of each other)
  const groups: Array<typeof matchingSegments> = [];
  let currentGroup: typeof matchingSegments = [];

  for (const segment of matchingSegments) {
    if (currentGroup.length === 0) {
      currentGroup.push(segment);
    } else {
      const lastSegment = currentGroup[currentGroup.length - 1];
      // If this segment is within 500 chars of the last one, add to group
      if (segment.pos - lastSegment.endPos < 500) {
        currentGroup.push(segment);
      } else {
        // Start new group
        groups.push(currentGroup);
        currentGroup = [segment];
      }
    }
  }
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  // Find the group with the most matched words
  let bestGroup: typeof matchingSegments | null = null;
  let bestGroupScore = 0;

  for (const group of groups) {
    const groupWords = new Set<string>();
    for (const segment of group) {
      for (const word of segment.matchedWords) {
        groupWords.add(word);
      }
    }
    const score = groupWords.size / significantWords.length;
    if (score > bestGroupScore) {
      bestGroupScore = score;
      bestGroup = group;
    }
  }

  if (!bestGroup || bestGroup.length === 0) return null;

  // Return range covering the entire best group
  const from = bestGroup[0].pos;
  const to = bestGroup[bestGroup.length - 1].endPos;

  return { from, to, blockStart: from };
}

/**
 * Find semantic match positions in document.
 * Uses exact match first, falls back to fuzzy matching for better recall.
 */
export function findSemanticRanges(doc: PMNode, chunks: SemanticChunk[]): SemanticRange[] {
  const results: SemanticRange[] = [];

  for (const chunk of chunks) {
    // Clean the chunk content - remove HTML and markdown syntax
    let cleanChunk = chunk.content
      .replace(/<[^>]+>/g, "") // Remove HTML tags
      .replace(/&lt;/g, "<") // Decode HTML entities
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .trim();

    // Remove markdown list markers (- , * , 1. ) at the start
    cleanChunk = cleanChunk.replace(/^[-*+]\s+/, "");
    cleanChunk = cleanChunk.replace(/^\d+\.\s+/, "");
    // Remove markdown header markers (# ) at the start
    cleanChunk = cleanChunk.replace(/^#{1,6}\s+/, "");

    if (cleanChunk.length < 5) {
      continue;
    }

    // Try exact match first
    let found = findTextInDocument(doc, cleanChunk);

    if (!found) {
      // If exact match fails, try fuzzy matching
      found = findFuzzyMatch(doc, cleanChunk);
    }

    // If still not found, check atom nodes (mermaid charts, math blocks)
    if (!found) {
      const lowerChunk = cleanChunk.toLowerCase();
      doc.descendants((node, pos) => {
        if (found) return false; // stop traversal
        if (!node.isAtom) return;
        const attrText = (node.attrs.code as string) || (node.attrs.latex as string) || "";
        if (attrText && attrText.toLowerCase().includes(lowerChunk)) {
          found = { from: pos, to: pos + node.nodeSize, blockStart: pos };
          return false;
        }
      });
    }

    if (found) {
      results.push({ from: found.from, to: found.to, score: chunk.score });
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
    const overlaps = result.some((r) => !(range.to <= r.from || range.from >= r.to));
    if (!overlaps) {
      result.push(range);
    }
  }

  // Sort by position for consistent ordering
  return result.sort((a, b) => a.from - b.from);
}
