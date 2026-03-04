"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { CommunityItem } from "@/lib/api";
import { MarkdownContent } from "@/components/comments/markdown-content";
import {
  Bookmark,
  Check,
  Clock,
  Eye,
  FileText,
  Folder,
  GitFork,
  MessageSquare,
  Pencil,
  Search,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import { useBookmarksStore } from "@/stores/bookmarks-store";
import { useAuthStore } from "@/stores/auth-store";
import { ShareReactions } from "./share-reactions";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatWordCount(n: number, t: (key: string, values?: any) => string): string {
  if (n <= 0) return "";
  if (n < 1000) return t("words", { count: n });
  return t("wordsK", { count: (n / 1000).toFixed(1) });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function relativeTime(dateStr: string, t: (key: string, values?: any) => string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t("justNow");
  if (minutes < 60) return t("mAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("hAgo", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("dAgo", { count: days });
  if (days < 30) return t("wAgo", { count: Math.floor(days / 7) });
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
  const t = useTranslations("community");
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

  const router = useRouter();

  const [copied, setCopied] = useState(false);

  const handleShare = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/community/${item.share_token}`
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(t("linkCopied"));
    } catch {
      toast.error(t("failedToCopyLink"));
    }
  };

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't navigate if user clicked an interactive element inside the card
    const target = e.target as HTMLElement;
    if (target.closest("a, button")) return;
    router.push(`/community/${item.share_token}`);
  };

  const hasPreview = item.content_preview && item.content_preview.trim().length > 0;
  const readingTime = item.reading_time || 0;
  const wordCount = item.word_count || 0;

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
      <article className="px-1 py-3 sm:px-3">
        <div
          className="group cursor-pointer rounded-xl border border-border/60 p-4 transition-colors hover:border-border hover:bg-accent/20 sm:p-5"
          onClick={handleCardClick}
          role="link"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter") router.push(`/community/${item.share_token}`);
          }}
        >
          {/* Author row: avatar + name + time + edit */}
          <div className="flex items-center gap-2.5">
            <Link href={`/profile/${owner.id}`} className="shrink-0">
              {owner.avatar_url ? (
                <Image
                  src={owner.avatar_url}
                  alt=""
                  width={32}
                  height={32}
                  className="h-8 w-8 rounded-full"
                  unoptimized
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                  {(owner.username || "?")[0].toUpperCase()}
                </div>
              )}
            </Link>
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <Link
                href={`/profile/${owner.id}`}
                className="truncate text-[13px] font-semibold text-foreground hover:underline"
              >
                {owner.username || t("anonymous")}
              </Link>
              <span className="text-[12px] text-muted-foreground/50">·</span>
              <span className="shrink-0 text-[12px] text-muted-foreground/50">
                {relativeTime(item.published_at, t)}
              </span>
            </div>

            {readingTime > 0 && (
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground/50">
                <Clock className="h-3 w-3" />
                {t("min", { count: readingTime })}
              </span>
            )}

            {/* Edit (own posts) */}
            {onEditItem && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onEditItem(item);
                }}
                className="rounded-md p-1 text-muted-foreground/40 transition-colors hover:bg-muted hover:text-foreground"
                aria-label={t("editPost")}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Title */}
          <h3 className="mt-3 flex items-center gap-2 text-[15px] font-semibold leading-snug text-foreground">
            {item.is_folder && (
              <Folder className="h-4 w-4 flex-shrink-0 text-amber-500 dark:text-amber-400" />
            )}
            {item.title}
          </h3>

          {/* Description (author summary) */}
          {item.description && (
            <p className="mt-1.5 line-clamp-2 text-[13px] italic leading-relaxed text-muted-foreground/70">
              {item.description}
            </p>
          )}

          {/* Content preview */}
          {hasPreview && (
            <MarkdownContent
              content={item.content_preview!}
              baseClassName="text-[13px] leading-relaxed text-muted-foreground"
              className="mt-2 line-clamp-3 [&_*]:text-[13px] [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_p]:mb-0"
            />
          )}

          {/* Folder children preview */}
          {item.is_folder && !hasPreview && (
            <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground/60">
              {item.child_previews && item.child_previews.length > 0 ? (
                <>
                  {item.child_previews.map((c) => c.name.replace(/\.md$/i, "")).join(" · ")}
                  {(item.item_count || 0) > 3 && (
                    <span className="text-muted-foreground/40">
                      {" "}
                      · +{(item.item_count || 0) - 3} {t("more")}
                    </span>
                  )}
                </>
              ) : (
                t("folderEmpty")
              )}
            </p>
          )}

          {/* Tags + word count */}
          {(item.tags.length > 0 || wordCount > 0) && (
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {item.tags.slice(0, 4).map((tag) => (
                  <button
                    key={tag}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onTagClick?.(tag);
                    }}
                    className="rounded-full bg-muted/80 px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    #{tag}
                  </button>
                ))}
                {item.tags.length > 4 && (
                  <span className="py-0.5 text-[11px] text-muted-foreground/40">
                    +{item.tags.length - 4}
                  </span>
                )}
              </div>
              {wordCount > 0 && (
                <span className="shrink-0 text-[11px] text-muted-foreground/40">
                  {formatWordCount(wordCount, t)}
                </span>
              )}
            </div>
          )}

          {/* Reactions */}
          <div className="mt-3">
            <ShareReactions shareToken={item.share_token} reactions={item.reactions} />
          </div>

          {/* Engagement bar */}
          <div className="mt-3 flex items-center gap-1 border-t border-border/40 pt-3">
            <span className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] text-muted-foreground/60">
              <Eye className="h-3.5 w-3.5" />
              {formatCount(item.view_count)}
            </span>

            <span className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] text-muted-foreground/60">
              <GitFork className="h-3.5 w-3.5" />
              {formatCount(item.fork_count)}
            </span>

            <span className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] text-muted-foreground/60">
              <MessageSquare className="h-3.5 w-3.5" />
              {formatCount(item.comment_count)}
            </span>

            <div className="flex-1" />

            {user && (
              <button
                onClick={handleBookmark}
                className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                title={isBookmarked ? t("removeBookmark") : t("bookmark")}
              >
                <Bookmark
                  className={`h-3.5 w-3.5 ${isBookmarked ? "fill-current text-foreground" : ""}`}
                />
              </button>
            )}

            <button
              onClick={handleShare}
              className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
              title={t("copyLink")}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Share2 className="h-3.5 w-3.5" />
              )}
            </button>
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
  const t = useTranslations("community");

  /* Loading skeleton */
  if (isLoading && items.length === 0) {
    return (
      <div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="px-1 py-3 sm:px-3">
            <div className="space-y-3 rounded-xl border border-border/40 p-4 sm:p-5">
              {/* Author row */}
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-muted" />
                <div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
                <div className="h-3 w-12 animate-pulse rounded bg-muted/60" />
              </div>
              {/* Title */}
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
              {/* Content preview lines */}
              <div className="space-y-1.5">
                <div className="h-3.5 w-full animate-pulse rounded bg-muted/50" />
                <div className="h-3.5 w-full animate-pulse rounded bg-muted/50" />
                <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted/50" />
              </div>
              {/* Tags */}
              <div className="flex gap-1.5">
                <div className="h-5 w-12 animate-pulse rounded-full bg-muted/40" />
                <div className="h-5 w-10 animate-pulse rounded-full bg-muted/40" />
              </div>
              {/* Engagement bar */}
              <div className="flex gap-4 border-t border-border/40 pt-3">
                <div className="h-3 w-10 animate-pulse rounded bg-muted/40" />
                <div className="h-3 w-10 animate-pulse rounded bg-muted/40" />
                <div className="h-3 w-10 animate-pulse rounded bg-muted/40" />
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
          {searchQuery ? t("noResultsFor", { query: searchQuery }) : t("noResults")}
        </h3>
        <p className="mt-1 text-[13px] text-muted-foreground">{t("tryDifferentKeywords")}</p>
        {onClearFilters && (
          <button
            onClick={onClearFilters}
            className="mt-3 text-[13px] font-medium text-foreground underline underline-offset-2 transition-colors hover:text-foreground/70"
          >
            {t("clearFilters")}
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
          {t("noPublishedDocuments")}
        </h3>
        <p className="mt-1 text-[13px] text-muted-foreground">{t("beTheFirstToShare")}</p>
        <Link
          href="/editor"
          className="mt-3 text-[13px] font-medium text-foreground underline underline-offset-2 transition-colors hover:text-foreground/70"
        >
          {t("startWriting")}
        </Link>
      </div>
    );
  }

  return (
    <div>
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
