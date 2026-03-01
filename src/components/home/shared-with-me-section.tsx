"use client";

import { useState, useMemo, useEffect } from "react";
import { Users, ExternalLink, FolderOpen, FileText } from "lucide-react";
import { type SharedWithMeItem } from "@/lib/api";
import { useLazyList } from "@/hooks/use-lazy-list";
import { useGridPageSize } from "@/hooks/use-grid-page-size";
import { GridPagination } from "./grid-pagination";

interface SharedWithMeSectionProps {
  items: SharedWithMeItem[];
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
        <Users className="h-6 w-6 text-muted-foreground/40" />
      </div>
      <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-foreground">
        Nothing shared with you yet
      </h3>
      <p className="mt-1.5 max-w-sm text-[13px] text-muted-foreground">
        When someone invites you to view their documents, they will appear here.
      </p>
    </div>
  );
}

export function SharedWithMeSection({ items }: SharedWithMeSectionProps) {
  const [page, setPage] = useState(0);
  const pageSize = useGridPageSize();
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const pagedItems = useMemo(
    () => items.slice(page * pageSize, (page + 1) * pageSize),
    [items, page, pageSize]
  );

  useEffect(() => {
    setPage(0);
  }, [items.length]);
  useEffect(() => {
    if (page >= totalPages) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  const { visibleItems, sentinelRef, hasMore } = useLazyList(pagedItems);

  if (items.length === 0) return <EmptyState />;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {visibleItems.map((item) => (
          <div
            key={item.share_id}
            className="group flex items-center gap-3 rounded-xl border border-border/50 bg-card px-4 py-3.5 transition-all hover:border-border sm:cursor-pointer sm:hover:bg-accent/30"
            onClick={() => window.innerWidth >= 640 && window.open(item.share_url, "_blank")}
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
                {item.title || "Untitled"}
              </h3>
              <div className="mt-1 flex items-center gap-2 text-[12px] text-muted-foreground/60">
                <span className="flex items-center gap-1">
                  {item.is_folder ? (
                    <FolderOpen className="h-3 w-3" />
                  ) : (
                    <FileText className="h-3 w-3" />
                  )}
                  {item.owner.username || "Unknown"}
                </span>
                <span className="text-muted-foreground/30">&middot;</span>
                <span>
                  {new Date(item.invited_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
            </div>

            {/* Open action */}
            <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 max-sm:opacity-100">
              <a
                href={item.share_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Open"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        ))}
        {hasMore && <div ref={sentinelRef} className="h-px" />}
      </div>
      <GridPagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </>
  );
}
