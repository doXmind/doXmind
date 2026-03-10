import { create } from "zustand";
import { persist } from "zustand/middleware";

import { api, CommunityItem } from "@/lib/api";
import { eventBus } from "@/lib/events";

type SortOption = "newest" | "popular" | "most_viewed" | "for_you" | "following";

interface CommunityState {
  items: CommunityItem[];
  isLoading: boolean;
  hasMore: boolean;
  total: number;
  offset: number;
  sortBy: SortOption;
  searchQuery: string;
  tagFilter: string;
  error: string | null;

  // Actions
  loadItems: (reset?: boolean) => Promise<void>;
  loadMore: () => Promise<void>;
  setSortBy: (sort: SortOption) => void;
  setSearchQuery: (query: string) => void;
  setTagFilter: (tag: string) => void;
  updateItemAuthor: (
    userId: string,
    updates: { username?: string | null; avatar_url?: string | null; avatar_frame?: string | null }
  ) => void;
  updateItemReactions: (
    shareToken: string,
    reactions: { emoji: string; count: number; has_reacted: boolean }[]
  ) => void;
  reset: () => void;
}

const PAGE_SIZE = 20;

export const useCommunityStore = create<CommunityState>()(
  persist(
    (set, get) => ({
      items: [],
      isLoading: false,
      hasMore: false,
      total: 0,
      offset: 0,
      sortBy: "newest",
      searchQuery: "",
      tagFilter: "",
      error: null,

      loadItems: async (reset = true) => {
        const { sortBy, searchQuery, tagFilter } = get();

        if (reset) {
          set({ isLoading: true, offset: 0, items: [], error: null });
        }

        try {
          const hasFilters = !!(searchQuery || tagFilter);
          let result;
          if (sortBy === "following" && !hasFilters) {
            result = await api.getFollowingFeed({ limit: PAGE_SIZE, offset: 0 });
          } else if (sortBy === "for_you" && !hasFilters) {
            result = await api.getCommunityRecommendations({
              limit: PAGE_SIZE,
              offset: 0,
            });
          } else {
            result = await api.getCommunityItems({
              sort: sortBy === "for_you" || sortBy === "following" ? "newest" : sortBy,
              search: searchQuery || undefined,
              tag: tagFilter || undefined,
              limit: PAGE_SIZE,
              offset: 0,
            });
          }

          set({
            items: result.items,
            total: result.total,
            hasMore: result.has_more,
            offset: PAGE_SIZE,
            isLoading: false,
          });
        } catch (err) {
          set({
            isLoading: false,
            error: err instanceof Error ? err.message : "Failed to load community posts",
          });
        }
      },

      loadMore: async () => {
        const { sortBy, searchQuery, tagFilter, offset, isLoading } = get();
        if (isLoading) return;

        set({ isLoading: true });

        try {
          const hasFilters = !!(searchQuery || tagFilter);
          let result;
          if (sortBy === "following" && !hasFilters) {
            result = await api.getFollowingFeed({ limit: PAGE_SIZE, offset });
          } else if (sortBy === "for_you" && !hasFilters) {
            result = await api.getCommunityRecommendations({
              limit: PAGE_SIZE,
              offset,
            });
          } else {
            result = await api.getCommunityItems({
              sort: sortBy === "for_you" || sortBy === "following" ? "newest" : sortBy,
              search: searchQuery || undefined,
              tag: tagFilter || undefined,
              limit: PAGE_SIZE,
              offset,
            });
          }

          set((state) => ({
            items: [...state.items, ...result.items],
            total: result.total,
            hasMore: result.has_more,
            offset: state.offset + PAGE_SIZE,
            isLoading: false,
          }));
        } catch {
          set({ isLoading: false });
        }
      },

      setSortBy: (sort) => {
        set({ sortBy: sort });
        get().loadItems();
      },

      setSearchQuery: (query) => {
        set({ searchQuery: query });
      },

      setTagFilter: (tag) => {
        set({ tagFilter: tag });
        get().loadItems();
      },

      updateItemAuthor: (userId, updates) => {
        set((state) => ({
          items: state.items.map((item) =>
            item.owner.id === userId ? { ...item, owner: { ...item.owner, ...updates } } : item
          ),
        }));
      },

      updateItemReactions: (shareToken, reactions) => {
        set((state) => ({
          items: state.items.map((item) =>
            item.share_token === shareToken ? { ...item, reactions } : item
          ),
        }));
      },

      reset: () => {
        set({
          items: [],
          isLoading: false,
          hasMore: false,
          total: 0,
          offset: 0,
          searchQuery: "",
          tagFilter: "",
        });
      },
    }),
    {
      name: "doxmind-community",
      partialize: (state) => ({ sortBy: state.sortBy }),
    }
  )
);

// Sync community feed author info when a user updates their profile
if (typeof window !== "undefined") {
  eventBus.on("profile:updated", ({ user }) => {
    const { items } = useCommunityStore.getState();
    if (items.some((item) => item.owner.id === user.id)) {
      useCommunityStore.getState().updateItemAuthor(user.id, {
        username: user.username,
        avatar_url: user.avatar_url,
        avatar_frame: user.avatar_frame,
      });
    }
  });
}
