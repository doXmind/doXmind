/**
 * Diff Review Store
 *
 * Manages state for AI-powered diff review functionality.
 * Extracted from editor-store for better separation of concerns.
 */

import { create } from "zustand";
import type { DiffHunk, DiffSession } from "@/types/diff";

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

  startDiffReview: (fileId, hunks, originalContent) =>
    set({
      diffSession: {
        id: crypto.randomUUID(),
        fileId,
        hunks,
        isActive: true,
        originalContent,
        createdAt: new Date().toISOString(),
      },
      isReviewMode: true,
    }),

  endDiffReview: () =>
    set({
      diffSession: null,
      isReviewMode: false,
    }),

  acceptHunk: (hunkId) =>
    set((state) => {
      if (!state.diffSession) return state;
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
