import { create } from "zustand";
import { persist } from "zustand/middleware";

import { api, CommunityItem } from "@/lib/api";

type SortOption = "newest" | "popular" | "most_viewed" | "for_you";

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
          const result =
            sortBy === "for_you"
              ? await api.getCommunityRecommendations({
                  limit: PAGE_SIZE,
                  offset: 0,
                })
              : await api.getCommunityItems({
                  sort: sortBy,
                  search: searchQuery || undefined,
                  tag: tagFilter || undefined,
                  limit: PAGE_SIZE,
                  offset: 0,
                });

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
          const result =
            sortBy === "for_you"
              ? await api.getCommunityRecommendations({
                  limit: PAGE_SIZE,
                  offset,
                })
              : await api.getCommunityItems({
                  sort: sortBy,
                  search: searchQuery || undefined,
                  tag: tagFilter || undefined,
                  limit: PAGE_SIZE,
                  offset,
                });

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
