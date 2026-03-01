/**
 * Diff Utilities
 *
 * Main entry point for computing diff hunks from AI edit operations.
 */

import type { DiffHunk, DiffChangeType, EditOperation } from "@/types/diff";
import { generateId } from "./utils";
import { diffLines } from "diff";

/**
 * Compute diff hunks from an edit operation.
 * This is the main entry point for creating review hunks.
 *
 * @param originalContent - Current content (HTML from editor)
 * @param edit - Edit operation from AI
 * @param originalMarkdown - Pre-computed markdown (from contentMarkdown cache). Falls back to originalContent if not provided.
 * @returns Array of DiffHunk objects
 */
export function computeDiffHunks(
  originalContent: string,
  edit: EditOperation,
  originalMarkdown?: string
): DiffHunk[] {
  const hunks: DiffHunk[] = [];

  // Use provided markdown or fall back to raw content
  const mdContent = originalMarkdown || originalContent;

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
        markdownOffset: edit.offset,
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
        oldContent: mdContent,
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
 * Find old_str in markdown, preferring backend offset when available.
 * Falls back to indexOf if offset is undefined or invalid.
 */
export function findInMarkdown(markdown: string, oldStr: string, offset?: number): number {
  if (offset !== undefined && offset >= 0 && offset + oldStr.length <= markdown.length) {
    if (markdown.slice(offset, offset + oldStr.length) === oldStr) {
      return offset;
    }
  }
  return markdown.indexOf(oldStr);
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
 * Split the difference between two markdown strings into multiple regional hunks.
 * Used when sequential edit dependencies are detected — instead of creating one
 * monolithic full-document-replace, this produces granular hunks for each changed region.
 */
export function splitMarkdownIntoHunks(
  originalMarkdown: string,
  updatedMarkdown: string
): DiffHunk[] {
  const changes = diffLines(originalMarkdown, updatedMarkdown);
  const hunks: DiffHunk[] = [];

  // Track position in originalMarkdown for markdownOffset
  let offset = 0;

  // Accumulate consecutive add/remove changes into a single region
  let pendingOld = "";
  let pendingNew = "";
  let regionOffset = 0;
  let inRegion = false;

  const flushRegion = () => {
    if (!inRegion) return;

    const oldTrimmed = pendingOld.replace(/\n+$/, "");
    const newTrimmed = pendingNew.replace(/\n+$/, "");

    // Skip empty or whitespace-only changes
    if (oldTrimmed || newTrimmed) {
      hunks.push({
        id: generateId(),
        type: (newTrimmed ? "replace" : "delete") as DiffChangeType,
        from: 0,
        to: 0,
        oldContent: oldTrimmed,
        searchText: "",
        newContent: newTrimmed,
        status: "pending" as const,
        createdAt: new Date().toISOString(),
        editId: "batch",
        markdownOffset: regionOffset,
      });
    }

    pendingOld = "";
    pendingNew = "";
    inRegion = false;
  };

  for (const change of changes) {
    if (change.added) {
      if (!inRegion) {
        regionOffset = offset;
        inRegion = true;
      }
      pendingNew += change.value;
    } else if (change.removed) {
      if (!inRegion) {
        regionOffset = offset;
        inRegion = true;
      }
      pendingOld += change.value;
      offset += change.value.length;
    } else {
      // Unchanged line — flush pending region
      flushRegion();
      offset += change.value.length;
    }
  }

  // Flush any remaining region
  flushRegion();

  return hunks;
}
