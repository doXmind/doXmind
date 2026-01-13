"use client";

import { useCallback } from "react";
import { useFileStore } from "@/stores/file-store";
import { useEditorStore } from "@/stores/editor-store";
import { computeDiffHunks } from "@/lib/diff-utils";
import type { DiffHunk, EditOperation as DiffEditOperation } from "@/types/diff";

// Types for edit operations from the backend
export interface EditOperation {
  type: "str_replace" | "insert" | "replace_all";
  file_id: string;
  file_name: string;
  success: boolean;
  error?: string;
  // For str_replace
  old_str?: string;
  new_str?: string;
  // For insert
  insert_line?: number;
  // For replace_all
  new_content?: string;
}

/**
 * Hook for applying AI edit operations to files
 * Handles diff computation and review mode integration
 */
export function useEditOperations() {
  const { getFile } = useFileStore();
  const { startDiffReview, isReviewMode, addHunksToDiffSession, diffSession } =
    useEditorStore();

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
          console.error(`[useEditOperations] File not found: ${fileId}`);
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
            console.warn(
              `[useEditOperations] No diff hunks computed for ${edit.type} edit`
            );
          }
        }

        if (allHunks.length === 0) continue;

        // Check if we're already in review mode for this file
        if (isReviewMode && diffSession?.fileId === fileId) {
          // Add all hunks to existing session at once
          addHunksToDiffSession(allHunks);
          console.log(
            `[useEditOperations] Added ${allHunks.length} hunk(s) to existing diff review`
          );
        } else {
          // Start a new diff review session with all hunks
          startDiffReview(fileId, allHunks, file.content);
          console.log(
            `[useEditOperations] Started diff review with ${allHunks.length} hunk(s) for ${fileEdits[0].file_name}`
          );
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
