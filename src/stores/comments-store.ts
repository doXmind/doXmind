import { create } from "zustand";

import { api, type CommentResponse } from "@/lib/api";
import { eventBus } from "@/lib/events";

type CommentSort = "oldest" | "newest";

const PAGE_SIZE = 50;

interface CommentsState {
  comments: CommentResponse[];
  isLoading: boolean;
  isLoadingMore: boolean;
  isSubmitting: boolean;
  total: number;
  hasMore: boolean;
  currentShareToken: string | null;
  sort: CommentSort;

  // Actions
  loadComments: (shareToken: string) => Promise<void>;
  loadMoreComments: () => Promise<void>;
  setSort: (sort: CommentSort) => void;
  addComment: (
    shareToken: string,
    content: string,
    parentId?: string | null
  ) => Promise<CommentResponse | null>;
  editComment: (
    shareToken: string,
    commentId: string,
    content: string
  ) => Promise<CommentResponse | null>;
  deleteComment: (shareToken: string, commentId: string) => Promise<boolean>;
  toggleReaction: (shareToken: string, commentId: string, emoji: string) => Promise<void>;
  loadReplies: (shareToken: string, commentId: string) => Promise<CommentResponse[]>;
  reset: () => void;
}

export const useCommentsStore = create<CommentsState>()((set, get) => ({
  comments: [],
  isLoading: false,
  isLoadingMore: false,
  isSubmitting: false,
  total: 0,
  hasMore: false,
  currentShareToken: null,
  sort: "oldest",

  loadComments: async (shareToken) => {
    const { sort } = get();
    set({ isLoading: true, currentShareToken: shareToken, comments: [] });
    try {
      const result = await api.getComments(shareToken, PAGE_SIZE, 0, sort);
      set({
        comments: result.comments,
        total: result.total,
        hasMore: result.has_more,
        isLoading: false,
      });
    } catch {
      set({ isLoading: false });
    }
  },

  loadMoreComments: async () => {
    const { currentShareToken, comments, isLoadingMore, sort } = get();
    if (!currentShareToken || isLoadingMore) return;

    set({ isLoadingMore: true });
    try {
      const result = await api.getComments(currentShareToken, PAGE_SIZE, comments.length, sort);
      set((state) => ({
        comments: [...state.comments, ...result.comments],
        total: result.total,
        hasMore: result.has_more,
        isLoadingMore: false,
      }));
    } catch {
      set({ isLoadingMore: false });
    }
  },

  setSort: (sort) => {
    const { currentShareToken } = get();
    set({ sort });
    if (currentShareToken) {
      get().loadComments(currentShareToken);
    }
  },

  addComment: async (shareToken, content, parentId) => {
    set({ isSubmitting: true });
    try {
      const comment = await api.createComment(shareToken, content, parentId);

      if (!parentId) {
        // Top-level comment — add to end (oldest sort) or start (newest sort)
        const { sort } = get();
        set((state) => ({
          comments: sort === "newest" ? [comment, ...state.comments] : [...state.comments, comment],
          total: state.total + 1,
          isSubmitting: false,
        }));
      } else {
        // Reply - update parent's reply count
        set((state) => ({
          comments: state.comments.map((c) =>
            c.id === parentId ? { ...c, reply_count: c.reply_count + 1 } : c
          ),
          isSubmitting: false,
        }));
      }

      return comment;
    } catch {
      set({ isSubmitting: false });
      return null;
    }
  },

  editComment: async (shareToken, commentId, content) => {
    try {
      const updated = await api.editComment(shareToken, commentId, content);

      set((state) => ({
        comments: state.comments.map((c) => (c.id === commentId ? { ...c, ...updated } : c)),
      }));

      return updated;
    } catch {
      return null;
    }
  },

  deleteComment: async (shareToken, commentId) => {
    try {
      await api.deleteComment(shareToken, commentId);

      set((state) => ({
        comments: state.comments.map((c) =>
          c.id === commentId
            ? {
                ...c,
                is_deleted: true,
                content: "[deleted]",
                author: { id: "", username: "[deleted]", avatar_url: null },
              }
            : c
        ),
        total: state.total - 1,
      }));

      return true;
    } catch {
      return false;
    }
  },

  toggleReaction: async (shareToken, commentId, emoji) => {
    try {
      const result = await api.toggleReaction(shareToken, commentId, emoji);

      set((state) => ({
        comments: state.comments.map((c) =>
          c.id === commentId ? { ...c, reactions: result.reactions } : c
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

  reset: () => {
    set({
      comments: [],
      isLoading: false,
      isLoadingMore: false,
      isSubmitting: false,
      total: 0,
      hasMore: false,
      currentShareToken: null,
      sort: "oldest",
    });
  },
}));

// Sync comment author info when a user updates their profile
if (typeof window !== "undefined") {
  eventBus.on("profile:updated", ({ user }) => {
    const { comments } = useCommentsStore.getState();
    if (comments.some((c) => c.author.id === user.id)) {
      useCommentsStore.setState({
        comments: comments.map((c) =>
          c.author.id === user.id
            ? {
                ...c,
                author: {
                  ...c.author,
                  username: user.username ?? c.author.username,
                  avatar_url: user.avatar_url ?? c.author.avatar_url,
                  avatar_frame: user.avatar_frame ?? c.author.avatar_frame,
                },
              }
            : c
        ),
      });
    }
  });
}
