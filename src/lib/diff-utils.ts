/**
 * Diff Utilities
 *
 * Main entry point for computing diff hunks from AI edit operations.
 */

import type { DiffHunk, DiffChangeType, EditOperation } from "@/types/diff";
import { htmlToMarkdown, isHtml } from "./markdown";
import { generateId } from "./utils";

/**
 * Compute diff hunks from an edit operation.
 * This is the main entry point for creating review hunks.
 *
 * @param originalContent - Current content (HTML from editor)
 * @param edit - Edit operation from AI
 * @returns Array of DiffHunk objects
 */
export function computeDiffHunks(originalContent: string, edit: EditOperation): DiffHunk[] {
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

      const hunkType: DiffChangeType = edit.new_str === "" ? "delete" : "replace";

      // Position will be resolved by findTextViaMarkdown (Apply-and-Diff) in diff-review-extension
      // searchText kept for backward-compat fallback but primary matching uses raw markdown
      const searchText = edit.old_str;

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
