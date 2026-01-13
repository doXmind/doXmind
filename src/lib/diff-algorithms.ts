/**
 * Diff Algorithms
 *
 * Core algorithms for comparing and diffing text content.
 * Includes similarity calculation and paragraph-based diffing.
 */

import type { DiffHunk } from "@/types/diff";

/** Similarity threshold for considering paragraphs as modified (0-1) */
export const SIMILARITY_THRESHOLD = 0.3;

/** Position tolerance for fuzzy matching */
export const FUZZY_MATCH_TOLERANCE = 10;

/**
 * Result of comparing two paragraph arrays
 */
export interface ParagraphDiff {
  type: "unchanged" | "added" | "removed" | "modified";
  oldIndex?: number;
  newIndex?: number;
  oldContent?: string;
  newContent?: string;
}

/**
 * Normalize text for fuzzy matching (collapse whitespace, trim)
 */
export function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Split text into paragraphs (by double newline or single newline for markdown)
 */
export function splitIntoParagraphs(text: string): string[] {
  // Split by double newlines first (standard paragraph separator)
  // Then handle single newlines for markdown headers, lists, etc.
  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return paragraphs;
}

/**
 * Calculate similarity between two strings (0-1)
 * Uses a simple word overlap metric (Jaccard similarity)
 *
 * @param a - First string
 * @param b - Second string
 * @returns Similarity score between 0 and 1, where 1 is identical
 */
export function calculateSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let overlap = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) overlap++;
  }

  return (2 * overlap) / (wordsA.size + wordsB.size);
}

/**
 * Simple Longest Common Subsequence (LCS) based diff for paragraphs
 * Returns which paragraphs are unchanged, added, or removed
 */
export function diffParagraphArrays(
  oldParagraphs: string[],
  newParagraphs: string[]
): ParagraphDiff[] {
  const result: ParagraphDiff[] = [];

  // Normalize paragraphs for comparison
  const normalizedOld = oldParagraphs.map(normalizeForMatch);
  const normalizedNew = newParagraphs.map(normalizeForMatch);

  // Build a map of old paragraphs to their indices
  const oldMap = new Map<string, number[]>();
  normalizedOld.forEach((p, i) => {
    if (!oldMap.has(p)) oldMap.set(p, []);
    oldMap.get(p)!.push(i);
  });

  // Track which old paragraphs have been matched
  const matchedOld = new Set<number>();
  const matchedNew = new Set<number>();

  // First pass: find exact matches
  for (let newIdx = 0; newIdx < newParagraphs.length; newIdx++) {
    const normalized = normalizedNew[newIdx];
    const oldIndices = oldMap.get(normalized);

    if (oldIndices) {
      // Find an unmatched old paragraph
      for (const oldIdx of oldIndices) {
        if (!matchedOld.has(oldIdx)) {
          matchedOld.add(oldIdx);
          matchedNew.add(newIdx);
          result.push({
            type: "unchanged",
            oldIndex: oldIdx,
            newIndex: newIdx,
            oldContent: oldParagraphs[oldIdx],
            newContent: newParagraphs[newIdx],
          });
          break;
        }
      }
    }
  }

  // Second pass: find similar paragraphs (modified)
  for (let newIdx = 0; newIdx < newParagraphs.length; newIdx++) {
    if (matchedNew.has(newIdx)) continue;

    // Try to find a similar unmatched old paragraph
    let bestMatch = -1;
    let bestSimilarity = 0;

    for (let oldIdx = 0; oldIdx < oldParagraphs.length; oldIdx++) {
      if (matchedOld.has(oldIdx)) continue;

      const similarity = calculateSimilarity(
        normalizedOld[oldIdx],
        normalizedNew[newIdx]
      );

      if (similarity > bestSimilarity && similarity > SIMILARITY_THRESHOLD) {
        bestSimilarity = similarity;
        bestMatch = oldIdx;
      }
    }

    if (bestMatch !== -1) {
      matchedOld.add(bestMatch);
      matchedNew.add(newIdx);
      result.push({
        type: "modified",
        oldIndex: bestMatch,
        newIndex: newIdx,
        oldContent: oldParagraphs[bestMatch],
        newContent: newParagraphs[newIdx],
      });
    }
  }

  // Third pass: mark remaining as added/removed
  for (let oldIdx = 0; oldIdx < oldParagraphs.length; oldIdx++) {
    if (!matchedOld.has(oldIdx)) {
      result.push({
        type: "removed",
        oldIndex: oldIdx,
        oldContent: oldParagraphs[oldIdx],
      });
    }
  }

  for (let newIdx = 0; newIdx < newParagraphs.length; newIdx++) {
    if (!matchedNew.has(newIdx)) {
      result.push({
        type: "added",
        newIndex: newIdx,
        newContent: newParagraphs[newIdx],
      });
    }
  }

  // Sort by position (prioritize old index, then new index)
  result.sort((a, b) => {
    const aPos = a.oldIndex ?? a.newIndex ?? 0;
    const bPos = b.oldIndex ?? b.newIndex ?? 0;
    return aPos - bPos;
  });

  return result;
}

/**
 * Diff two documents by paragraphs and create hunks for changes
 */
export function diffByParagraphs(
  oldContent: string,
  newContent: string,
  fileId: string,
  generateId: () => string
): DiffHunk[] {
  const hunks: DiffHunk[] = [];

  const oldParagraphs = splitIntoParagraphs(oldContent);
  const newParagraphs = splitIntoParagraphs(newContent);

  console.log(
    `[diff-algorithms] Diffing ${oldParagraphs.length} old paragraphs vs ${newParagraphs.length} new paragraphs`
  );

  const diff = diffParagraphArrays(oldParagraphs, newParagraphs);

  // Check if no paragraphs are unchanged - this is a full replacement
  // In this case, create a single hunk to avoid leaving empty paragraphs behind
  const hasUnchanged = diff.some((d) => d.type === "unchanged");

  if (!hasUnchanged && oldContent !== newContent) {
    console.log("[diff-algorithms] Full replacement detected, creating single hunk");
    return [
      {
        id: generateId(),
        type: "replace" as const,
        from: 1,
        to: oldContent.length + 1,
        oldContent: oldContent,
        newContent: newContent,
        status: "pending" as const,
        createdAt: new Date().toISOString(),
        editId: fileId,
      },
    ];
  }

  // Calculate positions for each paragraph in the old document
  const oldPositions: Array<{ from: number; to: number }> = [];
  let pos = 1;
  for (const para of oldParagraphs) {
    const from = pos;
    const to = pos + para.length;
    oldPositions.push({ from, to });
    pos = to + 2; // +2 for paragraph separator (\n\n)
  }

  // Create hunks for changes
  for (const change of diff) {
    if (change.type === "unchanged") {
      // No hunk needed for unchanged content
      continue;
    }

    if (change.type === "modified" && change.oldIndex !== undefined) {
      // Replace old paragraph with new
      const position = oldPositions[change.oldIndex];
      hunks.push({
        id: generateId(),
        type: "replace",
        from: position.from,
        to: position.to,
        oldContent: change.oldContent || "",
        newContent: change.newContent || "",
        status: "pending",
        createdAt: new Date().toISOString(),
        editId: fileId,
      });
    } else if (change.type === "removed" && change.oldIndex !== undefined) {
      // Delete old paragraph
      const position = oldPositions[change.oldIndex];
      hunks.push({
        id: generateId(),
        type: "delete",
        from: position.from,
        to: position.to,
        oldContent: change.oldContent || "",
        newContent: "",
        status: "pending",
        createdAt: new Date().toISOString(),
        editId: fileId,
      });
    } else if (change.type === "added") {
      // Insert new paragraph
      // Find the position to insert (after the last matched paragraph or at start)
      const insertPos =
        oldPositions.length > 0
          ? oldPositions[oldPositions.length - 1].to + 1
          : 1;
      hunks.push({
        id: generateId(),
        type: "insert",
        from: insertPos,
        to: insertPos,
        oldContent: "",
        newContent: change.newContent || "",
        status: "pending",
        createdAt: new Date().toISOString(),
        editId: fileId,
      });
    }
  }

  // If no changes detected but content is different, create a single replace hunk
  if (hunks.length === 0 && oldContent !== newContent) {
    console.log("[diff-algorithms] No paragraph changes detected, creating single replace hunk");
    hunks.push({
      id: generateId(),
      type: "replace",
      from: 1,
      to: oldContent.length + 1,
      oldContent: oldContent,
      newContent: newContent,
      status: "pending",
      createdAt: new Date().toISOString(),
      editId: fileId,
    });
  }

  return hunks;
}
