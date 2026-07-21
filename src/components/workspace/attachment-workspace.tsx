"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, File, FolderOpen, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { createStorageAdapter, type AttachmentInspection } from "@/lib/storage";
import { openFileExternally, revealFileInFinder } from "@/lib/storage/reveal";
import { cn } from "@/lib/utils";
import { useFileStore } from "@/stores/file-store";
import type { FileItem } from "@/types";

export interface AttachmentWorkspaceServices {
  inspect: (file: FileItem) => Promise<AttachmentInspection>;
  openExternally: (file: FileItem) => Promise<void>;
  reveal: (file: FileItem) => Promise<void>;
}

interface AttachmentWorkspaceProps {
  file: FileItem;
  services?: AttachmentWorkspaceServices;
  onOpenLegacyRecovery?: () => void;
}

const defaultServices: AttachmentWorkspaceServices = {
  inspect: async (file) => {
    if (!file.storageHandle) throw new Error("Attachment is not stored on disk");
    const adapter = createStorageAdapter({ disk: { root: useFileStore.getState().rootPath } });
    return adapter.inspectAttachment(file.storageHandle);
  },
  openExternally: openFileExternally,
  reveal: revealFileInFinder,
};

export function AttachmentWorkspace({
  file,
  services = defaultServices,
  onOpenLegacyRecovery,
}: AttachmentWorkspaceProps) {
  const t = useTranslations("attachment");
  const [inspection, setInspection] = useState<AttachmentInspection | null>(null);
  const [inspectionError, setInspectionError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const filePath = file.storageHandle?.relPath || file.storageHandle?.path || file.name;
  const fileName = filePath.split("/").filter(Boolean).pop() || file.name;
  const typeLabel =
    file.documentType === "pdf"
      ? t("pdfLabel")
      : file.documentType === "excel"
        ? t("spreadsheetLabel")
        : t("htmlLabel");

  useEffect(() => {
    let cancelled = false;
    setInspection(null);
    setInspectionError(null);
    void services.inspect(file).then(
      (result) => {
        if (!cancelled) setInspection(result);
      },
      (error) => {
        if (!cancelled) {
          setInspectionError(error instanceof Error ? error.message : String(error));
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [file, services]);

  const runAction = async (action: (file: FileItem) => Promise<void>) => {
    setActionError(null);
    try {
      await action(file);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="flex h-full min-h-0 overflow-auto bg-background px-6 pb-10 pt-20">
      <div className="mx-auto flex w-full max-w-2xl flex-col justify-center gap-6">
        <div className="rounded-2xl border border-border/70 bg-card/70 p-7 shadow-sm backdrop-blur-sm">
          <div className="flex items-start gap-4">
            <div className="rounded-xl border border-border bg-muted/50 p-3 text-muted-foreground">
              <File className="h-7 w-7" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                {typeLabel}
              </p>
              <h1 className="mt-1 truncate text-2xl font-semibold text-foreground">{fileName}</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t("readOnlyDescription")}
              </p>
              <p className="mt-3 break-all font-mono text-xs text-muted-foreground/80">
                {filePath}
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <Button onClick={() => void runAction(services.openExternally)}>
              <ExternalLink className="mr-2 h-4 w-4" />
              {t("openExternally")}
            </Button>
            <Button variant="outline" onClick={() => void runAction(services.reveal)}>
              <FolderOpen className="mr-2 h-4 w-4" />
              {t("reveal")}
            </Button>
          </div>

          {(actionError || inspectionError) && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {actionError || inspectionError}
            </p>
          )}
        </div>

        {!inspection && !inspectionError && (
          <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("checkingRecovery")}
          </div>
        )}

        {inspection?.recoveryStatus === "available" && (
          <RecoveryNotice
            title={t("legacyTitle")}
            description={t("legacyDescription")}
            actionLabel={onOpenLegacyRecovery ? t("openRecovery") : undefined}
            onAction={onOpenLegacyRecovery}
          />
        )}

        {inspection?.recoveryStatus === "unknown" && (
          <RecoveryNotice
            title={t("unknownTitle")}
            description={t("unknownDescription")}
            destructive
          />
        )}
      </div>
    </div>
  );
}

function RecoveryNotice({
  title,
  description,
  actionLabel,
  onAction,
  destructive = false,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  destructive?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        destructive
          ? "border-destructive/30 bg-destructive/5"
          : "border-amber-500/30 bg-amber-500/5"
      )}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className={cn(
            "mt-0.5 h-5 w-5 shrink-0",
            destructive ? "text-destructive" : "text-amber-600"
          )}
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
          {actionLabel && onAction && (
            <Button variant="outline" size="sm" className="mt-3" onClick={onAction}>
              {actionLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
