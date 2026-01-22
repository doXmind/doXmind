"use client";

import { useEffect, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { useDiffReviewStore } from "@/stores/diff-review-store";

interface UseDiffReviewOptions {
  /** TipTap editor instance */
  editor: Editor | null;
  /** Current file ID */
  fileId: string;
}

/**
 * Hook for managing diff review functionality.
 * Syncs diff session to the editor and handles accept/reject operations.
 */
export function useDiffReview({ editor, fileId }: UseDiffReviewOptions) {
  const { diffSession, isReviewMode, endDiffReview, acceptHunk, rejectHunk, acceptAllHunks, rejectAllHunks } = useDiffReviewStore();

  // Sync diffSession to DiffReviewExtension
  useEffect(() => {
    if (!editor || !diffSession) {
      editor?.commands.clearDiffReview();
      return;
    }

    if (diffSession.fileId === fileId) {
      const pendingHunks = diffSession.hunks.filter((h) => h.status === "pending");
      editor.commands.setDiffHunks(pendingHunks);
    }
  }, [editor, diffSession, fileId]);

  // Handle diff accept/reject events from custom events
  useEffect(() => {
    const handleAccept = (e: Event) => {
      const customEvent = e as CustomEvent<{ hunkId: string }>;
      const hunkId = customEvent.detail.hunkId;

      editor?.commands.acceptDiffHunk(hunkId);
      acceptHunk(hunkId);

      const remaining = diffSession?.hunks.filter(
        (h) => h.status === "pending" && h.id !== hunkId
      );
      if (remaining?.length === 0) {
        endDiffReview();
      }
    };

    const handleReject = (e: Event) => {
      const customEvent = e as CustomEvent<{ hunkId: string }>;
      const hunkId = customEvent.detail.hunkId;

      editor?.commands.rejectDiffHunk(hunkId);
      rejectHunk(hunkId);

      const remaining = diffSession?.hunks.filter(
        (h) => h.status === "pending" && h.id !== hunkId
      );
      if (remaining?.length === 0) {
        endDiffReview();
      }
    };

    document.addEventListener("diff-accept", handleAccept);
    document.addEventListener("diff-reject", handleReject);

    return () => {
      document.removeEventListener("diff-accept", handleAccept);
      document.removeEventListener("diff-reject", handleReject);
    };
  }, [editor, diffSession, acceptHunk, rejectHunk, endDiffReview]);

  // Handle Accept All
  const handleAcceptAll = useCallback(() => {
    if (!diffSession) return;

    const pendingHunks = diffSession.hunks.filter((h) => h.status === "pending");
    for (const hunk of pendingHunks) {
      editor?.commands.acceptDiffHunk(hunk.id);
    }

    // Track telemetry for bulk accept
    acceptAllHunks();
    endDiffReview();
  }, [editor, diffSession, acceptAllHunks, endDiffReview]);

  // Handle Reject All
  const handleRejectAll = useCallback(() => {
    if (!diffSession) return;

    editor?.commands.clearDiffReview();
    // Track telemetry for bulk reject
    rejectAllHunks();
    endDiffReview();
  }, [editor, diffSession, rejectAllHunks, endDiffReview]);

  // Get pending count
  const pendingCount = diffSession?.hunks.filter((h) => h.status === "pending").length || 0;

  return {
    isReviewMode,
    pendingCount,
    handleAcceptAll,
    handleRejectAll,
  };
}
