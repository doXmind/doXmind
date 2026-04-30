"use client";

import { Folder } from "lucide-react";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import type { FolderImportProgress } from "@/lib/import-folder";

interface ImportFolderProgressProps {
  open: boolean;
  progress: FolderImportProgress | null;
  onCancel: () => void;
  onClose: () => void;
}

export function ImportFolderProgressModal({
  open,
  progress,
  onCancel,
  onClose,
}: ImportFolderProgressProps) {
  const t = useTranslations("sidebar");

  // Only allow dismiss after completion — closing mid-import would orphan
  // the in-flight worker pool. The cancel button is the path to abort.
  const dismissible = progress?.isComplete ?? true;

  const total = progress?.total ?? 0;
  const done = progress?.done ?? 0;
  const succeeded = progress?.succeeded ?? 0;
  const failed = progress?.failed ?? 0;
  const skipped = progress?.skipped ?? 0;
  const isComplete = progress?.isComplete ?? false;

  const pct = total === 0 ? (isComplete ? 100 : 0) : Math.floor((done / total) * 100);

  // Build the one-line stats summary. Items with zero count are dropped
  // so the line stays compact and only ever shows what matters.
  const stats: string[] = [];
  if (succeeded) stats.push(t("importFolderSucceededCount", { n: succeeded }));
  if (failed) stats.push(t("importFolderFailedCount", { n: failed }));
  if (skipped) stats.push(t("importFolderSkippedCount", { n: skipped }));
  if (stats.length === 0) {
    // Edge case: in-flight with nothing settled yet, or an empty pick.
    if (!isComplete && total > 0) stats.push(t("importFolderProgress", { done, total }));
    else if (isComplete && total === 0 && skipped === 0) stats.push(t("importFolderEmpty"));
  }

  return (
    <Modal open={open} onClose={dismissible ? onClose : () => {}}>
      <ModalHeader onClose={dismissible ? onClose : undefined}>
        {isComplete ? t("importFolderDone") : t("importingFolder")}
      </ModalHeader>

      <div className="space-y-5">
        {/* Folder identity — minimal, no boxed surface. */}
        <div className="flex items-center gap-2 text-sm">
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate font-medium text-foreground">
            {progress?.rootFolderName ?? "—"}
          </span>
        </div>

        {/* Progress bar with inline counts. */}
        <div className="space-y-2">
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-foreground/85 transition-[width] duration-200 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
            <span>{total > 0 ? `${done} / ${total}` : isComplete ? "—" : ""}</span>
            <span>{pct}%</span>
          </div>
        </div>

        {/* Currently importing — fixed slot, hides without layout shift. */}
        <div className="min-h-[1.25rem] text-xs text-muted-foreground">
          {!isComplete && progress?.currentFileName ? (
            <span className="block truncate">
              <span className="text-muted-foreground/70">{t("importFolderNow")}: </span>
              <span className="font-mono text-foreground/80">{progress.currentFileName}</span>
            </span>
          ) : null}
        </div>

        {/* Single-line stats summary — only what's nonzero. */}
        {stats.length > 0 && <p className="text-xs text-muted-foreground">{stats.join(" · ")}</p>}
      </div>

      <ModalFooter>
        {isComplete ? (
          <Button onClick={onClose} size="sm">
            {t("done")}
          </Button>
        ) : (
          <Button onClick={onCancel} size="sm" variant="ghost">
            {t("cancel")}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
