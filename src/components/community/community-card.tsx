"use client";

import Link from "next/link";
import Image from "next/image";
import { CommunityItem } from "@/lib/api";
import { Eye, GitFork, Bookmark, MessageSquare } from "lucide-react";
import { useBookmarksStore } from "@/stores/bookmarks-store";
import { useAuthStore } from "@/stores/auth-store";

interface CommunityCardProps {
  item: CommunityItem;
  onTagClick?: (tag: string) => void;
}

export function CommunityCard({ item, onTagClick }: CommunityCardProps) {
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
      <div className="relative flex h-full flex-col rounded-2xl border border-border/50 bg-card p-6 transition-all duration-300 hover:border-border hover:shadow-lg hover:shadow-black/[0.04] dark:hover:shadow-black/[0.15]">
        {/* Bookmark button */}
        {user && (
          <button
            onClick={handleBookmarkClick}
            className="absolute right-4 top-4 rounded-full p-1.5 text-muted-foreground/60 opacity-0 transition-all duration-200 hover:bg-muted hover:text-foreground group-hover:opacity-100"
            aria-label={isBookmarked ? "Remove bookmark" : "Bookmark"}
          >
            <Bookmark
              className={`h-4 w-4 ${isBookmarked ? "fill-current text-foreground opacity-100" : ""}`}
            />
          </button>
        )}

        {/* Title */}
        <h3 className="line-clamp-2 pr-8 text-[15px] font-semibold leading-snug tracking-tight text-foreground">
          {item.title}
        </h3>

        {/* Description */}
        {item.description && (
          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
            {item.description}
          </p>
        )}

        {/* Tags */}
        {item.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {item.tags.slice(0, 3).map((tag) => (
              <button
                key={tag}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onTagClick?.(tag);
                }}
                className="rounded-full border border-border/60 bg-muted/50 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
              >
                {tag}
              </button>
            ))}
            {item.tags.length > 3 && (
              <span className="px-1 py-0.5 text-[11px] text-muted-foreground/60">
                +{item.tags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Footer */}
        <div className="mt-5 flex items-center justify-between border-t border-border/40 pt-4">
          <div className="flex items-center gap-2.5">
            {owner.avatar_url ? (
              <Image
                src={owner.avatar_url}
                alt=""
                width={24}
                height={24}
                className="h-6 w-6 rounded-full ring-1 ring-border/50"
                unoptimized
              />
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground ring-1 ring-border/50">
                {(owner.username || "?")[0].toUpperCase()}
              </div>
            )}
            <div className="flex flex-col">
              <span className="text-[12px] font-medium leading-tight text-foreground/80">
                {owner.username || "Anonymous"}
              </span>
              {publishedDate && (
                <span className="text-[11px] leading-tight text-muted-foreground/60">
                  {publishedDate}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 text-muted-foreground/60">
            <span className="flex items-center gap-1 text-[11px]" title="Views">
              <Eye className="h-3 w-3" />
              {item.view_count}
            </span>
            <span className="flex items-center gap-1 text-[11px]" title="Forks">
              <GitFork className="h-3 w-3" />
              {item.fork_count}
            </span>
            <span className="flex items-center gap-1 text-[11px]" title="Comments">
              <MessageSquare className="h-3 w-3" />
              {item.comment_count}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
