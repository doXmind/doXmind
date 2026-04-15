/**
 * Notification store stub — local desktop edition has no notifications.
 */

import { create } from "zustand";

interface NotificationState {
  notifications: never[];
  unreadCount: number;
  isLoading: boolean;
  loadNotifications: () => Promise<void>;
  markAsRead: (_id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}

export const useNotificationStore = create<NotificationState>(() => ({
  notifications: [],
  unreadCount: 0,
  isLoading: false,
  loadNotifications: async () => {},
  markAsRead: async () => {},
  markAllAsRead: async () => {},
}));
