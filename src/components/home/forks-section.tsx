"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { GitFork, ExternalLink, RefreshCw, Loader2, Trash2 } from "lucide-react";
import { type ForkInfo, api } from "@/lib/api";
import { useLazyList } from "@/hooks/use-lazy-list";
import { useGridPageSize } from "@/hooks/use-grid-page-size";
import { GridPagination } from "./grid-pagination";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/ui/confirm-modal";

interface ForksSectionProps {
  forks: ForkInfo[];
  onForksChange: (updater: (prev: ForkInfo[]) => ForkInfo[]) => void;
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
        <GitFork className="h-6 w-6 text-muted-foreground/40" />
      </div>
      <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-foreground">
        No forked documents
      </h3>
      <p className="mt-1.5 max-w-sm text-[13px] text-muted-foreground">
        Fork documents from the community to see them here.
      </p>
    </div>
  );
}

export function ForksSection({ forks, onForksChange }: ForksSectionProps) {
  const router = useRouter();
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [deletingForkId, setDeletingForkId] = useState<string | null>(null);

  // Pagination (desktop) + lazy loading (mobile)
  const [page, setPage] = useState(0);
  const pageSize = useGridPageSize();
  const totalPages = Math.max(1, Math.ceil(forks.length / pageSize));
  const pagedForks = useMemo(
    () => forks.slice(page * pageSize, (page + 1) * pageSize),
    [forks, page, pageSize]
  );

  useEffect(() => {
    setPage(0);
  }, [forks.length]);
  useEffect(() => {
    if (page >= totalPages) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  const { visibleItems: visibleForks, sentinelRef, hasMore } = useLazyList(pagedForks);

  if (forks.length === 0) return <EmptyState />;

  const handleDelete = async (forkId: string) => {
    try {
      await api.deleteFork(forkId);
      onForksChange((prev) => prev.filter((f) => f.id !== forkId));
      toast.success("Fork removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove fork");
    }
  };

  const handleSync = async (forkId: string) => {
    setSyncingId(forkId);
    try {
      const result = await api.syncFork(forkId);
      if (result.status === "synced") {
        onForksChange((prev) =>
          prev.map((f) =>
            f.id === forkId ? { ...f, last_synced_at: new Date().toISOString() } : f
          )
        );
        toast.success("Synced with original");
      } else if (result.status === "conflict") {
        const forceResult = await api.syncFork(forkId, { force: true, create_backup: true });
        if (forceResult.status === "synced") {
          onForksChange((prev) =>
            prev.map((f) =>
              f.id === forkId ? { ...f, last_synced_at: new Date().toISOString() } : f
            )
          );
          toast.success(
            forceResult.backup_file_id
              ? "Synced! A backup of your version was saved."
              : "Synced with original"
          );
        } else {
          toast.info(forceResult.message);
        }
      } else {
        toast.info(result.message);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to sync");
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {visibleForks.map((fork) => (
          <div
            key={fork.id}
            className="group rounded-xl border border-border/50 bg-card px-4 py-3.5 transition-all hover:border-border"
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <button
                  onClick={() => router.push(`/editor/${fork.forked_file_id}`)}
                  className="truncate text-[14px] font-medium text-foreground transition-colors hover:text-primary"
                >
                  {fork.forked_file_name}
                </button>
                <div className="mt-1 flex items-center gap-2 text-[12px] text-muted-foreground/60">
                  {fork.source_title && (
                    <>
                      <span className="truncate">
                        from <span className="text-muted-foreground">{fork.source_title}</span>
                      </span>
                      <span className="text-muted-foreground/30">&middot;</span>
                    </>
                  )}
                  <span className="shrink-0">
                    {new Date(fork.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 max-sm:opacity-100">
                <button
                  onClick={() => router.push(`/editor/${fork.forked_file_id}`)}
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title="Open in editor"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
                {fork.source_share_id && (
                  <button
                    onClick={() => handleSync(fork.id)}
                    disabled={syncingId === fork.id}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title="Sync from original"
                  >
                    {syncingId === fork.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
                <button
                  onClick={() => setDeletingForkId(fork.id)}
                  className="rounded-lg p-1.5 text-destructive/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
                  title="Remove fork"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {hasMore && <div ref={sentinelRef} className="h-px" />}
      </div>
      <GridPagination page={page} totalPages={totalPages} onPageChange={setPage} />
      <ConfirmModal
        open={!!deletingForkId}
        onClose={() => setDeletingForkId(null)}
        onConfirm={() => deletingForkId && handleDelete(deletingForkId)}
        title="Remove fork?"
        description="This will remove the fork link. The forked document will remain in your files."
        confirmLabel="Remove"
      />
    </>
  );
}
