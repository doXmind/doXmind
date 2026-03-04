/**
 * Notifications API methods - extends ApiClient prototype
 */

import { ApiClient } from "./client";
import type { NotificationListResponse } from "./types";

declare module "./client" {
  interface ApiClient {
    getNotifications(offset?: number, limit?: number): Promise<NotificationListResponse>;
    getUnreadNotificationCount(): Promise<{ count: number }>;
    markNotificationRead(id: string): Promise<{ status: string }>;
    markAllNotificationsRead(): Promise<{ status: string; updated: number }>;
  }
}

ApiClient.prototype.getNotifications = async function (
  this: ApiClient,
  offset = 0,
  limit = 20
): Promise<NotificationListResponse> {
  return this.request<NotificationListResponse>(
    `/api/notifications?offset=${offset}&limit=${limit}`
  );
};

ApiClient.prototype.getUnreadNotificationCount = async function (
  this: ApiClient
): Promise<{ count: number }> {
  return this.request<{ count: number }>(`/api/notifications/unread-count`);
};

ApiClient.prototype.markNotificationRead = async function (
  this: ApiClient,
  id: string
): Promise<{ status: string }> {
  return this.request<{ status: string }>(`/api/notifications/${id}/read`, {
    method: "PATCH",
  });
};

ApiClient.prototype.markAllNotificationsRead = async function (
  this: ApiClient
): Promise<{ status: string; updated: number }> {
  return this.request<{ status: string; updated: number }>(`/api/notifications/read-all`, {
    method: "PATCH",
  });
};
