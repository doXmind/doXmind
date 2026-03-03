"use client";

import { useState } from "react";
import { GitFork, RefreshCw, Loader2, X, AlertTriangle, Copy, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { useFileStore } from "@/stores/file-store";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface ForkIndicatorProps {
  forkId: string;
  sourceTitle: string;
  sourceAuthor: string;
}

export function ForkIndicator({ forkId, sourceTitle, sourceAuthor }: ForkIndicatorProps) {
  const t = useTranslations("editor");
  const tc = useTranslations("common");
  const [isSyncing, setIsSyncing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showConflict, setShowConflict] = useState(false);

  if (dismissed) return null;

  const reloadCurrentFile = async () => {
    const { currentFileId, loadedContentIds } = useFileStore.getState();
    if (!currentFileId) return;
    // Clear from loadedContentIds so loadFileContent will re-fetch
    const updated = new Set(loadedContentIds);
    updated.delete(currentFileId);
    useFileStore.setState({ loadedContentIds: updated });
    await useFileStore.getState().loadFileContent(currentFileId);
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await api.syncFork(forkId);

      switch (result.status) {
        case "up_to_date":
          toast.info(t("alreadyUpToDate"));
          break;
        case "synced":
          toast.success(t("syncedWithOriginal"));
          await reloadCurrentFile();
          break;
        case "conflict":
          // Local changes detected — show confirmation dialog
          setShowConflict(true);
          break;
        case "error":
          toast.error(result.message);
          break;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("failedToSync"));
    } finally {
      setIsSyncing(false);
    }
  };

  const handleForceSync = async (withBackup: boolean) => {
    setShowConflict(false);
    setIsSyncing(true);
    try {
      const result = await api.syncFork(forkId, {
        force: true,
        create_backup: withBackup,
      });

      if (result.status === "synced") {
        if (result.backup_file_id) {
          toast.success(t("syncedBackupSaved"));
          // Reload file list so the backup shows up in sidebar
          await useFileStore.getState().loadFiles();
        } else {
          toast.success(t("syncedWithOriginal"));
        }
        await reloadCurrentFile();
      } else {
        toast.error(result.message);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("failedToSync"));
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 border-b border-border bg-muted/50 px-4 py-2 text-sm">
        <GitFork className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {t("forkedFromBy", { title: sourceTitle, author: sourceAuthor })}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSync}
          disabled={isSyncing}
          className="h-7 gap-1.5 text-xs"
        >
          {isSyncing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {t("syncFromOriginal")}
        </Button>
        <button
          onClick={() => setDismissed(true)}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Conflict confirmation dialog */}
      <Modal open={showConflict} onClose={() => setShowConflict(false)}>
        <ModalHeader onClose={() => setShowConflict(false)}>
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {t("localChangesDetected")}
          </span>
        </ModalHeader>

        <p className="text-sm text-muted-foreground">{t("syncConflictMessage")}</p>

        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={() => setShowConflict(false)}>
            {tc("cancel")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleForceSync(false)}
            className="gap-1.5"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            {t("syncAnyway")}
          </Button>
          <Button size="sm" onClick={() => handleForceSync(true)} className="gap-1.5">
            <Copy className="h-3.5 w-3.5" />
            {t("syncKeepBackup")}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
