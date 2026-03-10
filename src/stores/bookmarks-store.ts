import { create } from "zustand";
import { persist } from "zustand/middleware";

import { api, CommunityItem } from "@/lib/api";
import { eventBus } from "@/lib/events";

interface BookmarksState {
  bookmarks: CommunityItem[];
  bookmarkedIds: Set<string>;
  isLoading: boolean;

  // Actions
  loadBookmarks: () => Promise<void>;
  toggleBookmark: (shareToken: string, shareId: string) => Promise<boolean>;
  isBookmarked: (shareId: string) => boolean;
}

export const useBookmarksStore = create<BookmarksState>()(
  persist(
    (set, get) => ({
      bookmarks: [],
      bookmarkedIds: new Set<string>(),
      isLoading: false,

      loadBookmarks: async () => {
        set({ isLoading: true });
        try {
          const result = await api.getBookmarks();
          const ids = new Set(result.items.map((item) => item.share_id));
          set({
            bookmarks: result.items,
            bookmarkedIds: ids,
            isLoading: false,
          });
        } catch {
          set({ isLoading: false });
        }
      },

      toggleBookmark: async (shareToken, shareId) => {
        const { bookmarkedIds } = get();
        const wasBookmarked = bookmarkedIds.has(shareId);

        // Optimistic update
        const newIds = new Set(bookmarkedIds);
        if (wasBookmarked) {
          newIds.delete(shareId);
        } else {
          newIds.add(shareId);
        }
        set({ bookmarkedIds: newIds });

        try {
          const result = await api.toggleBookmark(shareToken);
          eventBus.emit("bookmark:changed");
          return result.bookmarked;
        } catch {
          // Revert on error
          const revertIds = new Set(get().bookmarkedIds);
          if (wasBookmarked) {
            revertIds.add(shareId);
          } else {
            revertIds.delete(shareId);
          }
          set({ bookmarkedIds: revertIds });
          return wasBookmarked;
        }
      },

      isBookmarked: (shareId) => {
        return get().bookmarkedIds.has(shareId);
      },
    }),
    {
      name: "doxmind-bookmarks",
      partialize: (state) => ({
        bookmarkedIds: Array.from(state.bookmarkedIds),
      }),
      merge: (persisted, current) => {
        const persistedState = persisted as { bookmarkedIds?: string[] };
        return {
          ...current,
          bookmarkedIds: new Set(persistedState?.bookmarkedIds || []),
        };
      },
    }
  )
);

// Load bookmarks on login, clear on logout
if (typeof window !== "undefined") {
  eventBus.on("auth:login", () => {
    useBookmarksStore.getState().loadBookmarks();
  });
  eventBus.on("auth:logout", () => {
    useBookmarksStore.setState({ bookmarks: [], bookmarkedIds: new Set() });
  });
}
