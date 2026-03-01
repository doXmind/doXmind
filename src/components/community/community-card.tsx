"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { CommunityItem } from "@/lib/api";
import { Eye, GitFork, Bookmark, Clock, MessageSquare, Pencil } from "lucide-react";
import { useBookmarksStore } from "@/stores/bookmarks-store";
import { useAuthStore } from "@/stores/auth-store";

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
  const user = useAuthStore((s) => s.user);
  const isBookmarked = useBookmarksStore((s) => s.isBookmarked(item.share_id));
  const toggleBookmark = useBookmarksStore((s) => s.toggleBookmark);

  const owner = item.owner || { id: "", username: null, avatar_url: null };

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
            aria-label="Edit post"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}

        {user && !onEditItem && (
          <button
            onClick={handleBookmarkClick}
            className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground/50 opacity-0 transition-all duration-150 hover:bg-muted hover:text-foreground group-hover:opacity-100"
            aria-label={isBookmarked ? "Remove bookmark" : "Bookmark"}
          >
            <Bookmark
              className={`h-3.5 w-3.5 ${isBookmarked ? "fill-current text-foreground" : ""}`}
            />
          </button>
        )}

        {/* Author row */}
        <div className="mb-2.5 flex items-center gap-2">
          {owner.avatar_url ? (
            <Image
              src={owner.avatar_url}
              alt=""
              width={18}
              height={18}
              className="h-[18px] w-[18px] rounded-full"
              unoptimized
            />
          ) : (
            <div className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-muted text-[8px] font-semibold text-muted-foreground">
              {(owner.username || "?")[0].toUpperCase()}
            </div>
          )}
          <span className="text-[12px] text-muted-foreground">{owner.username || "Anonymous"}</span>
          {publishedDate && (
            <>
              <span className="text-[12px] text-muted-foreground/40">·</span>
              <span className="text-[12px] text-muted-foreground/50">{publishedDate}</span>
            </>
          )}
        </div>

        {/* Title */}
        <h3 className="line-clamp-2 pr-6 text-[15px] font-semibold leading-snug text-foreground">
          {item.title}
        </h3>

        {/* Description */}
        {item.description && (
          <p className="mt-1.5 line-clamp-2 text-[13px] italic leading-relaxed text-muted-foreground/70">
            {item.description}
          </p>
        )}

        {/* Content preview */}
        {item.content_preview && item.content_preview.trim().length > 0 && (
          <p className="mt-1.5 line-clamp-3 text-[12px] leading-relaxed text-muted-foreground">
            {item.content_preview}
          </p>
        )}

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
              <span className="flex items-center gap-1 text-[11px]" title="Reading time">
                <Clock className="h-3 w-3" />
                {item.reading_time} min
              </span>
            )}
            <span className="flex items-center gap-1 text-[11px]" title="Views">
              <Eye className="h-3 w-3" />
              {formatCount(item.view_count)}
            </span>
            <span className="flex items-center gap-1 text-[11px]" title="Forks">
              <GitFork className="h-3 w-3" />
              {formatCount(item.fork_count)}
            </span>
            {item.comment_count > 0 && (
              <span className="flex items-center gap-1 text-[11px]" title="Comments">
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
