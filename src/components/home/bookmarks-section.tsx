"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Bookmark, Eye, ExternalLink, FolderOpen, FileText, Trash2 } from "lucide-react";
import { type CommunityItem, api } from "@/lib/api";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useLazyList } from "@/hooks/use-lazy-list";
import { useGridPageSize } from "@/hooks/use-grid-page-size";
import { GridPagination } from "./grid-pagination";

interface BookmarksSectionProps {
  bookmarks: CommunityItem[];
  onBookmarksChange: (updater: (prev: CommunityItem[]) => CommunityItem[]) => void;
}

function EmptyState() {
  const t = useTranslations("home");
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
        <Bookmark className="h-6 w-6 text-muted-foreground/40" />
      </div>
      <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-foreground">
        {t("noBookmarks")}
      </h3>
      <p className="mt-1.5 max-w-sm text-[13px] text-muted-foreground">{t("bookmarksSaveDesc")}</p>
    </div>
  );
}

export function BookmarksSection({ bookmarks, onBookmarksChange }: BookmarksSectionProps) {
  const t = useTranslations("home");
  const [page, setPage] = useState(0);
  const pageSize = useGridPageSize();
  const totalPages = Math.max(1, Math.ceil(bookmarks.length / pageSize));
  const pagedBookmarks = useMemo(
    () => bookmarks.slice(page * pageSize, (page + 1) * pageSize),
    [bookmarks, page, pageSize]
  );

  useEffect(() => {
    setPage(0);
  }, [bookmarks.length]);
  useEffect(() => {
    if (page >= totalPages) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  const { visibleItems, sentinelRef, hasMore } = useLazyList(pagedBookmarks);
  const [removingToken, setRemovingToken] = useState<string | null>(null);

  const handleRemove = useCallback(
    async (shareToken: string) => {
      try {
        await api.toggleBookmark(shareToken);
        onBookmarksChange((prev) => prev.filter((b) => b.share_token !== shareToken));
        toast.success(t("bookmarkRemoved"));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("failedToRemoveBookmark"));
      }
    },
    [onBookmarksChange, t]
  );

  if (bookmarks.length === 0) return <EmptyState />;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {visibleItems.map((item) => (
          <div
            key={item.share_id}
            className="group flex items-center gap-3 rounded-xl border border-border/50 bg-card px-4 py-3.5 transition-all hover:border-border sm:cursor-pointer sm:hover:bg-accent/30"
            onClick={() =>
              window.innerWidth >= 640 && window.open(`/community/${item.share_token}`, "_self")
            }
          >
            {/* Owner avatar */}
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
              {item.owner.avatar_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={item.owner.avatar_url}
                  alt=""
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : (
                <span className="text-[11px] font-bold text-muted-foreground">
                  {(item.owner.username || "?")[0].toUpperCase()}
                </span>
              )}
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[14px] font-medium text-foreground">
                {item.title || t("untitled")}
              </h3>
              <div className="mt-1 flex items-center gap-2 text-[12px] text-muted-foreground/60">
                <span className="flex items-center gap-1">
                  {item.is_folder ? (
                    <FolderOpen className="h-3 w-3" />
                  ) : (
                    <FileText className="h-3 w-3" />
                  )}
                  {item.owner.username || t("unknown")}
                </span>
                <span className="text-muted-foreground/30">&middot;</span>
                <span className="flex items-center gap-1">
                  <Eye className="h-3 w-3" />
                  {item.view_count}
                </span>
                <span className="text-muted-foreground/30">&middot;</span>
                <span>
                  {new Date(item.published_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 max-sm:opacity-100">
              <a
                href={`/community/${item.share_token}`}
                onClick={(e) => e.stopPropagation()}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={t("open")}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setRemovingToken(item.share_token);
                }}
                className="rounded-lg p-1.5 text-destructive/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
                title={t("removeBookmark")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
        {hasMore && <div ref={sentinelRef} className="h-px" />}
      </div>
      <GridPagination page={page} totalPages={totalPages} onPageChange={setPage} />
      <ConfirmModal
        open={!!removingToken}
        onClose={() => setRemovingToken(null)}
        onConfirm={() => removingToken && handleRemove(removingToken)}
        title={t("removeBookmarkConfirm")}
        description={t("removeBookmarkDesc")}
        confirmLabel={t("remove")}
      />
    </>
  );
}
