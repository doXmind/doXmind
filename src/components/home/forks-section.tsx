"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GitFork, ExternalLink, RefreshCw, Loader2 } from "lucide-react";
import { type ForkInfo, api } from "@/lib/api";
import { toast } from "sonner";

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

  if (forks.length === 0) return <EmptyState />;

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
    <div className="space-y-3">
      {forks.map((fork) => (
        <div
          key={fork.id}
          className="group flex items-center gap-4 rounded-xl border border-border/50 bg-card p-4 transition-all hover:border-border"
        >
          <div className="min-w-0 flex-1">
            <button
              onClick={() => router.push(`/editor/${fork.forked_file_id}`)}
              className="truncate text-[14px] font-medium text-foreground transition-colors hover:text-primary"
            >
              {fork.forked_file_name}
            </button>
            <div className="mt-1 flex items-center gap-3 text-[12px] text-muted-foreground/60">
              {fork.source_title && (
                <span>
                  Forked from <span className="text-muted-foreground">{fork.source_title}</span>
                  {fork.source_author && (
                    <>
                      {" "}
                      by <span className="text-muted-foreground">{fork.source_author}</span>
                    </>
                  )}
                </span>
              )}
              <span>
                {new Date(fork.created_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              {fork.last_synced_at && (
                <span>
                  Synced{" "}
                  {new Date(fork.last_synced_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={() => router.push(`/editor/${fork.forked_file_id}`)}
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Open in editor"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
            {fork.source_share_id && (
              <button
                onClick={() => handleSync(fork.id)}
                disabled={syncingId === fork.id}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Sync from original"
              >
                {syncingId === fork.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
