"use client";

import { useCallback } from "react";
import { useFileStore } from "@/stores/file-store";
import { useDiffReviewStore } from "@/stores/diff-review-store";
import { computeDiffHunks } from "@/lib/diff-utils";
import { editorLogger } from "@/lib/logger";
import type { DiffHunk, EditOperation as DiffEditOperation } from "@/types/diff";
import type { EditOperation } from "@/types";

const log = editorLogger.child("EditOperations");

// Re-export for backward compatibility
export type { EditOperation } from "@/types";

/**
 * Hook for applying AI edit operations to files
 * Handles diff computation and review mode integration
 */
export function useEditOperations() {
  const { getFile } = useFileStore();
  const { startDiffReview, isReviewMode, addHunksToDiffSession, diffSession } =
    useDiffReviewStore();

  /**
   * Apply multiple edit operations at once to avoid async state issues
   * Collects all hunks first, then starts/updates diff review session once
   */
  const applyEdits = useCallback(
    (edits: EditOperation[]): number => {
      if (edits.length === 0) return 0;

      // Group edits by file_id
      const editsByFile = new Map<string, EditOperation[]>();
      for (const edit of edits) {
        const existing = editsByFile.get(edit.file_id) || [];
        existing.push(edit);
        editsByFile.set(edit.file_id, existing);
      }

      let totalApplied = 0;

      // Process each file's edits
      for (const [fileId, fileEdits] of editsByFile) {
        const file = getFile(fileId);
        if (!file) {
          log.warn("File not found for edit operation", { fileId });
          continue;
        }

        // Collect all hunks for this file
        const allHunks: DiffHunk[] = [];
        for (const edit of fileEdits) {
          const diffEdit: DiffEditOperation = {
            type: edit.type,
            file_id: edit.file_id,
            file_name: edit.file_name,
            success: edit.success,
            old_str: edit.old_str,
            new_str: edit.new_str,
            insert_line: edit.insert_line,
            new_content: edit.new_content,
          };

          const hunks = computeDiffHunks(file.content, diffEdit);
          if (hunks.length > 0) {
            allHunks.push(...hunks);
            totalApplied++;
          } else {
            console.warn(`[useEditOperations] No diff hunks computed for ${edit.type} edit`);
          }
        }

        if (allHunks.length === 0) continue;

        // Check if we're already in review mode for this file
        if (isReviewMode && diffSession?.fileId === fileId) {
          // Add all hunks to existing session at once
          addHunksToDiffSession(allHunks);
        } else {
          // Start a new diff review session with all hunks
          startDiffReview(fileId, allHunks, file.content);
        }
      }

      return totalApplied;
    },
    [getFile, isReviewMode, diffSession, startDiffReview, addHunksToDiffSession]
  );

  return {
    applyEdits,
  };
}
