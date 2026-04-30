"use client";

import { useEffect, useState } from "react";
import { Trash2, RotateCcw, X, Loader2, FileText, Folder } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useFileStore } from "@/stores/file-store";
import { getErrorMessage } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatTimeAgo(dateStr: string, t: (key: string, values?: any) => string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return t("justNow");
  if (diffMins < 60) return t("minutesAgo", { n: diffMins });
  if (diffHours < 24) return t("hoursAgo", { n: diffHours });
  if (diffDays < 7) return t("daysAgo", { n: diffDays });
  return date.toLocaleDateString();
}

export function TrashTab() {
  const tSettings = useTranslations("settings");
  const tSidebar = useTranslations("sidebar");
  const trashFiles = useFileStore((s) => s.trashFiles);
  const isTrashLoading = useFileStore((s) => s.isTrashLoading);
  const loadTrash = useFileStore((s) => s.loadTrash);
  const restoreFile = useFileStore((s) => s.restoreFile);
  const permanentDeleteFile = useFileStore((s) => s.permanentDeleteFile);
  const emptyTrash = useFileStore((s) => s.emptyTrash);

  const [confirmEmptyOpen, setConfirmEmptyOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Load on mount — the sidebar's old TrashPanel did this on open;
  // here the tab itself is the open signal.
  useEffect(() => {
    loadTrash();
  }, [loadTrash]);

  const handleRestore = async (id: string, name: string) => {
    setRestoringId(id);
    try {
      await restoreFile(id);
      toast.success(tSidebar("restoredName", { name }));
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    } finally {
      setRestoringId(null);
    }
  };

  const handlePermanentDelete = async (id: string, name: string) => {
    setDeletingId(id);
    try {
      await permanentDeleteFile(id);
      toast.success(tSidebar("permanentlyDeletedName", { name }));
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  const handleEmptyTrash = async () => {
    try {
      await emptyTrash();
      toast.success(tSidebar("trashEmptied"));
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const targetForConfirm = trashFiles.find((f) => f.id === confirmDeleteId);

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">{tSettings("tabTrash")}</h1>
        <p className="text-sm text-muted-foreground">{tSettings("trashIntro")}</p>
      </header>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {tSidebar("trash")}
            {trashFiles.length > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {trashFiles.length}
              </span>
            )}
          </h2>
          {trashFiles.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setConfirmEmptyOpen(true)}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {tSidebar("emptyTrash")}
            </Button>
          )}
        </div>

        <div className="rounded-lg border border-border/40 bg-card">
          {isTrashLoading && trashFiles.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : trashFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <Trash2 className="h-8 w-8 opacity-30" />
              <p className="text-sm">{tSidebar("trashIsEmpty")}</p>
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {trashFiles.map((file) => {
                const isRestoring = restoringId === file.id;
                const isDeleting = deletingId === file.id;
                return (
                  <li
                    key={file.id}
                    className="flex items-center gap-3 px-4 py-3 first:rounded-t-lg last:rounded-b-lg hover:bg-accent/40"
                  >
                    {file.isFolder ? (
                      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {tSidebar("deleted")} {formatTimeAgo(file.deletedAt, tSidebar)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8"
                        onClick={() => handleRestore(file.id, file.name)}
                        disabled={isRestoring || isDeleting}
                      >
                        {isRestoring ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {tSidebar("restore")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setConfirmDeleteId(file.id)}
                        disabled={isRestoring || isDeleting}
                        title={tSidebar("deletePermanently")}
                        aria-label={tSidebar("deletePermanently")}
                      >
                        {isDeleting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Empty trash confirmation */}
      <ConfirmModal
        open={confirmEmptyOpen}
        onClose={() => setConfirmEmptyOpen(false)}
        onConfirm={handleEmptyTrash}
        title={tSidebar("emptyTrashConfirm")}
        description={tSidebar("permanentlyDeleteItems", { count: trashFiles.length })}
        confirmLabel={tSidebar("emptyTrash")}
      />

      {/* Per-item permanent delete confirmation */}
      <ConfirmModal
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (targetForConfirm) {
            handlePermanentDelete(targetForConfirm.id, targetForConfirm.name);
          }
        }}
        title={tSidebar("deletePermanently")}
        description={tSidebar("permanentlyDeleteItems", { count: 1 })}
        confirmLabel={tSidebar("deletePermanently")}
      />
    </div>
  );
}
