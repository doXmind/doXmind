"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { CommunityItem } from "@/lib/api";
import { MarkdownContent } from "@/components/comments/markdown-content";
import { Eye, Folder, GitFork, Bookmark, Clock, MessageSquare, Pencil } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useTranslations } from "next-intl";
import { useBookmarksStore } from "@/stores/bookmarks-store";
import { useAuthStore } from "@/stores/auth-store";
import { ShareReactions } from "./share-reactions";
import { stripPreviewBlocks } from "@/lib/markdown";

interface CommunityCardProps {
  item: CommunityItem;
  onTagClick?: (tag: string) => void;
  onEditItem?: (item: CommunityItem) => void;
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function CommunityCard({ item, onTagClick, onEditItem }: CommunityCardProps) {
  const t = useTranslations("community");
  const user = useAuthStore((s) => s.user);
  const isBookmarked = useBookmarksStore((s) => s.isBookmarked(item.share_id));
  const toggleBookmark = useBookmarksStore((s) => s.toggleBookmark);

  const owner = item.owner || { id: "", username: null, avatar_url: null };
  const cleanedPreview = item.content_preview ? stripPreviewBlocks(item.content_preview) : "";

  const handleBookmarkClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) return;
    await toggleBookmark(item.share_token, item.share_id);
  };

  const publishedDate = item.published_at
    ? new Date(item.published_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "";

  return (
    <Link href={`/community/${item.share_token}`} className="group block">
      <motion.div
        className="relative flex h-full flex-col rounded-xl border border-border bg-card p-5 transition-colors duration-200 hover:bg-accent/50"
        whileHover={{ y: -2 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Top-right actions */}
        {onEditItem && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onEditItem(item);
            }}
            className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground/50 opacity-0 transition-all duration-150 hover:bg-muted hover:text-foreground group-hover:opacity-100"
            aria-label={t("editPost")}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}

        {user && !onEditItem && (
          <button
            onClick={handleBookmarkClick}
            className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground/50 opacity-0 transition-all duration-150 hover:bg-muted hover:text-foreground group-hover:opacity-100"
            aria-label={isBookmarked ? t("removeBookmark") : t("bookmark")}
          >
            <Bookmark
              className={`h-3.5 w-3.5 ${isBookmarked ? "fill-current text-foreground" : ""}`}
            />
          </button>
        )}

        {/* Author row */}
        <div className="mb-2.5 flex items-center gap-2">
          <UserAvatar
            avatarUrl={owner.avatar_url}
            username={owner.username}
            size={18}
            frame={owner.avatar_frame}
            plan={owner.plan}
          />
          <span className="flex items-center text-[12px] text-muted-foreground">
            {owner.username || t("anonymous")}
          </span>
          {publishedDate && (
            <>
              <span className="text-[12px] text-muted-foreground/40">·</span>
              <span className="text-[12px] text-muted-foreground/50">{publishedDate}</span>
            </>
          )}
        </div>

        {/* Title */}
        <h3 className="line-clamp-2 flex items-center gap-2 pr-6 text-[15px] font-semibold leading-snug text-foreground">
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
            baseClassName="text-[12px] leading-relaxed text-muted-foreground"
            className="mt-1.5 line-clamp-3 [&_*]:text-[12px] [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_p]:mb-0"
          />
        )}

        {/* Folder children preview */}
        {item.is_folder && !(item.content_preview && item.content_preview.trim().length > 0) && (
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground/60">
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

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom row: tags + metrics */}
        <div className="mt-4 flex items-center justify-between gap-2">
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
            {item.tags.length > 3 && (
              <span className="py-0.5 text-[11px] text-muted-foreground/40">
                +{item.tags.length - 3}
              </span>
            )}
          </div>

          {/* Metrics */}
          <div className="flex shrink-0 items-center gap-3 text-muted-foreground/50">
            {item.reading_time > 0 && (
              <span className="flex items-center gap-1 text-[11px]" title={t("readingTimeTitle")}>
                <Clock className="h-3 w-3" />
                {item.reading_time} min
              </span>
            )}
            <span className="flex items-center gap-1 text-[11px]" title={t("viewsTitle")}>
              <Eye className="h-3 w-3" />
              {formatCount(item.view_count)}
            </span>
            <span className="flex items-center gap-1 text-[11px]" title={t("forksTitle")}>
              <GitFork className="h-3 w-3" />
              {formatCount(item.fork_count)}
            </span>
            {item.comment_count > 0 && (
              <span className="flex items-center gap-1 text-[11px]" title={t("commentsTitle")}>
                <MessageSquare className="h-3 w-3" />
                {formatCount(item.comment_count)}
              </span>
            )}
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
