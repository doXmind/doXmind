import { create } from "zustand";

import { api } from "@/lib/api";
import type { InlineCommentResponse, CommentResponse } from "@/lib/api/types";

interface PendingSelection {
  from: number;
  to: number;
  text: string;
  contextBefore: string | null;
  contextAfter: string | null;
}

interface InlineCommentsState {
  threads: InlineCommentResponse[];
  activeThreadId: string | null;
  pendingSelection: PendingSelection | null;
  showResolved: boolean;
  sidebarOpen: boolean;
  isLoading: boolean;
  isSubmitting: boolean;
  currentShareToken: string | null;
  total: number;

  // Actions
  loadComments: (shareToken: string) => Promise<void>;
  createComment: (
    shareToken: string,
    content: string,
    anchorFrom: number,
    anchorTo: number,
    anchorText: string,
    anchorContextBefore?: string | null,
    anchorContextAfter?: string | null
  ) => Promise<InlineCommentResponse | null>;
  resolveComment: (shareToken: string, commentId: string) => Promise<void>;
  unresolveComment: (shareToken: string, commentId: string) => Promise<void>;
  toggleReaction: (shareToken: string, commentId: string, emoji: string) => Promise<void>;
  loadReplies: (shareToken: string, commentId: string) => Promise<CommentResponse[]>;
  setActiveThread: (id: string | null) => void;
  setPendingSelection: (selection: PendingSelection | null) => void;
  toggleShowResolved: () => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  reset: () => void;
}

export const useInlineCommentsStore = create<InlineCommentsState>()((set, get) => ({
  threads: [],
  activeThreadId: null,
  pendingSelection: null,
  showResolved: false,
  sidebarOpen: false,
  isLoading: false,
  isSubmitting: false,
  currentShareToken: null,
  total: 0,

  loadComments: async (shareToken) => {
    const { showResolved } = get();
    set({ isLoading: true, currentShareToken: shareToken, threads: [] });
    try {
      const result = await api.getInlineComments(shareToken, showResolved);
      set({
        threads: result.comments,
        total: result.total,
        isLoading: false,
      });
    } catch {
      set({ isLoading: false });
    }
  },

  createComment: async (
    shareToken,
    content,
    anchorFrom,
    anchorTo,
    anchorText,
    anchorContextBefore,
    anchorContextAfter
  ) => {
    set({ isSubmitting: true });
    try {
      const comment = await api.createInlineComment(
        shareToken,
        content,
        anchorFrom,
        anchorTo,
        anchorText,
        anchorContextBefore,
        anchorContextAfter
      );
      set((state) => ({
        threads: [...state.threads, comment].sort((a, b) => a.anchor.from - b.anchor.from),
        total: state.total + 1,
        isSubmitting: false,
        pendingSelection: null,
      }));
      return comment;
    } catch {
      set({ isSubmitting: false });
      return null;
    }
  },

  resolveComment: async (shareToken, commentId) => {
    try {
      await api.resolveInlineComment(shareToken, commentId);
      set((state) => ({
        threads: state.threads.map((t) => (t.id === commentId ? { ...t, is_resolved: true } : t)),
      }));
    } catch {
      // Ignore errors
    }
  },

  unresolveComment: async (shareToken, commentId) => {
    try {
      await api.unresolveInlineComment(shareToken, commentId);
      set((state) => ({
        threads: state.threads.map((t) => (t.id === commentId ? { ...t, is_resolved: false } : t)),
      }));
    } catch {
      // Ignore errors
    }
  },

  toggleReaction: async (shareToken, commentId, emoji) => {
    try {
      const result = await api.toggleReaction(shareToken, commentId, emoji);
      set((state) => ({
        threads: state.threads.map((t) =>
          t.id === commentId ? { ...t, reactions: result.reactions } : t
        ),
      }));
    } catch {
      // Ignore errors
    }
  },

  loadReplies: async (shareToken, commentId) => {
    try {
      const result = await api.getCommentReplies(shareToken, commentId);
      return result.comments;
    } catch {
      return [];
    }
  },

  setActiveThread: (id) => set({ activeThreadId: id }),
  setPendingSelection: (selection) => set({ pendingSelection: selection }),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  toggleShowResolved: () => {
    const { currentShareToken, showResolved } = get();
    set({ showResolved: !showResolved });
    if (currentShareToken) {
      // Reload with new filter — use the toggled value
      get().loadComments(currentShareToken);
    }
  },

  reset: () => {
    set({
      threads: [],
      activeThreadId: null,
      pendingSelection: null,
      showResolved: false,
      sidebarOpen: false,
      isLoading: false,
      isSubmitting: false,
      currentShareToken: null,
      total: 0,
    });
  },
}));
