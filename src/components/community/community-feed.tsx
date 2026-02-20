"use client";

import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { CommunityItem } from "@/lib/api";
import {
  Bookmark,
  Eye,
  FileText,
  GitFork,
  MessageSquare,
  Pencil,
  Search,
  Share2,
} from "lucide-react";
import { useBookmarksStore } from "@/stores/bookmarks-store";
import { useAuthStore } from "@/stores/auth-store";

interface CommunityFeedProps {
  items: CommunityItem[];
  isLoading: boolean;
  hasActiveFilters?: boolean;
  searchQuery?: string;
  onClearFilters?: () => void;
  onTagClick?: (tag: string) => void;
  onEditItem?: (item: CommunityItem) => void;
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ── Single feed item ───────────────────────────────────────── */
function FeedCard({
  item,
  index,
  onTagClick,
  onEditItem,
}: {
  item: CommunityItem;
  index: number;
  onTagClick?: (tag: string) => void;
  onEditItem?: (item: CommunityItem) => void;
}) {
  const user = useAuthStore((s) => s.user);
  const isBookmarked = useBookmarksStore((s) => s.isBookmarked(item.share_id));
  const toggleBookmark = useBookmarksStore((s) => s.toggleBookmark);
  const owner = item.owner || { id: "", username: null, avatar_url: null };

  const handleBookmark = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) return;
    await toggleBookmark(item.share_token, item.share_id);
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await navigator.clipboard.writeText(`${window.location.origin}/community/${item.share_token}`);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{
        opacity: 1,
        transition: {
          duration: 0.25,
          delay: Math.min(index * 0.03, 0.3),
        },
      }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      layout
    >
      <article className="border-b border-border px-1 py-5 transition-colors hover:bg-accent/30 sm:px-3">
        <div className="flex gap-3">
          {/* Avatar */}
          <Link
            href={`/profile/${owner.id}`}
            className="shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {owner.avatar_url ? (
              <Image
                src={owner.avatar_url}
                alt=""
                width={40}
                height={40}
                className="h-10 w-10 rounded-full"
                unoptimized
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
                {(owner.username || "?")[0].toUpperCase()}
              </div>
            )}
          </Link>

          {/* Content */}
          <div className="min-w-0 flex-1">
            {/* Header: name · time · edit */}
            <div className="flex items-center gap-1.5">
              <Link
                href={`/profile/${owner.id}`}
                className="truncate text-[14px] font-semibold text-foreground hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {owner.username || "Anonymous"}
              </Link>
              <span className="text-[13px] text-muted-foreground/50">·</span>
              <span className="shrink-0 text-[13px] text-muted-foreground/50">
                {relativeTime(item.published_at)}
              </span>

              {/* Edit (own posts) */}
              {onEditItem && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onEditItem(item);
                  }}
                  className="ml-auto rounded-md p-1 text-muted-foreground/40 transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Edit post"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Title */}
            <Link href={`/community/${item.share_token}`} className="group mt-1 block">
              <h3 className="text-[15px] font-semibold leading-snug text-foreground group-hover:text-foreground/80">
                {item.title}
              </h3>
            </Link>

            {/* Description */}
            {item.description && (
              <Link href={`/community/${item.share_token}`}>
                <p className="mt-1 line-clamp-2 text-[14px] leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              </Link>
            )}

            {/* Tags */}
            {item.tags.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {item.tags.slice(0, 4).map((tag) => (
                  <button
                    key={tag}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onTagClick?.(tag);
                    }}
                    className="rounded-full bg-muted/80 px-2.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    #{tag}
                  </button>
                ))}
                {item.tags.length > 4 && (
                  <span className="py-0.5 text-[12px] text-muted-foreground/40">
                    +{item.tags.length - 4}
                  </span>
                )}
              </div>
            )}

            {/* Engagement bar — like X.com */}
            <div className="-ml-2.5 mt-3 flex items-center gap-1">
              {/* Views */}
              <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-muted-foreground/60">
                <Eye className="h-3.5 w-3.5" />
                {formatCount(item.view_count)}
              </span>

              {/* Forks */}
              <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-muted-foreground/60">
                <GitFork className="h-3.5 w-3.5" />
                {formatCount(item.fork_count)}
              </span>

              {/* Comments */}
              <Link
                href={`/community/${item.share_token}#comments`}
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                {item.comment_count > 0 ? formatCount(item.comment_count) : ""}
              </Link>

              <div className="flex-1" />

              {/* Bookmark */}
              {user && (
                <button
                  onClick={handleBookmark}
                  className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                  title={isBookmarked ? "Remove bookmark" : "Bookmark"}
                >
                  <Bookmark
                    className={`h-3.5 w-3.5 ${isBookmarked ? "fill-current text-foreground" : ""}`}
                  />
                </button>
              )}

              {/* Share */}
              <button
                onClick={handleShare}
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                title="Copy link"
              >
                <Share2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </article>
    </motion.div>
  );
}

/* ── Feed container ─────────────────────────────────────────── */
export function CommunityFeed({
  items,
  isLoading,
  hasActiveFilters,
  searchQuery,
  onClearFilters,
  onTagClick,
  onEditItem,
}: CommunityFeedProps) {
  /* Loading skeleton */
  if (isLoading && items.length === 0) {
    return (
      <div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border-b border-border px-1 py-5 sm:px-3">
            <div className="flex gap-3">
              <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-muted" />
              <div className="flex-1 space-y-2.5">
                <div className="flex items-center gap-2">
                  <div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-12 animate-pulse rounded bg-muted/60" />
                </div>
                <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
                <div className="h-3.5 w-full animate-pulse rounded bg-muted/60" />
                <div className="h-3.5 w-3/5 animate-pulse rounded bg-muted/60" />
                <div className="flex gap-4 pt-1">
                  <div className="h-3 w-10 animate-pulse rounded bg-muted/40" />
                  <div className="h-3 w-10 animate-pulse rounded bg-muted/40" />
                  <div className="h-3 w-10 animate-pulse rounded bg-muted/40" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  /* No results */
  if (items.length === 0 && hasActiveFilters) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Search className="h-8 w-8 text-muted-foreground/30" />
        <h3 className="mt-4 text-[15px] font-semibold text-foreground">
          No results{searchQuery ? ` for "${searchQuery}"` : ""}
        </h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Try different keywords or clear your filters.
        </p>
        {onClearFilters && (
          <button
            onClick={onClearFilters}
            className="mt-3 text-[13px] font-medium text-foreground underline underline-offset-2 transition-colors hover:text-foreground/70"
          >
            Clear filters
          </button>
        )}
      </div>
    );
  }

  /* Empty state */
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <FileText className="h-8 w-8 text-muted-foreground/30" />
        <h3 className="mt-4 text-[15px] font-semibold text-foreground">
          No published documents yet
        </h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Be the first to share your work with the community.
        </p>
        <Link
          href="/editor"
          className="mt-3 text-[13px] font-medium text-foreground underline underline-offset-2 transition-colors hover:text-foreground/70"
        >
          Start writing
        </Link>
      </div>
    );
  }

  return (
    <div className="border-t border-border">
      <AnimatePresence mode="popLayout">
        {items.map((item, i) => (
          <FeedCard
            key={item.share_id}
            item={item}
            index={i}
            onTagClick={onTagClick}
            onEditItem={onEditItem}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
