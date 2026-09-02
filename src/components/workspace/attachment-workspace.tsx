"use client";

import { useEffect, useState } from "react";
import { ExternalLink, File, FolderOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { openFileExternally, revealFileInFinder } from "@/lib/storage/reveal";
import type { FileItem } from "@/types";

export interface AttachmentWorkspaceServices {
  openExternally: (file: FileItem) => Promise<void>;
  reveal: (file: FileItem) => Promise<void>;
}

interface AttachmentWorkspaceProps {
  file: FileItem;
  services?: AttachmentWorkspaceServices;
}

const defaultServices: AttachmentWorkspaceServices = {
  openExternally: openFileExternally,
  reveal: revealFileInFinder,
};

export function AttachmentWorkspace({
  file,
  services = defaultServices,
}: AttachmentWorkspaceProps) {
  const t = useTranslations("attachment");
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
    setActionError(null);
  }, [file.id, filePath]);

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

          {actionError && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {actionError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
