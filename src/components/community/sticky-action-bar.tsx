"use client";

import { useState, useEffect, useRef } from "react";
import { CommunityDetailResponse, api } from "@/lib/api";
import { GitFork, Bookmark, Share2, Loader2, Check, Play, Search } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { useBookmarksStore } from "@/stores/bookmarks-store";
import { useLayoutStore } from "@/stores/layout-store";
import { toast } from "sonner";

interface StickyActionBarProps {
  detail: CommunityDetailResponse;
  shareToken: string;
  /** Ref to the original action bar element — sticky bar shows when this is out of view */
  triggerRef: React.RefObject<HTMLDivElement | null>;
  onForkSuccess: (fileId: string) => void;
}

export function StickyActionBar({
  detail,
  shareToken,
  triggerRef,
  onForkSuccess,
}: StickyActionBarProps) {
  const user = useAuthStore((s) => s.user);
  const isBookmarked = useBookmarksStore((s) => s.isBookmarked(detail.share_id));
  const toggleBookmark = useBookmarksStore((s) => s.toggleBookmark);
  const [isForking, setIsForking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        setVisible(!entry.isIntersecting);
      },
      { threshold: 0 }
    );

    observerRef.current.observe(trigger);
    return () => observerRef.current?.disconnect();
  }, [triggerRef]);

  if (!visible) return null;

  const handleFork = async () => {
    if (!user) {
      toast.error("Please sign in to fork documents");
      return;
    }
    setIsForking(true);
    try {
      const result = await api.forkDocument(shareToken);
      toast.success("Saved to your workspace!");
      onForkSuccess(result.forked_file_id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fork document");
    } finally {
      setIsForking(false);
    }
  };

  const handleBookmark = async () => {
    if (!user) {
      toast.error("Please sign in to bookmark");
      return;
    }
    const result = await toggleBookmark(shareToken, detail.share_id);
    toast.success(result ? "Bookmark removed" : "Bookmarked!");
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Link copied to clipboard!");
    } catch {
      toast.error("Failed to copy link");
    }
  };

  return (
    <div className="sticky top-0 z-30 border-b border-border/40 bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex h-12 max-w-3xl items-center justify-between gap-4 px-6 sm:px-8 lg:max-w-5xl">
        <h2 className="min-w-0 truncate text-sm font-medium text-foreground">{detail.title}</h2>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* Reading tools */}
          <button
            onClick={() => useLayoutStore.getState().setPresentationMode(true)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Present"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => useLayoutStore.getState().setSearchBarOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Search in document"
          >
            <Search className="h-3.5 w-3.5" />
          </button>

          <div className="mx-1 h-4 w-px bg-border/40" />

          {/* Community actions */}
          <button
            onClick={handleFork}
            disabled={isForking || detail.is_forked}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {isForking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <GitFork className="h-3.5 w-3.5" />
            )}
            {detail.is_forked ? "Forked" : "Fork"}
          </button>

          <button
            onClick={handleBookmark}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Bookmark
              className={`h-3.5 w-3.5 ${isBookmarked ? "fill-current text-foreground" : ""}`}
            />
            {isBookmarked ? "Saved" : "Save"}
          </button>

          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Share2 className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "Share"}
          </button>
        </div>
      </div>
    </div>
  );
}
