"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Modal, ModalHeader } from "@/components/ui/modal";
import { FollowButton } from "@/components/community/follow-button";
import { api } from "@/lib/api";
import type { FollowUser } from "@/lib/api/types";
import { useAuthStore } from "@/stores/auth-store";

interface FollowListModalProps {
  userId: string;
  initialTab: "followers" | "following";
  open: boolean;
  onClose: () => void;
}

export function FollowListModal({ userId, initialTab, open, onClose }: FollowListModalProps) {
  const t = useTranslations("profile");
  const currentUser = useAuthStore((s) => s.user);
  const [tab, setTab] = useState(initialTab);
  const [users, setUsers] = useState<FollowUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadUsers = useCallback(
    async (reset = false) => {
      setIsLoading(true);
      try {
        const newOffset = reset ? 0 : offset;
        const result =
          tab === "followers"
            ? await api.getFollowers(userId, 20, newOffset)
            : await api.getFollowing(userId, 20, newOffset);

        if (reset) {
          setUsers(result.users);
        } else {
          setUsers((prev) => [...prev, ...result.users]);
        }
        setHasMore(result.has_more);
        setOffset(newOffset + 20);
      } catch {
        // ignore
      } finally {
        setIsLoading(false);
      }
    },
    [tab, userId, offset]
  );

  // Reset on tab change
  useEffect(() => {
    setUsers([]);
    setOffset(0);
    setHasMore(false);
  }, [tab]);

  // Load on tab change or initial mount
  useEffect(() => {
    if (open) {
      setIsLoading(true);
      const fetchFn = tab === "followers" ? api.getFollowers : api.getFollowing;
      fetchFn
        .call(api, userId, 20, 0)
        .then((result) => {
          setUsers(result.users);
          setHasMore(result.has_more);
          setOffset(20);
        })
        .catch(() => {})
        .finally(() => setIsLoading(false));
    }
  }, [open, tab, userId]);

  // Infinite scroll
  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading) {
          loadUsers(false);
        }
      },
      { rootMargin: "100px" }
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, isLoading, loadUsers]);

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader onClose={onClose}>
        <div className="flex gap-4">
          <button
            onClick={() => setTab("followers")}
            className={`pb-1 text-sm font-medium transition-colors ${
              tab === "followers"
                ? "border-b-2 border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("followersTitle")}
          </button>
          <button
            onClick={() => setTab("following")}
            className={`pb-1 text-sm font-medium transition-colors ${
              tab === "following"
                ? "border-b-2 border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("followingTitle")}
          </button>
        </div>
      </ModalHeader>

      <div className="max-h-[60vh] min-h-[200px] overflow-y-auto px-4 pb-4">
        {users.length === 0 && !isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {tab === "followers" ? t("noFollowers") : t("noFollowing")}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {users.map((user) => (
              <div
                key={user.id}
                className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted/50"
              >
                <Link href={`/profile/${user.id}`} onClick={onClose} className="shrink-0">
                  {user.avatar_url ? (
                    <Image
                      src={user.avatar_url}
                      alt={user.username || "User"}
                      width={36}
                      height={36}
                      className="h-9 w-9 rounded-full ring-1 ring-border/30"
                      unoptimized
                    />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground ring-1 ring-border/30">
                      {(user.username || "?")[0].toUpperCase()}
                    </div>
                  )}
                </Link>

                <div className="min-w-0 flex-1">
                  <Link
                    href={`/profile/${user.id}`}
                    onClick={onClose}
                    className="block truncate text-sm font-medium text-foreground hover:underline"
                  >
                    {user.username || t("anonymous")}
                  </Link>
                  {user.bio && <p className="truncate text-xs text-muted-foreground">{user.bio}</p>}
                </div>

                {currentUser && currentUser.id !== user.id && (
                  <FollowButton userId={user.id} isFollowing={user.is_following} size="sm" />
                )}
              </div>
            ))}
          </div>
        )}

        {isLoading && (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        <div ref={sentinelRef} />
      </div>
    </Modal>
  );
}
