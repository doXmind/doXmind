"use client";

import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { CommunityItem } from "@/lib/api";
import { MarkdownContent } from "@/components/comments/markdown-content";
import { stripPreviewBlocks } from "@/lib/markdown";
import { useTranslations } from "next-intl";
import { CommunityCard } from "./community-card";
import { UserAvatar } from "@/components/ui/user-avatar";
import { ShareReactions } from "./share-reactions";
import { Clock, Eye, FileText, Folder, GitFork, MessageSquare, Search } from "lucide-react";

interface CommunityGridProps {
  items: CommunityItem[];
  isLoading: boolean;
  hasActiveFilters?: boolean;
  searchQuery?: string;
  sortBy?: string;
  onClearFilters?: () => void;
  onTagClick?: (tag: string) => void;
  onEditItem?: (item: CommunityItem) => void;
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/* ── Featured card — larger 2-col layout, content-dense ──────── */
function FeaturedCard({
  item,
  index,
  onTagClick,
}: {
  item: CommunityItem;
  index: number;
  onTagClick?: (tag: string) => void;
}) {
  const t = useTranslations("community");
  const owner = item.owner || { id: "", username: null, avatar_url: null };
  const cleanedPreview = item.content_preview ? stripPreviewBlocks(item.content_preview) : "";
  const publishedDate = item.published_at
    ? new Date(item.published_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.35,
        delay: index * 0.08,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      <Link href={`/s/${item.share_token}`} className="group block h-full">
        <div className="relative flex h-full flex-col rounded-xl border border-border bg-card p-5 transition-colors duration-200 hover:bg-accent/50">
          {/* Author row */}
          <div className="mb-3 flex items-center gap-2">
            <UserAvatar
              avatarUrl={owner.avatar_url}
              username={owner.username}
              size={20}
              frame={owner.avatar_frame}
              plan={owner.plan}
            />
            <span className="flex items-center text-[12px] font-medium text-muted-foreground">
              {owner.username || t("anonymous")}
            </span>
            <span className="text-[12px] text-muted-foreground/50">·</span>
            <span className="text-[12px] text-muted-foreground/50">{publishedDate}</span>
          </div>

          {/* Title */}
          <h3 className="line-clamp-2 flex items-center gap-2 text-[16px] font-semibold leading-snug tracking-tight text-foreground group-hover:text-foreground">
            {item.is_folder && (
              <Folder className="h-4 w-4 flex-shrink-0 text-amber-500 dark:text-amber-400" />
            )}
            {item.title}
          </h3>

          {/* Description */}
          {item.description && (
            <p className="mt-1.5 line-clamp-2 text-[13px] italic leading-relaxed text-muted-foreground/70">
              {item.description}
            </p>
          )}

          {/* Content preview */}
          {cleanedPreview && (
            <MarkdownContent
              content={cleanedPreview}
              baseClassName="text-[13px] leading-relaxed text-muted-foreground"
              className="mt-1.5 line-clamp-3 [&_*]:text-[13px] [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_p]:mb-0"
            />
          )}

          {/* Folder children preview */}
          {item.is_folder && !cleanedPreview && (
            <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground/60">
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

          {/* Reactions */}
          <div className="mt-2">
            <ShareReactions shareToken={item.share_token} reactions={item.reactions} />
          </div>

          <div className="flex-1" />

          {/* Bottom row: tags + metrics */}
          <div className="mt-4 flex items-center justify-between gap-3">
            {/* Tags */}
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {item.tags.slice(0, 3).map((tag) => (
                <button
                  key={tag}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onTagClick?.(tag);
                  }}
                  className="truncate rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  {tag}
                </button>
              ))}
            </div>

            {/* Metrics */}
            <div className="flex shrink-0 items-center gap-3 text-muted-foreground/60">
              {item.reading_time > 0 && (
                <span className="flex items-center gap-1 text-[11px]">
                  <Clock className="h-3 w-3" />
                  {item.reading_time} min
                </span>
              )}
              <span className="flex items-center gap-1 text-[11px]">
                <Eye className="h-3 w-3" />
                {formatCount(item.view_count)}
              </span>
              <span className="flex items-center gap-1 text-[11px]">
                <GitFork className="h-3 w-3" />
                {formatCount(item.fork_count)}
              </span>
              {item.comment_count > 0 && (
                <span className="flex items-center gap-1 text-[11px]">
                  <MessageSquare className="h-3 w-3" />
                  {formatCount(item.comment_count)}
                </span>
              )}
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

/* ── Main grid ──────────────────────────────────────────────── */
export function CommunityGrid({
  items,
  isLoading,
  hasActiveFilters,
  searchQuery,
  sortBy: _sortBy,
  onClearFilters,
  onTagClick,
  onEditItem,
}: CommunityGridProps) {
  const t = useTranslations("community");

  /* Loading skeleton */
  if (isLoading && items.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: i * 0.06 }}
            className="flex flex-col rounded-xl border border-border bg-card p-5"
          >
            <div className="mb-3 flex items-center gap-2">
              <div className="h-5 w-5 animate-pulse rounded-full bg-muted" />
              <div className="h-3 w-20 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-5 w-4/5 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3.5 w-full animate-pulse rounded bg-muted/50" />
            <div className="mt-1.5 h-3.5 w-full animate-pulse rounded bg-muted/50" />
            <div className="mt-1.5 h-3.5 w-3/5 animate-pulse rounded bg-muted/50" />
            <div className="mt-4 flex gap-1.5">
              <div className="h-5 w-12 animate-pulse rounded-full bg-muted/50" />
              <div className="h-5 w-10 animate-pulse rounded-full bg-muted/50" />
            </div>
          </motion.div>
        ))}
      </div>
    );
  }

  /* No results with active filters */
  if (items.length === 0 && hasActiveFilters) {
    return (
      <motion.div
        className="flex flex-col items-center justify-center py-20 text-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Search className="h-5 w-5 text-muted-foreground/50" />
        </div>
        <h3 className="mt-4 text-[15px] font-semibold text-foreground">
          {searchQuery ? t("noResultsFor", { query: searchQuery }) : t("noResults")}
        </h3>
        <p className="mt-1 text-[13px] text-muted-foreground">{t("tryDifferentKeywords")}</p>
        {onClearFilters && (
          <button
            onClick={onClearFilters}
            className="mt-3 rounded-lg px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
          >
            {t("clearFilters")}
          </button>
        )}
      </motion.div>
    );
  }

  /* Empty state */
  if (items.length === 0) {
    return (
      <motion.div
        className="flex flex-col items-center justify-center py-20 text-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <FileText className="h-5 w-5 text-muted-foreground/50" />
        </div>
        <h3 className="mt-4 text-[15px] font-semibold text-foreground">
          {t("noPublishedDocuments")}
        </h3>
        <p className="mt-1 text-[13px] text-muted-foreground">{t("beTheFirstToShare")}</p>
        <Link
          href="/editor"
          className="mt-3 rounded-lg px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
        >
          {t("startWriting")}
        </Link>
      </motion.div>
    );
  }

  const showFeatured = !hasActiveFilters && items.length > 4;
  const featuredItems = showFeatured ? items.slice(0, 2) : [];
  const gridItems = showFeatured ? items.slice(2) : items;

  return (
    <div>
      {/* Featured — 2-col wider cards */}
      {showFeatured && (
        <div className="mb-8">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {featuredItems.map((item, i) => (
              <FeaturedCard key={item.share_id} item={item} index={i} onTagClick={onTagClick} />
            ))}
          </div>
        </div>
      )}

      {/* Separator */}
      {showFeatured && gridItems.length > 0 && <div className="mb-6 border-t border-border/60" />}

      {/* Main 3-col grid */}
      <motion.div
        className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.25 }}
      >
        <AnimatePresence mode="popLayout">
          {gridItems.map((item, i) => (
            <motion.div
              key={item.share_id}
              initial={{ opacity: 0, y: 12 }}
              animate={{
                opacity: 1,
                y: 0,
                transition: {
                  duration: 0.3,
                  delay: Math.min(i * 0.04, 0.4),
                  ease: [0.16, 1, 0.3, 1],
                },
              }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              layout
            >
              <CommunityCard item={item} onTagClick={onTagClick} onEditItem={onEditItem} />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
