"use client";

import { useCallback } from "react";
import { useFileStore } from "@/stores/file-store";
import { useDiffReviewStore } from "@/stores/diff-review-store";
import { computeDiffHunks } from "@/lib/diff-utils";
import { htmlToMarkdown, isHtml } from "@/lib/markdown";
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

  /**
   * Apply multiple edit operations at once to avoid async state issues
   * Collects all hunks first, then starts/updates diff review session once
   *
   * NOTE: Reads diff review state directly via getState() to avoid stale closures.
   * During streaming, applyEdits is called per-edit from the SSE handler, but the
   * useCallback closure would capture isReviewMode=false from the render when
   * sendMessage was called. Reading fresh state ensures the second+ edit correctly
   * appends to the existing diff session instead of replacing it.
   */
  const applyEdits = useCallback(
    (edits: EditOperation[]): number => {
      if (edits.length === 0) return 0;

      // Read current diff review state to avoid stale closure during streaming
      const { isReviewMode, diffSession, startDiffReview, addHunksToDiffSession } =
        useDiffReviewStore.getState();

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

        // Compute markdown (same format backend uses to validate old_str)
        const markdown = isHtml(file.content) ? htmlToMarkdown(file.content) : file.content;

        // Compute workingMarkdown by applying all edits sequentially (replicating backend logic).
        // This is used as the "final state" for full-doc-replace fallback when sequential
        // edits create dependencies (edit N's old_str only exists after edits 1..N-1).
        const existingWorkingMd =
          isReviewMode && diffSession?.fileId === fileId
            ? diffSession.workingMarkdown || diffSession.originalMarkdown || markdown
            : markdown;
        let workingMarkdown = existingWorkingMd;
        for (const edit of fileEdits) {
          if (edit.type === "str_replace" && edit.old_str && edit.new_str !== undefined) {
            const idx = workingMarkdown.indexOf(edit.old_str);
            if (idx !== -1) {
              workingMarkdown =
                workingMarkdown.slice(0, idx) +
                edit.new_str +
                workingMarkdown.slice(idx + edit.old_str.length);
            }
          } else if (edit.type === "replace_all" && edit.new_content !== undefined) {
            workingMarkdown = edit.new_content;
          }
        }

        // Check if we're already in review mode for this file
        if (isReviewMode && diffSession?.fileId === fileId) {
          // Add all hunks to existing session at once
          addHunksToDiffSession(allHunks, workingMarkdown);
        } else {
          // Start a new diff review session with all hunks
          startDiffReview(fileId, allHunks, file.content, markdown, workingMarkdown);
        }
      }

      return totalApplied;
    },
    [getFile]
  );

  return {
    applyEdits,
  };
}
