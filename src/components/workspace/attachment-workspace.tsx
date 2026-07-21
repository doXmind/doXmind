"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, ExternalLink, File, FolderOpen, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { isExcelFile, isHtmlFile, isPdfFile } from "@/lib/document-types";
import { downloadLocalFile } from "@/lib/download";
import { exportEditedWorkbook } from "@/lib/excel/export-edited";
import {
  createStorageAdapter,
  type AttachmentInspection,
  type AttachmentRecoveryRead,
  type AttachmentRecoverySource,
  type ExcelEditorState,
  type PdfEditorState,
} from "@/lib/storage";
import { openFileExternally, revealFileInFinder } from "@/lib/storage/reveal";
import { cn, sha256Hex } from "@/lib/utils";
import { useFileStore } from "@/stores/file-store";
import type { FileItem } from "@/types";

export interface AttachmentWorkspaceServices {
  inspect: (file: FileItem) => Promise<AttachmentInspection>;
  readRecovery: (
    file: FileItem,
    source: AttachmentRecoverySource
  ) => Promise<AttachmentRecoveryRead>;
  readBinary: (file: FileItem) => Promise<Uint8Array>;
  exportPdf: (bytes: Uint8Array, state: PdfEditorState) => Promise<Uint8Array>;
  exportExcel: (
    bytes: Uint8Array,
    state: ExcelEditorState,
    sourceFileName: string
  ) => Promise<Blob>;
  hashBinary?: (bytes: Uint8Array) => Promise<string>;
  download: (data: Blob | Uint8Array, fileName: string, mimeType: string) => void;
  openExternally: (file: FileItem) => Promise<void>;
  reveal: (file: FileItem) => Promise<void>;
}

interface AttachmentWorkspaceProps {
  file: FileItem;
  services?: AttachmentWorkspaceServices;
}

function adapterFor(file: FileItem) {
  if (!file.storageHandle) throw new Error("Attachment is not stored on disk");
  return createStorageAdapter({ disk: { root: useFileStore.getState().rootPath } });
}

const defaultServices: AttachmentWorkspaceServices = {
  inspect: async (file) => {
    if (!isPdfFile(file) && !isExcelFile(file) && !isHtmlFile(file)) {
      return {
        documentType: "other",
        recoveryStatus: "none",
        sidecarStatus: "missing",
        sidecarPath: "",
        recoverySources: [],
        recommendedSource: null,
      };
    }
    return adapterFor(file).inspectAttachment(file.storageHandle!);
  },
  readRecovery: async (file, source) => {
    return adapterFor(file).readAttachmentRecovery(file.storageHandle!, source);
  },
  readBinary: async (file) => {
    const adapter = adapterFor(file);
    if (!adapter.readBinary) throw new Error("Attachment binary reader is unavailable");
    return adapter.readBinary(file.storageHandle!);
  },
  exportPdf: async (bytes, state) => {
    const [{ buildPdfRecoveryPayload }, { exportEditedPdfStrict }] = await Promise.all([
      import("@/lib/pdf/recovery"),
      import("@/lib/pdf/export-edited"),
    ]);
    const payload = await buildPdfRecoveryPayload(bytes, state);
    return exportEditedPdfStrict(bytes, payload);
  },
  exportExcel: exportEditedWorkbook,
  hashBinary: sha256Hex,
  download: downloadLocalFile,
  openExternally: openFileExternally,
  reveal: revealFileInFinder,
};

export function AttachmentWorkspace({
  file,
  services = defaultServices,
}: AttachmentWorkspaceProps) {
  const t = useTranslations("attachment");
  const [inspection, setInspection] = useState<AttachmentInspection | null>(null);
  const [inspectionError, setInspectionError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exportingSource, setExportingSource] = useState<AttachmentRecoverySource | null>(null);
  const [exportComplete, setExportComplete] = useState(false);
  const fileGenerationRef = useRef(0);
  const filePath = file.storageHandle?.relPath || file.storageHandle?.path || file.name;
  const fileName = filePath.split("/").filter(Boolean).pop() || file.name;
  const typeLabel =
    file.documentType === "pdf"
      ? t("pdfLabel")
      : file.documentType === "excel"
        ? t("spreadsheetLabel")
        : file.documentType === "html"
          ? t("htmlLabel")
          : t("genericLabel");

  useEffect(() => {
    let cancelled = false;
    fileGenerationRef.current += 1;
    setInspection(null);
    setInspectionError(null);
    setActionError(null);
    setExportComplete(false);
    setExportingSource(null);
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

  const availableSources =
    inspection?.recoverySources.filter((candidate) => candidate.recoveryStatus === "available") ??
    [];
  const inspectedRecommendation = availableSources.some(
    (candidate) => candidate.source === inspection?.recommendedSource
  )
    ? inspection!.recommendedSource
    : null;
  const requiresSourceChoice = availableSources.length > 1 && inspectedRecommendation === null;
  const recommendedSource =
    inspectedRecommendation ?? (availableSources.length === 1 ? availableSources[0].source : null);
  const hasUnknownSource =
    inspection?.recoveryStatus === "unknown" ||
    inspection?.recoverySources.some((candidate) => candidate.recoveryStatus === "unknown");

  const exportRecovery = async (source: AttachmentRecoverySource) => {
    const fileGeneration = fileGenerationRef.current;
    setActionError(null);
    setExportComplete(false);
    setExportingSource(source);
    try {
      const [recovery, bytes] = await Promise.all([
        services.readRecovery(file, source),
        services.readBinary(file),
      ]);
      if (recovery.source !== source) {
        throw new Error("Recovery source did not match the selected candidate");
      }
      if (inspection && recovery.documentType !== inspection.documentType) {
        throw new Error("Recovery state did not match the attachment type");
      }
      const currentSourceHash = await (services.hashBinary ?? sha256Hex)(bytes);
      if (
        typeof recovery.sourceHash !== "string" ||
        !/^[a-f0-9]{64}$/i.test(recovery.sourceHash) ||
        currentSourceHash.toLowerCase() !== recovery.sourceHash.toLowerCase()
      ) {
        throw new Error(t("sourceChanged"));
      }
      if (fileGenerationRef.current !== fileGeneration) return;
      const sourceFileName = attachmentSourceFileName(file);
      if (recovery.documentType === "pdf") {
        const exported = await services.exportPdf(bytes, recovery.editorState);
        if (fileGenerationRef.current !== fileGeneration) return;
        services.download(exported, recoveredFileName(sourceFileName, "pdf"), "application/pdf");
      } else {
        const exported = await services.exportExcel(bytes, recovery.editorState, sourceFileName);
        if (fileGenerationRef.current !== fileGeneration) return;
        services.download(
          exported,
          recoveredFileName(sourceFileName, "excel"),
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
      }
      if (fileGenerationRef.current === fileGeneration) setExportComplete(true);
    } catch (error) {
      if (fileGenerationRef.current === fileGeneration) {
        setActionError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (fileGenerationRef.current === fileGeneration) setExportingSource(null);
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
          <RecoveryNotice title={t("legacyTitle")} description={t("legacyDescription")}>
            {requiresSourceChoice && (
              <p className="mt-3 text-sm text-muted-foreground">{t("chooseRecoverySource")}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {requiresSourceChoice ? (
                availableSources.map((candidate) => (
                  <Button
                    key={candidate.source}
                    variant="outline"
                    size="sm"
                    disabled={exportingSource !== null}
                    onClick={() => void exportRecovery(candidate.source)}
                  >
                    {exportingSource === candidate.source && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {candidate.source === "sidecar" ? t("exportMainSidecar") : t("exportBackup")}
                  </Button>
                ))
              ) : recommendedSource ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exportingSource !== null}
                  onClick={() => void exportRecovery(recommendedSource)}
                >
                  {exportingSource !== null && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {inspection.documentType === "pdf"
                    ? t("exportRecoveredPdf")
                    : t("exportRecoveredSpreadsheet")}
                </Button>
              ) : null}
            </div>
            {/\.xlsm$/i.test(filePath) && (
              <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">{t("macroWarning")}</p>
            )}
            {exportComplete && (
              <p role="status" className="mt-3 text-sm text-muted-foreground">
                {t("recoveryExported")}
              </p>
            )}
          </RecoveryNotice>
        )}

        {hasUnknownSource && (
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
  children,
  destructive = false,
}: {
  title: string;
  description: string;
  children?: ReactNode;
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
          {children}
        </div>
      </div>
    </div>
  );
}

function attachmentSourceFileName(file: FileItem): string {
  const path = file.storageHandle?.relPath || file.storageHandle?.path || file.name;
  return path.split("/").filter(Boolean).pop() || file.name;
}

function recoveredFileName(sourceFileName: string, type: "pdf" | "excel"): string {
  const base = sourceFileName.replace(/\.(?:pdf|xlsx|xlsm|csv)$/i, "");
  return `${base} recovered.${type === "pdf" ? "pdf" : "xlsx"}`;
}
