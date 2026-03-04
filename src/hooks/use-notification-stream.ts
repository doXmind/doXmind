"use client";

import { useEffect, useRef, useCallback } from "react";
import { useNotificationStore } from "@/stores/notification-store";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/lib/api";
import { parseSSELine } from "@/lib/streaming";
import type { NotificationItem } from "@/lib/api/types";

interface NotificationSSEEvent {
  event: "connected" | "notification" | "unread_count" | "heartbeat" | "error";
  notification?: NotificationItem;
  unread_count?: number;
  message?: string;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30_000;
const FALLBACK_POLL_INTERVAL = 60_000;

export function useNotificationStream() {
  const user = useAuthStore((s) => s.user);
  const fetchUnreadCount = useNotificationStore((s) => s.fetchUnreadCount);

  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  const stopFallbackPolling = useCallback(() => {
    if (fallbackTimerRef.current) {
      clearInterval(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  const startFallbackPolling = useCallback(() => {
    stopFallbackPolling();
    fallbackTimerRef.current = setInterval(() => {
      fetchUnreadCount();
    }, FALLBACK_POLL_INTERVAL);
  }, [fetchUnreadCount, stopFallbackPolling]);

  const connect = useCallback(async () => {
    if (!isMountedRef.current) return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/notifications/stream", {
        method: "GET",
        headers: {
          ...api.getAuthorizationHeaders(),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Auth failure — do not reconnect
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      // Connected — reset backoff, stop fallback polling
      reconnectAttemptRef.current = 0;
      stopFallbackPolling();

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const parsed = parseSSELine<NotificationSSEEvent>(line);
          if (!parsed) continue;

          switch (parsed.event) {
            case "connected":
              if (parsed.unread_count !== undefined) {
                useNotificationStore.setState({
                  unreadCount: parsed.unread_count,
                });
              }
              break;

            case "notification":
              if (parsed.notification) {
                const notification = parsed.notification;
                useNotificationStore.setState((state) => ({
                  notifications: [notification, ...state.notifications],
                  unreadCount: parsed.unread_count ?? state.unreadCount + 1,
                  total: state.total + 1,
                }));
              }
              break;

            case "unread_count":
              if (parsed.unread_count !== undefined) {
                useNotificationStore.setState({
                  unreadCount: parsed.unread_count,
                });
              }
              break;

            case "heartbeat":
              break;

            case "error":
              console.error("[NotificationSSE] Server error:", parsed.message);
              break;
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      console.warn("[NotificationSSE] Connection error:", error);
    }

    // Reconnect with exponential backoff
    if (!isMountedRef.current) return;

    reconnectAttemptRef.current++;

    if (reconnectAttemptRef.current > MAX_RECONNECT_ATTEMPTS) {
      console.warn("[NotificationSSE] Max reconnect attempts reached, falling back to polling");
      startFallbackPolling();
      return;
    }

    const delay = Math.min(
      BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttemptRef.current - 1),
      MAX_RECONNECT_DELAY
    );

    reconnectTimerRef.current = setTimeout(() => {
      connect();
    }, delay);
  }, [stopFallbackPolling, startFallbackPolling]);

  useEffect(() => {
    isMountedRef.current = true;

    if (user) {
      connect();
    }

    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      stopFallbackPolling();
    };
  }, [user, connect, stopFallbackPolling]);
}
