"use client";

import { useEffect, useState } from "react";
import { Trash2, RotateCcw, X, Loader2, FileText, Folder } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
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

interface TrashPanelProps {
  open: boolean;
  onClose: () => void;
}

export function TrashPanel({ open, onClose }: TrashPanelProps) {
  const t = useTranslations("sidebar");
  const tc = useTranslations("common");
  const { trashFiles, isTrashLoading, loadTrash, restoreFile, permanentDeleteFile, emptyTrash } =
    useFileStore();

  const [confirmEmptyOpen, setConfirmEmptyOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [isEmptying, setIsEmptying] = useState(false);

  useEffect(() => {
    if (open) {
      loadTrash();
    }
  }, [open, loadTrash]);

  const handleRestore = async (id: string, name: string) => {
    setRestoringId(id);
    try {
      await restoreFile(id);
      toast.success(t("restoredName", { name }));
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
      toast.success(t("permanentlyDeletedName", { name }));
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    } finally {
      setDeletingId(null);
    }
  };

  const handleEmptyTrash = async () => {
    setIsEmptying(true);
    try {
      await emptyTrash();
      setConfirmEmptyOpen(false);
      toast.success(t("trashEmptied"));
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    } finally {
      setIsEmptying(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <Modal open={open} onClose={onClose} className="max-w-md">
        <ModalHeader onClose={onClose}>
          <div className="flex items-center gap-2">
            <Trash2 className="h-4 w-4" />
            <span>{t("trash")}</span>
            {trashFiles.length > 0 && (
              <span className="text-xs text-muted-foreground">({trashFiles.length})</span>
            )}
          </div>
        </ModalHeader>

        <div className="min-h-[200px]">
          {isTrashLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : trashFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Trash2 className="mb-2 h-8 w-8 opacity-40" />
              <p className="text-sm">{t("trashIsEmpty")}</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[400px]">
              <div className="space-y-1 p-2">
                {trashFiles.map((file) => (
                  <div
                    key={file.id}
                    className="group flex items-center justify-between rounded-md px-3 py-2 hover:bg-accent"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      {file.isFolder ? (
                        <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("deleted")} {formatTimeAgo(file.deletedAt, t)}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleRestore(file.id, file.name)}
                        disabled={restoringId === file.id}
                        title={t("restore")}
                      >
                        {restoringId === file.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => handlePermanentDelete(file.id, file.name)}
                        disabled={deletingId === file.id}
                        title={t("deletePermanently")}
                      >
                        {deletingId === file.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        {trashFiles.length > 0 && (
          <ModalFooter>
            <Button variant="outline" size="sm" onClick={onClose}>
              {tc("close")}
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setConfirmEmptyOpen(true)}>
              {t("emptyTrash")}
            </Button>
          </ModalFooter>
        )}
      </Modal>

      {/* Confirm empty trash modal */}
      <Modal
        open={confirmEmptyOpen}
        onClose={() => setConfirmEmptyOpen(false)}
        className="max-w-sm"
      >
        <ModalHeader onClose={() => setConfirmEmptyOpen(false)}>
          {t("emptyTrashConfirm")}
        </ModalHeader>
        <div className="px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {t("permanentlyDeleteItems", { count: trashFiles.length })}
          </p>
        </div>
        <ModalFooter>
          <Button variant="outline" size="sm" onClick={() => setConfirmEmptyOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button variant="destructive" size="sm" onClick={handleEmptyTrash} disabled={isEmptying}>
            {isEmptying ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                {t("emptying")}
              </>
            ) : (
              t("emptyTrash")
            )}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
