/**
 * Diff Utilities
 *
 * Main entry point for computing diff hunks from AI edit operations.
 * Re-exports utilities from position-mapper and diff-algorithms.
 */

import type { DiffHunk, DiffChangeType, EditOperation } from "@/types/diff";
import { htmlToMarkdown, isHtml, markdownToPlainText } from "./markdown";
import { findLinePosition, type DocWithContent } from "./position-mapper";
// Note: diffByParagraphs is exported for external use but no longer used internally
// replace_all now creates a single hunk instead of paragraph-level diffs
import { generateId } from "./utils";

// Re-export utilities for external use
export { findTextInDoc, findLinePosition, mapHunkPositions, fuzzyIndexOf } from "./position-mapper";
export type { DocWithContent } from "./position-mapper";
export {
  calculateSimilarity,
  diffParagraphArrays,
  splitIntoParagraphs,
  normalizeForMatch,
  SIMILARITY_THRESHOLD,
  FUZZY_MATCH_TOLERANCE,
} from "./diff-algorithms";
export type { ParagraphDiff } from "./diff-algorithms";

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
  doc?: DocWithContent
): DiffHunk[] {
  const hunks: DiffHunk[] = [];

  // Convert HTML to markdown for text matching (AI uses markdown)
  const originalMarkdown = isHtml(originalContent)
    ? htmlToMarkdown(originalContent)
    : originalContent;

  switch (edit.type) {
    case "str_replace": {
      if (!edit.old_str || edit.new_str === undefined) {
        return [];
      }

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
      // Prefer backend-generated search_text for 100% consistency with backend validation
      // Fall back to frontend conversion for backward compatibility
      const searchText = edit.search_text || markdownToPlainText(edit.old_str);

      const hunk: DiffHunk = {
        id: generateId(),
        type: hunkType,
        from: 0, // Placeholder - will be resolved by findTextInDocument
        to: 0, // Placeholder - will be resolved by findTextInDocument
        oldContent: edit.old_str, // Keep original markdown for display
        searchText, // Plain text for searching in doc.textContent
        newContent: edit.new_str,
        status: "pending" as const,
        createdAt: new Date().toISOString(),
        editId: edit.file_id,
      };
      hunks.push(hunk);
      break;
    }

    case "insert": {
      if (edit.insert_line === undefined || edit.new_str === undefined) {
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
        searchText: "", // Empty for insert type
        newContent: edit.new_str,
        status: "pending",
        createdAt: new Date().toISOString(),
        editId: edit.file_id,
      });
      break;
    }

    case "replace_all": {
      if (edit.new_content === undefined) {
        return [];
      }

      // For replace_all, create a single hunk that replaces the entire document
      // Do NOT use paragraph-level diffing as that creates too many individual hunks
      hunks.push({
        id: generateId(),
        type: "replace" as const,
        from: 0,
        to: -1, // Special marker: means "end of document"
        oldContent: originalMarkdown,
        searchText: "", // Empty: don't use text search for full document replace
        newContent: edit.new_content,
        status: "pending" as const,
        createdAt: new Date().toISOString(),
        editId: edit.file_id,
        isFullDocumentReplace: true,
      });
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
