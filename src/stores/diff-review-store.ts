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
import type { DiffHunk, DiffSession, EditFeedbackItem } from "@/types/diff";
import { telemetry } from "@/lib/telemetry";
import { useEditSnapshotStore } from "./edit-snapshot-store";
import { useEditorStore } from "./editor-store";
import { splitMarkdownIntoHunks } from "@/lib/diff-utils";

interface DiffReviewState {
  // State
  diffSession: DiffSession | null;
  isReviewMode: boolean;
  pendingFeedback: EditFeedbackItem[];
  currentHunkIndex: number;
  /** Tracks whether currentHunkIndex changed from user navigation or auto-advance */
  navigationSource: "user" | "auto" | null;

  // Actions
  startDiffReview: (
    fileId: string,
    hunks: DiffHunk[],
    originalContent: string,
    originalMarkdown?: string,
    workingMarkdown?: string
  ) => void;
  endDiffReview: () => void;
  acceptHunk: (hunkId: string) => void;
  rejectHunk: (hunkId: string) => void;
  acceptAllHunks: () => void;
  rejectAllHunks: () => void;
  addHunksToDiffSession: (hunks: DiffHunk[], workingMarkdown?: string) => void;
  consumePendingFeedback: () => EditFeedbackItem[];
  goToNextHunk: () => void;
  goToPreviousHunk: () => void;
  setCurrentHunkIndex: (index: number) => void;
}

/** Build feedback item from a hunk and decision */
function buildFeedback(hunk: DiffHunk, decision: "accepted" | "rejected"): EditFeedbackItem {
  return {
    editType: hunk.isFullDocumentReplace ? "replace_all" : "str_replace",
    oldContent: (hunk.oldContent || "").slice(0, 80),
    newContent: (hunk.newContent || "").slice(0, 80),
    decision,
  };
}

/** Find the next pending hunk index after the given index (wraps around) */
function findNextPendingIndex(hunks: DiffHunk[], afterIndex: number): number {
  const pendingIndices = hunks
    .map((h, i) => ({ status: h.status, index: i }))
    .filter(({ status }) => status === "pending")
    .map(({ index }) => index);
  if (pendingIndices.length === 0) return -1;
  return pendingIndices.find((i) => i > afterIndex) ?? pendingIndices[0];
}

/** Find the previous pending hunk index before the given index (wraps around) */
function findPrevPendingIndex(hunks: DiffHunk[], beforeIndex: number): number {
  const pendingIndices = hunks
    .map((h, i) => ({ status: h.status, index: i }))
    .filter(({ status }) => status === "pending")
    .map(({ index }) => index);
  if (pendingIndices.length === 0) return -1;
  const reversed = [...pendingIndices].reverse();
  return reversed.find((i) => i < beforeIndex) ?? reversed[0];
}

export const useDiffReviewStore = create<DiffReviewState>()((set, get) => ({
  diffSession: null,
  isReviewMode: false,
  pendingFeedback: [],
  currentHunkIndex: -1,
  navigationSource: null,

  startDiffReview: (fileId, hunks, originalContent, originalMarkdown?, workingMarkdown?) => {
    const now = Date.now();
    set({
      diffSession: {
        id: crypto.randomUUID(),
        fileId,
        hunks: hunks.map((h) => ({ ...h, displayedAt: now })),
        isActive: true,
        originalContent,
        originalMarkdown,
        workingMarkdown,
        createdAt: new Date().toISOString(),
        startedAt: now,
      },
      isReviewMode: true,
      currentHunkIndex: 0,
      navigationSource: null,
    });
  },

  endDiffReview: () => {
    const session = get().diffSession;
    if (session) {
      useEditSnapshotStore.getState().clearSnapshot(session.fileId);
    }
    set({
      diffSession: null,
      isReviewMode: false,
      currentHunkIndex: -1,
      navigationSource: null,
    });
  },

  acceptHunk: (hunkId) =>
    set((state) => {
      if (!state.diffSession) return state;

      // Find the hunk for telemetry
      const hunk = state.diffSession.hunks.find((h) => h.id === hunkId);
      if (hunk) {
        // Calculate time to decision
        const timeToDecision = hunk.displayedAt ? Date.now() - hunk.displayedAt : undefined;

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

      const updatedHunks = state.diffSession.hunks.map((h) =>
        h.id === hunkId ? { ...h, status: "accepted" as const } : h
      );

      return {
        pendingFeedback: hunk
          ? [...state.pendingFeedback, buildFeedback(hunk, "accepted")]
          : state.pendingFeedback,
        diffSession: {
          ...state.diffSession,
          hunks: updatedHunks,
        },
        currentHunkIndex: findNextPendingIndex(updatedHunks, state.currentHunkIndex),
        navigationSource: "auto" as const,
      };
    }),

  rejectHunk: (hunkId) =>
    set((state) => {
      if (!state.diffSession) return state;

      // Find the hunk for telemetry
      const hunk = state.diffSession.hunks.find((h) => h.id === hunkId);
      if (hunk) {
        // Calculate time to decision
        const timeToDecision = hunk.displayedAt ? Date.now() - hunk.displayedAt : undefined;

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

      const updatedHunks = state.diffSession.hunks.map((h) =>
        h.id === hunkId ? { ...h, status: "rejected" as const } : h
      );

      return {
        pendingFeedback: hunk
          ? [...state.pendingFeedback, buildFeedback(hunk, "rejected")]
          : state.pendingFeedback,
        diffSession: {
          ...state.diffSession,
          hunks: updatedHunks,
        },
        currentHunkIndex: findNextPendingIndex(updatedHunks, state.currentHunkIndex),
        navigationSource: "auto" as const,
      };
    }),

  acceptAllHunks: () =>
    set((state) => {
      if (!state.diffSession) return state;

      // Track each pending hunk individually for RLHF training
      const pendingHunks = state.diffSession.hunks.filter((h) => h.status === "pending");
      const now = Date.now();
      for (const hunk of pendingHunks) {
        const timeToDecision = hunk.displayedAt ? now - hunk.displayedAt : undefined;
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
        pendingFeedback: [
          ...state.pendingFeedback,
          ...pendingHunks.map((h) => buildFeedback(h, "accepted")),
        ],
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
      const pendingHunks = state.diffSession.hunks.filter((h) => h.status === "pending");
      const now = Date.now();
      for (const hunk of pendingHunks) {
        const timeToDecision = hunk.displayedAt ? now - hunk.displayedAt : undefined;
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
        pendingFeedback: [
          ...state.pendingFeedback,
          ...pendingHunks.map((h) => buildFeedback(h, "rejected")),
        ],
        diffSession: {
          ...state.diffSession,
          hunks: state.diffSession.hunks.map((h) => ({
            ...h,
            status: "rejected" as const,
          })),
        },
      };
    }),

  addHunksToDiffSession: (hunks, workingMarkdown?) =>
    set((state) => {
      if (!state.diffSession) return state;

      const originalMarkdown = state.diffSession.originalMarkdown || "";
      const updatedWorkingMarkdown = workingMarkdown || state.diffSession.workingMarkdown;

      // Detect sequential edits: old_str doesn't exist in originalMarkdown
      // This means the backend validated it against a cumulative state that
      // the frontend document doesn't have (previous edits not yet accepted).
      const hasSequentialDependency = hunks.some(
        (h) => h.oldContent && !originalMarkdown.includes(h.oldContent)
      );

      if (hasSequentialDependency && updatedWorkingMarkdown && originalMarkdown) {
        // Sequential edits detected — split the original→final diff into
        // multiple regional hunks instead of one monolithic full-doc-replace.
        const regionalHunks = splitMarkdownIntoHunks(originalMarkdown, updatedWorkingMarkdown);
        if (regionalHunks.length === 0) return state;

        const now = Date.now();
        return {
          diffSession: {
            ...state.diffSession,
            hunks: [
              // Keep already accepted/rejected hunks
              ...state.diffSession.hunks.filter((h) => h.status !== "pending"),
              // Replace all pending + new hunks with granular regional hunks
              ...regionalHunks.map((h) => ({ ...h, displayedAt: now })),
            ],
            workingMarkdown: updatedWorkingMarkdown,
          },
          currentHunkIndex: 0,
        };
      }

      return {
        diffSession: {
          ...state.diffSession,
          hunks: [...state.diffSession.hunks, ...hunks],
          workingMarkdown: updatedWorkingMarkdown,
        },
      };
    }),

  goToNextHunk: () =>
    set((state) => {
      if (!state.diffSession) return state;
      const nextIndex = findNextPendingIndex(state.diffSession.hunks, state.currentHunkIndex);
      return { currentHunkIndex: nextIndex, navigationSource: "user" as const };
    }),

  goToPreviousHunk: () =>
    set((state) => {
      if (!state.diffSession) return state;
      const prevIndex = findPrevPendingIndex(state.diffSession.hunks, state.currentHunkIndex);
      return { currentHunkIndex: prevIndex, navigationSource: "user" as const };
    }),

  setCurrentHunkIndex: (index: number) => set({ currentHunkIndex: index }),

  consumePendingFeedback: () => {
    const feedback = get().pendingFeedback;
    if (feedback.length > 0) {
      set({ pendingFeedback: [] });
    }
    return feedback;
  },
}));
