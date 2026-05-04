"use client";

import { useEffect, useState } from "react";
import { FileText, Folder, Loader2, RotateCcw, Trash2, X } from "lucide-react";
import { notify } from "@/lib/notifications";
import { useTranslations } from "next-intl";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useFileStore } from "@/stores/file-store";
import { getErrorMessage } from "@/lib/utils";
import { FlatCard, SettingsSection } from "../settings-atoms";

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

export function TrashSection() {
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

  useEffect(() => {
    loadTrash();
  }, [loadTrash]);

  const handleRestore = async (id: string, _name: string) => {
    setRestoringId(id);
    try {
      await restoreFile(id);
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      notify.error(title, { description });
    } finally {
      setRestoringId(null);
    }
  };

  const handlePermanentDelete = async (id: string, _name: string) => {
    setDeletingId(id);
    try {
      await permanentDeleteFile(id);
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      notify.error(title, { description });
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  const handleEmptyTrash = async () => {
    try {
      await emptyTrash();
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      notify.error(title, { description });
    }
  };

  const targetForConfirm = trashFiles.find((f) => f.id === confirmDeleteId);

  return (
    <SettingsSection id="trash" title={tSettings("tabTrash")} desc={tSettings("trashIntro")}>
      <FlatCard>
        {/* Header row */}
        <div className="grid grid-cols-[26px_1fr_auto_auto] items-center gap-3 border-b border-border px-[18px] py-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
          <span />
          <span>{tSettings("trashColName")}</span>
          <span className="text-right">{tSettings("trashColDeleted")}</span>
          <span />
        </div>

        {isTrashLoading && trashFiles.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : trashFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
            <Trash2 className="h-7 w-7 opacity-30" />
            <p className="text-[12.5px]">{tSidebar("trashIsEmpty")}</p>
          </div>
        ) : (
          trashFiles.map((file, i) => {
            const isRestoring = restoringId === file.id;
            const isDeleting = deletingId === file.id;
            return (
              <div
                key={file.id}
                className={`grid grid-cols-[26px_1fr_auto_auto] items-center gap-3 px-[18px] py-[11px] ${
                  i ? "border-t border-border/60" : ""
                }`}
              >
                <div className="text-muted-foreground">
                  {file.isFolder ? (
                    <Folder className="h-3.5 w-3.5" />
                  ) : (
                    <FileText className="h-3.5 w-3.5" />
                  )}
                </div>
                <div className="truncate font-mono text-[13px] text-foreground">{file.name}</div>
                <div className="text-right font-mono text-[11px] text-muted-foreground/80">
                  {formatTimeAgo(file.deletedAt, tSidebar)}
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    title={tSidebar("restore")}
                    aria-label={tSidebar("restore")}
                    onClick={() => handleRestore(file.id, file.name)}
                    disabled={isRestoring || isDeleting}
                    className="grid h-[26px] w-[26px] place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
                  >
                    {isRestoring ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3 w-3" />
                    )}
                  </button>
                  <button
                    type="button"
                    title={tSidebar("deletePermanently")}
                    aria-label={tSidebar("deletePermanently")}
                    onClick={() => setConfirmDeleteId(file.id)}
                    disabled={isRestoring || isDeleting}
                    className="grid h-[26px] w-[26px] place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:text-destructive disabled:opacity-60"
                  >
                    {isDeleting ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <X className="h-3 w-3" />
                    )}
                  </button>
                </div>
              </div>
            );
          })
        )}

        {trashFiles.length > 0 && (
          <div className="flex items-center justify-between border-t border-border px-[18px] py-3">
            <div className="font-mono text-[11.5px] text-muted-foreground">
              {tSettings("trashFooter", { count: trashFiles.length })}
            </div>
            <button
              type="button"
              onClick={() => setConfirmEmptyOpen(true)}
              className="inline-flex h-[26px] items-center gap-1.5 rounded-md px-2.5 text-[11.5px] font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              <Trash2 className="h-3 w-3" /> {tSidebar("emptyTrash")}
            </button>
          </div>
        )}
      </FlatCard>

      <ConfirmModal
        open={confirmEmptyOpen}
        onClose={() => setConfirmEmptyOpen(false)}
        onConfirm={handleEmptyTrash}
        title={tSidebar("emptyTrashConfirm")}
        description={tSidebar("permanentlyDeleteItems", { count: trashFiles.length })}
        confirmLabel={tSidebar("emptyTrash")}
      />

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
    </SettingsSection>
  );
}
