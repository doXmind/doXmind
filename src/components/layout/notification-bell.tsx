"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Bell, CheckCheck } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useNotificationStore } from "@/stores/notification-store";
import { useAuthStore } from "@/stores/auth-store";
import { useNotificationStream } from "@/hooks/use-notification-stream";
import { useTranslations } from "next-intl";

function timeAgo(dateStr: string, t: ReturnType<typeof useTranslations>): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t("justNow");
  if (minutes < 60) return t("minutesAgo", { count: minutes });

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("hoursAgo", { count: hours });

  const days = Math.floor(hours / 24);
  if (days < 7) return t("daysAgo", { count: days });

  const weeks = Math.floor(days / 7);
  if (days < 30) return t("weeksAgo", { count: weeks });

  const months = Math.floor(days / 30);
  return t("monthsAgo", { count: months });
}

function getNotificationIcon(type: string): string {
  switch (type) {
    case "follow":
      return "\u{1F464}";
    case "fork":
      return "\u{1F500}";
    case "comment":
      return "\u{1F4AC}";
    case "reply":
      return "\u{21A9}\uFE0F";
    case "mention":
      return "@";
    case "share_invite":
      return "\u{1F4E8}";
    case "publication":
      return "\u{1F4DD}";
    default:
      return "\u{1F514}";
  }
}

export function NotificationBell() {
  const t = useTranslations("notifications");
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const {
    unreadCount,
    notifications,
    isLoading,
    hasMore,
    fetchNotifications,
    loadMore,
    markRead,
    markAllRead,
  } = useNotificationStore();

  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Real-time notification stream (replaces polling)
  useNotificationStream();

  // Fetch full list when opening
  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen, fetchNotifications]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const handleNotificationClick = useCallback(
    (id: string, link: string | null, isRead: boolean) => {
      if (!isRead) markRead(id);
      setIsOpen(false);
      if (link) router.push(link);
    },
    [markRead, router]
  );

  const handleScroll = useCallback(() => {
    if (!scrollRef.current || !hasMore || isLoading) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    if (scrollHeight - scrollTop - clientHeight < 80) {
      loadMore();
    }
  }, [hasMore, isLoading, loadMore]);

  if (!user) return null;

  const triggerRect = triggerRef.current?.getBoundingClientRect();

  return (
    <>
      <Tooltip content={t("title")} side="bottom">
        <Button
          ref={triggerRef}
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 rounded-md"
          onClick={() => setIsOpen(!isOpen)}
          aria-label={t("title")}
          aria-expanded={isOpen}
        >
          <Bell className="h-4 w-4" />
          <AnimatePresence>
            {unreadCount > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 25 }}
                className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500"
              />
            )}
          </AnimatePresence>
        </Button>
      </Tooltip>

      {isOpen &&
        triggerRect &&
        createPortal(
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="fixed z-50 w-[340px] overflow-hidden rounded-xl border border-border/60 bg-popover shadow-xl"
            style={{
              top: triggerRect.bottom + 6,
              right: window.innerWidth - triggerRect.right,
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">{t("title")}</h3>
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllRead()}
                  className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  {t("markAllRead")}
                </button>
              )}
            </div>

            {/* List */}
            <div ref={scrollRef} onScroll={handleScroll} className="max-h-[400px] overflow-y-auto">
              {notifications.length === 0 && !isLoading ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Bell className="mb-3 h-8 w-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">{t("empty")}</p>
                </div>
              ) : (
                <div className="py-1">
                  {notifications.map((notification) => (
                    <button
                      key={notification.id}
                      onClick={() =>
                        handleNotificationClick(
                          notification.id,
                          notification.link,
                          notification.is_read
                        )
                      }
                      className={cn(
                        "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50",
                        !notification.is_read && "bg-accent/20"
                      )}
                    >
                      {/* Icon / Avatar */}
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm">
                        {notification.actor_avatar ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={notification.actor_avatar}
                            alt=""
                            className="h-8 w-8 rounded-full object-cover"
                          />
                        ) : notification.actor_name ? (
                          <span className="font-semibold text-muted-foreground">
                            {notification.actor_name.slice(0, 2).toUpperCase()}
                          </span>
                        ) : (
                          <span>{getNotificationIcon(notification.type)}</span>
                        )}
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "line-clamp-2 text-[13px] leading-snug",
                            notification.is_read ? "text-muted-foreground" : "text-foreground"
                          )}
                        >
                          {notification.message}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                          {timeAgo(notification.created_at, t)}
                        </p>
                      </div>

                      {/* Unread dot */}
                      {!notification.is_read && (
                        <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                      )}
                    </button>
                  ))}

                  {isLoading && (
                    <div className="flex justify-center py-3">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>,
          document.body
        )}
    </>
  );
}
