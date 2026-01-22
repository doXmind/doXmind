/**
 * Diff Review Store
 *
 * Manages state for AI-powered diff review functionality.
 * Extracted from editor-store for better separation of concerns.
 *
 * Includes telemetry for RLHF training data collection:
 * - Tracks accept/reject decisions on AI suggestions
 * - Records original content and AI suggestions for preference learning
 */

import { create } from "zustand";
import type { DiffHunk, DiffSession } from "@/types/diff";
import { telemetry } from "@/lib/telemetry";
import { useEditorStore } from "./editor-store";

interface DiffReviewState {
  // State
  diffSession: DiffSession | null;
  isReviewMode: boolean;

  // Actions
  startDiffReview: (fileId: string, hunks: DiffHunk[], originalContent: string) => void;
  endDiffReview: () => void;
  acceptHunk: (hunkId: string) => void;
  rejectHunk: (hunkId: string) => void;
  acceptAllHunks: () => void;
  rejectAllHunks: () => void;
  addHunksToDiffSession: (hunks: DiffHunk[]) => void;
}

export const useDiffReviewStore = create<DiffReviewState>()((set) => ({
  diffSession: null,
  isReviewMode: false,

  startDiffReview: (fileId, hunks, originalContent) => {
    const now = Date.now();
    set({
      diffSession: {
        id: crypto.randomUUID(),
        fileId,
        hunks: hunks.map((h) => ({ ...h, displayedAt: now })),
        isActive: true,
        originalContent,
        createdAt: new Date().toISOString(),
        startedAt: now,
      },
      isReviewMode: true,
    });
  },

  endDiffReview: () =>
    set({
      diffSession: null,
      isReviewMode: false,
    }),

  acceptHunk: (hunkId) =>
    set((state) => {
      if (!state.diffSession) return state;

      // Find the hunk for telemetry
      const hunk = state.diffSession.hunks.find((h) => h.id === hunkId);
      if (hunk) {
        // Calculate time to decision
        const timeToDecision = hunk.displayedAt
          ? Date.now() - hunk.displayedAt
          : undefined;

        // Track accept event for RLHF training
        telemetry.trackDiffReview({
          event_type: "diff_hunk_accepted",
          hunk_id: hunkId,
          file_id: state.diffSession.fileId,
          original_content: hunk.oldContent || "",
          ai_suggestion: hunk.newContent || "",
          user_action: "accept",
          time_to_decision_ms: timeToDecision,
        });

        // Record last AI operation for undo tracking
        useEditorStore.getState().setLastAIOperation({
          type: "diff_accept",
          timestamp: Date.now(),
          content: hunk.newContent,
        });
      }

      return {
        diffSession: {
          ...state.diffSession,
          hunks: state.diffSession.hunks.map((h) =>
            h.id === hunkId ? { ...h, status: "accepted" as const } : h
          ),
        },
      };
    }),

  rejectHunk: (hunkId) =>
    set((state) => {
      if (!state.diffSession) return state;

      // Find the hunk for telemetry
      const hunk = state.diffSession.hunks.find((h) => h.id === hunkId);
      if (hunk) {
        // Calculate time to decision
        const timeToDecision = hunk.displayedAt
          ? Date.now() - hunk.displayedAt
          : undefined;

        // Track reject event for RLHF training
        telemetry.trackDiffReview({
          event_type: "diff_hunk_rejected",
          hunk_id: hunkId,
          file_id: state.diffSession.fileId,
          original_content: hunk.oldContent || "",
          ai_suggestion: hunk.newContent || "",
          user_action: "reject",
          time_to_decision_ms: timeToDecision,
        });
      }

      return {
        diffSession: {
          ...state.diffSession,
          hunks: state.diffSession.hunks.map((h) =>
            h.id === hunkId ? { ...h, status: "rejected" as const } : h
          ),
        },
      };
    }),

  acceptAllHunks: () =>
    set((state) => {
      if (!state.diffSession) return state;

      // Track each pending hunk individually for RLHF training
      const pendingHunks = state.diffSession.hunks.filter(
        (h) => h.status === "pending"
      );
      const now = Date.now();
      for (const hunk of pendingHunks) {
        const timeToDecision = hunk.displayedAt
          ? now - hunk.displayedAt
          : undefined;
        telemetry.trackDiffReview({
          event_type: "diff_hunk_accepted",
          hunk_id: hunk.id,
          file_id: state.diffSession.fileId,
          original_content: hunk.oldContent || "",
          ai_suggestion: hunk.newContent || "",
          user_action: "accept",
          time_to_decision_ms: timeToDecision,
        });
      }

      return {
        diffSession: {
          ...state.diffSession,
          hunks: state.diffSession.hunks.map((h) => ({
            ...h,
            status: "accepted" as const,
          })),
        },
      };
    }),

  rejectAllHunks: () =>
    set((state) => {
      if (!state.diffSession) return state;

      // Track each pending hunk individually for RLHF training
      const pendingHunks = state.diffSession.hunks.filter(
        (h) => h.status === "pending"
      );
      const now = Date.now();
      for (const hunk of pendingHunks) {
        const timeToDecision = hunk.displayedAt
          ? now - hunk.displayedAt
          : undefined;
        telemetry.trackDiffReview({
          event_type: "diff_hunk_rejected",
          hunk_id: hunk.id,
          file_id: state.diffSession.fileId,
          original_content: hunk.oldContent || "",
          ai_suggestion: hunk.newContent || "",
          user_action: "reject",
          time_to_decision_ms: timeToDecision,
        });
      }

      return {
        diffSession: {
          ...state.diffSession,
          hunks: state.diffSession.hunks.map((h) => ({
            ...h,
            status: "rejected" as const,
          })),
        },
      };
    }),

  addHunksToDiffSession: (hunks) =>
    set((state) => {
      if (!state.diffSession) return state;
      return {
        diffSession: {
          ...state.diffSession,
          hunks: [...state.diffSession.hunks, ...hunks],
        },
      };
    }),
}));
