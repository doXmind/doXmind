import { create } from "zustand";
import { api } from "@/lib/api";
import type { NotificationItem } from "@/lib/api/types";

interface NotificationState {
  unreadCount: number;
  notifications: NotificationItem[];
  isLoading: boolean;
  hasMore: boolean;
  total: number;

  // Actions
  fetchUnreadCount: () => Promise<void>;
  fetchNotifications: () => Promise<void>;
  loadMore: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  reset: () => void;
}

export const useNotificationStore = create<NotificationState>()((set, get) => ({
  unreadCount: 0,
  notifications: [],
  isLoading: false,
  hasMore: false,
  total: 0,

  fetchUnreadCount: async () => {
    try {
      const { count } = await api.getUnreadNotificationCount();
      set({ unreadCount: count });
    } catch {
      // Silently fail for polling
    }
  },

  fetchNotifications: async () => {
    set({ isLoading: true });
    try {
      const res = await api.getNotifications(0, 20);
      set({
        notifications: res.notifications,
        total: res.total,
        hasMore: res.has_more,
        isLoading: false,
      });
    } catch {
      set({ isLoading: false });
    }
  },

  loadMore: async () => {
    const { notifications, isLoading } = get();
    if (isLoading) return;

    set({ isLoading: true });
    try {
      const res = await api.getNotifications(notifications.length, 20);
      set({
        notifications: [...notifications, ...res.notifications],
        total: res.total,
        hasMore: res.has_more,
        isLoading: false,
      });
    } catch {
      set({ isLoading: false });
    }
  },

  markRead: async (id: string) => {
    // Optimistic update
    set((state) => ({
      notifications: state.notifications.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }));
    try {
      await api.markNotificationRead(id);
    } catch {
      // Revert on failure
      get().fetchNotifications();
      get().fetchUnreadCount();
    }
  },

  markAllRead: async () => {
    const prevCount = get().unreadCount;
    // Optimistic update
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, is_read: true })),
      unreadCount: 0,
    }));
    try {
      await api.markAllNotificationsRead();
    } catch {
      set({ unreadCount: prevCount });
      get().fetchNotifications();
    }
  },

  reset: () => {
    set({
      unreadCount: 0,
      notifications: [],
      isLoading: false,
      hasMore: false,
      total: 0,
    });
  },
}));
