/**
 * Diff Utilities
 *
 * Functions for computing diff hunks from AI edit operations
 * and mapping positions between Markdown and ProseMirror documents.
 */

import type { DiffHunk, DiffChangeType, EditOperation } from "@/types/diff";
import { htmlToMarkdown, isHtml } from "./markdown";

/**
 * Generate a unique ID for hunks
 */
function generateId(): string {
  return crypto.randomUUID();
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
  doc: { textContent: string; nodeSize: number },
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
  doc: { textContent: string; nodeSize: number },
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
 * Normalize text for fuzzy matching (collapse whitespace, trim)
 */
function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Split text into paragraphs (by double newline or single newline for markdown)
 */
function splitIntoParagraphs(text: string): string[] {
  // Split by double newlines first (standard paragraph separator)
  // Then handle single newlines for markdown headers, lists, etc.
  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return paragraphs;
}

/**
 * Simple Longest Common Subsequence (LCS) based diff for paragraphs
 * Returns which paragraphs are unchanged, added, or removed
 */
function diffParagraphArrays(
  oldParagraphs: string[],
  newParagraphs: string[]
): Array<{
  type: "unchanged" | "added" | "removed" | "modified";
  oldIndex?: number;
  newIndex?: number;
  oldContent?: string;
  newContent?: string;
}> {
  const result: Array<{
    type: "unchanged" | "added" | "removed" | "modified";
    oldIndex?: number;
    newIndex?: number;
    oldContent?: string;
    newContent?: string;
  }> = [];

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

      if (similarity > bestSimilarity && similarity > 0.3) {
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
 * Calculate similarity between two strings (0-1)
 * Uses a simple word overlap metric
 */
function calculateSimilarity(a: string, b: string): number {
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
 * Diff two documents by paragraphs and create hunks for changes
 */
function diffByParagraphs(
  oldContent: string,
  newContent: string,
  fileId: string
): DiffHunk[] {
  const hunks: DiffHunk[] = [];

  const oldParagraphs = splitIntoParagraphs(oldContent);
  const newParagraphs = splitIntoParagraphs(newContent);

  console.log(
    `[diff-utils] Diffing ${oldParagraphs.length} old paragraphs vs ${newParagraphs.length} new paragraphs`
  );

  const diff = diffParagraphArrays(oldParagraphs, newParagraphs);

  // Check if no paragraphs are unchanged - this is a full replacement
  // In this case, create a single hunk to avoid leaving empty paragraphs behind
  const hasUnchanged = diff.some(d => d.type === "unchanged");

  if (!hasUnchanged && oldContent !== newContent) {
    console.log("[diff-utils] Full replacement detected, creating single hunk");
    return [{
      id: generateId(),
      type: "replace" as const,
      from: 1,
      to: oldContent.length + 1,
      oldContent: oldContent,
      newContent: newContent,
      status: "pending" as const,
      createdAt: new Date().toISOString(),
      editId: fileId,
    }];
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
    console.log("[diff-utils] No paragraph changes detected, creating single replace hunk");
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

/**
 * Find text with fuzzy matching (handles whitespace differences)
 */
function fuzzyIndexOf(haystack: string, needle: string): number {
  // First try exact match
  let index = haystack.indexOf(needle);
  if (index !== -1) return index;

  // Try with normalized whitespace
  const normalizedHaystack = normalizeForMatch(haystack);
  const normalizedNeedle = normalizeForMatch(needle);

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
        const normalizedPos = normalizeForMatch(haystack.slice(0, wordIndex)).length;
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

/**
 * Compute diff hunks from an edit operation.
 * This is the main entry point for creating review hunks.
 *
 * @param originalContent - Current content (HTML from editor)
 * @param edit - Edit operation from AI
 * @param doc - Optional ProseMirror document for accurate positioning
 * @returns Array of DiffHunk objects
 */
export function computeDiffHunks(
  originalContent: string,
  edit: EditOperation,
  doc?: { textContent: string; nodeSize: number }
): DiffHunk[] {
  const hunks: DiffHunk[] = [];

  // Convert HTML to markdown for text matching (AI uses markdown)
  const originalMarkdown = isHtml(originalContent)
    ? htmlToMarkdown(originalContent)
    : originalContent;

  console.log("[diff-utils] Computing hunks for edit type:", edit.type);
  console.log("[diff-utils] Original markdown length:", originalMarkdown.length);
  console.log("[diff-utils] Original markdown preview:", originalMarkdown.substring(0, 300));

  switch (edit.type) {
    case "str_replace": {
      if (!edit.old_str || edit.new_str === undefined) {
        console.warn("[diff-utils] str_replace missing old_str or new_str");
        return [];
      }

      console.log("[diff-utils] Looking for old_str (length=" + edit.old_str.length + "):", edit.old_str.substring(0, 100) + "...");

      // For str_replace, simply create a single hunk for the replacement
      // The old_str and new_str define exactly what to replace
      // Position finding will be handled by the diff-review-extension using findTextInDocument

      const hunkType: DiffChangeType =
        edit.new_str === ""
          ? "delete"
          : edit.old_str === ""
            ? "insert"
            : "replace";

      // Use a placeholder position - the actual position will be found
      // by findTextInDocument in diff-review-extension.ts when rendering
      const hunk: DiffHunk = {
        id: generateId(),
        type: hunkType,
        from: 0, // Placeholder - will be resolved by findTextInDocument
        to: 0,   // Placeholder - will be resolved by findTextInDocument
        oldContent: edit.old_str,
        newContent: edit.new_str,
        status: "pending" as const,
        createdAt: new Date().toISOString(),
        editId: edit.file_id,
      };
      console.log("[diff-utils] Created str_replace hunk:", { id: hunk.id, type: hunkType, oldContent: edit.old_str.substring(0, 50) + "..." });
      hunks.push(hunk);
      break;
    }

    case "insert": {
      if (edit.insert_line === undefined || edit.new_str === undefined) {
        console.warn("[diff-utils] insert missing insert_line or new_str");
        return [];
      }

      let insertPos: number;

      if (doc) {
        insertPos = findLinePosition(doc, edit.insert_line);
      } else {
        // Fallback: calculate from markdown
        const lines = originalMarkdown.split("\n");
        let pos = 1;
        for (let i = 0; i < Math.min(edit.insert_line, lines.length); i++) {
          pos += lines[i].length + 1;
        }
        insertPos = pos;
      }

      hunks.push({
        id: generateId(),
        type: "insert",
        from: insertPos,
        to: insertPos, // For insert, from === to
        oldContent: "",
        newContent: edit.new_str,
        status: "pending",
        createdAt: new Date().toISOString(),
        editId: edit.file_id,
      });
      break;
    }

    case "replace_all": {
      if (edit.new_content === undefined) {
        console.warn("[diff-utils] replace_all missing new_content");
        return [];
      }

      console.log("[diff-utils] Creating replace_all hunks by paragraph diff");

      // Split into paragraphs and diff them
      const paragraphHunks = diffByParagraphs(
        originalMarkdown,
        edit.new_content,
        edit.file_id
      );

      console.log(`[diff-utils] Created ${paragraphHunks.length} paragraph hunks`);
      hunks.push(...paragraphHunks);
      break;
    }
  }

  return hunks;
}

/**
 * Check if all hunks in a session are processed (accepted or rejected)
 */
export function areAllHunksProcessed(hunks: DiffHunk[]): boolean {
  return hunks.every((h) => h.status !== "pending");
}

/**
 * Get count of pending hunks
 */
export function getPendingHunkCount(hunks: DiffHunk[]): number {
  return hunks.filter((h) => h.status === "pending").length;
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
