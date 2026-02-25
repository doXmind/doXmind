"use client";

import { useEffect, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import type { DiffHunk, DiffSession } from "@/types/diff";
import { useDiffReviewStore } from "@/stores/diff-review-store";
import { useStreamingStore } from "@/stores/streaming-store";
import { api } from "@/lib/api";

interface UseDiffReviewOptions {
  /** TipTap editor instance */
  editor: Editor | null;
  /** Current file ID */
  fileId: string;
}

/** Scroll the editor to bring a hunk into view via DOM (avoids creating a text selection) */
function scrollToHunk(_editor: Editor, hunk: DiffHunk) {
  // Find the hunk's DOM element by data attribute (inline diff widget, action widget, or insert widget)
  const el =
    document.querySelector(`[data-hunk-id="${hunk.id}"].diff-inline-wrapper`) ||
    document.querySelector(`[data-hunk-id="${hunk.id}"].diff-actions-row`) ||
    document.querySelector(`[data-hunk-id="${hunk.id}"]`);

  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

/** Create a version snapshot after diff review ends (fire-and-forget) */
function createVersionSnapshot(editor: Editor, session: DiffSession) {
  const accepted = session.hunks.filter((h) => h.status === "accepted");
  if (accepted.length === 0) return;

  const total = session.hunks.length;
  const summary =
    accepted.length === 1
      ? "AI edit: accepted 1 change"
      : `AI edit: accepted ${accepted.length} of ${total} changes`;

  const content = editor.getHTML();
  api.createVersion(session.fileId, content, "ai_edit", summary).catch(() => {});
}

/**
 * Hook for managing diff review functionality.
 * Syncs diff session to the editor and handles accept/reject operations.
 */
export function useDiffReview({ editor, fileId }: UseDiffReviewOptions) {
  const {
    diffSession,
    isReviewMode,
    endDiffReview,
    acceptHunk,
    rejectHunk,
    acceptAllHunks,
    rejectAllHunks,
    currentHunkIndex,
    navigationSource,
    goToNextHunk,
    goToPreviousHunk,
  } = useDiffReviewStore();

  // Track previous review mode to detect transitions
  const prevReviewMode = useRef(false);

  // Make editor read-only during diff review for clean inline diff rendering
  useEffect(() => {
    if (!editor) return;
    if (isReviewMode) {
      editor.setEditable(false);
    }
    return () => {
      // Restore editability when review ends or component unmounts,
      // but only if streaming is not active (streaming also sets read-only)
      if (editor && !editor.isDestroyed) {
        const isCurrentlyStreaming = useStreamingStore.getState().isStreaming;
        if (!isCurrentlyStreaming) {
          editor.setEditable(true);
        }
      }
    };
  }, [editor, isReviewMode]);

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

  // Auto-scroll to first change when review mode starts
  useEffect(() => {
    if (!editor || !diffSession) return;

    const justEntered = isReviewMode && !prevReviewMode.current;
    prevReviewMode.current = isReviewMode;

    if (!justEntered) return;

    // Wait for decorations to render before scrolling
    const timer = setTimeout(() => {
      const pendingHunks = diffSession.hunks.filter((h) => h.status === "pending");
      if (pendingHunks.length > 0) {
        scrollToHunk(editor, pendingHunks[0]);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [editor, diffSession, isReviewMode]);

  // Scroll + focus when currentHunkIndex changes via explicit user navigation only
  useEffect(() => {
    if (!editor || !diffSession || currentHunkIndex < 0) return;
    // Only focus/scroll on explicit user navigation (next/prev buttons),
    // not on auto-advance after accept/reject
    if (navigationSource !== "user") return;

    const hunk = diffSession.hunks[currentHunkIndex];
    if (!hunk || hunk.status !== "pending") return;

    // Set focus highlight in ProseMirror
    editor.commands.setFocusedHunk(hunk.id);
    // Scroll into view
    scrollToHunk(editor, hunk);
  }, [editor, diffSession, currentHunkIndex, navigationSource]);

  // Clear focus when review ends or after accept/reject (auto-advance)
  useEffect(() => {
    if (!editor) return;
    if (!isReviewMode) {
      editor.commands.setFocusedHunk(null);
    } else if (navigationSource === "auto") {
      // After accept/reject, clear the focus so the next hunk isn't auto-highlighted
      editor.commands.setFocusedHunk(null);
    }
  }, [isReviewMode, editor, navigationSource]);

  // Handle diff accept/reject events from custom events
  useEffect(() => {
    const handleAccept = (e: Event) => {
      // Block accept during streaming — backend edits are based on the original
      // document snapshot, so accepting mid-stream would cause position conflicts
      if (useStreamingStore.getState().isStreaming) return;

      const customEvent = e as CustomEvent<{ hunkId: string }>;
      const hunkId = customEvent.detail.hunkId;

      editor?.commands.acceptDiffHunk(hunkId);
      acceptHunk(hunkId);

      const remaining = diffSession?.hunks.filter((h) => h.status === "pending" && h.id !== hunkId);
      if (remaining?.length === 0) {
        if (editor && diffSession) {
          const finalSession = useDiffReviewStore.getState().diffSession;
          if (finalSession) createVersionSnapshot(editor, finalSession);
        }
        endDiffReview();
      }
    };

    const handleReject = (e: Event) => {
      if (useStreamingStore.getState().isStreaming) return;

      const customEvent = e as CustomEvent<{ hunkId: string }>;
      const hunkId = customEvent.detail.hunkId;

      editor?.commands.rejectDiffHunk(hunkId);
      rejectHunk(hunkId);

      const remaining = diffSession?.hunks.filter((h) => h.status === "pending" && h.id !== hunkId);
      if (remaining?.length === 0) {
        if (editor && diffSession) {
          const finalSession = useDiffReviewStore.getState().diffSession;
          if (finalSession) createVersionSnapshot(editor, finalSession);
        }
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

    // Create version snapshot before ending review
    if (editor) {
      const finalSession = useDiffReviewStore.getState().diffSession;
      if (finalSession) createVersionSnapshot(editor, finalSession);
    }

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

  // Compute 1-based position of current hunk among pending hunks
  const currentPendingPosition = (() => {
    if (!diffSession || currentHunkIndex < 0) return 0;
    const pendingIndices = diffSession.hunks
      .map((h, i) => ({ status: h.status, index: i }))
      .filter(({ status }) => status === "pending")
      .map(({ index }) => index);
    const pos = pendingIndices.indexOf(currentHunkIndex);
    return pos >= 0 ? pos + 1 : 0;
  })();

  return {
    isReviewMode,
    pendingCount,
    currentPendingPosition,
    handleAcceptAll,
    handleRejectAll,
    handleNextHunk: goToNextHunk,
    handlePreviousHunk: goToPreviousHunk,
  };
}
