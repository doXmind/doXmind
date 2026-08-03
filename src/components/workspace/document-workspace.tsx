"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArchiveRestore, Download, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { AttachmentWorkspace } from "@/components/workspace/attachment-workspace";
import { Button } from "@/components/ui/button";
import { PageEditorHost } from "@/editor/page-editor-host";
import { PageBacklinksPanel } from "@/components/editor/page-backlinks-panel";
import { PagePropertiesPanel } from "@/components/editor/page-properties-panel";
import { PageGraphPanel } from "@/components/editor/page-graph-panel";
import { isExcelFile, isHtmlFile, isMarkdownFile, isPdfFile } from "@/lib/document-types";
import { buildLegacyPageRecovery, downloadLegacyPageRecovery } from "@/lib/legacy-page-recovery";
import { createStorageAdapter, type PageRecoveryInspection } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";

interface DocumentWorkspaceProps {
  file: FileItem;
  reservedRightInset?: number;
  pageRecoveryServices?: PageRecoveryServices;
}

export interface PageRecoveryServices {
  inspect: (pagePath: string) => Promise<PageRecoveryInspection>;
  exportRecovery: (pagePath: string) => Promise<void>;
}

const defaultPageRecoveryServices: PageRecoveryServices = {
  inspect: async (pagePath) => {
    const adapter = createStorageAdapter({ disk: { root: useFileStore.getState().rootPath } });
    return adapter.inspectPageRecovery({
      mode: "disk",
      id: `path:${pagePath}`,
      kind: "document",
      documentType: "markdown",
      path: pagePath,
      relPath: pagePath,
    });
  },
  exportRecovery: async (pagePath) => {
    const adapter = createStorageAdapter({ disk: { root: useFileStore.getState().rootPath } });
    const recovery = await adapter.readPageRecovery({
      mode: "disk",
      id: `path:${pagePath}`,
      kind: "document",
      documentType: "markdown",
      path: pagePath,
      relPath: pagePath,
    });
    if (!recovery.artifacts.length) throw new Error("No Page recovery artifacts were found");
    downloadLegacyPageRecovery(buildLegacyPageRecovery(pagePath, recovery));
  },
};

export function DocumentWorkspace({
  file,
  reservedRightInset = 0,
  pageRecoveryServices = defaultPageRecoveryServices,
}: DocumentWorkspaceProps) {
  if (isHtmlFile(file)) {
    return <AttachmentWorkspace file={file} />;
  }
  if (isPdfFile(file)) {
    return <AttachmentWorkspace file={file} />;
  }
  if (isExcelFile(file)) {
    return <AttachmentWorkspace file={file} />;
  }
  if (isMarkdownFile(file)) {
    return (
      <MarkdownPageWorkspace
        file={file}
        reservedRightInset={reservedRightInset}
        services={pageRecoveryServices}
      />
    );
  }
  return <UnsupportedAttachment file={file} />;
}

function UnsupportedAttachment({ file }: { file: FileItem }) {
  const t = useTranslations("attachment");
  return (
    <div
      data-testid="unsupported-attachment"
      className="flex h-full min-h-0 items-center justify-center bg-background px-6"
    >
      <div className="w-full max-w-xl rounded-2xl border border-border/70 bg-card/70 p-7">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-foreground">{t("unsupportedTitle")}</h1>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t("unsupportedDescription")}
            </p>
            <p className="mt-3 break-all font-mono text-xs text-muted-foreground">{file.name}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MarkdownPageWorkspace({
  file,
  reservedRightInset,
  services,
}: {
  file: FileItem;
  reservedRightInset: number;
  services: PageRecoveryServices;
}) {
  const t = useTranslations("pageRecovery");
  const [inspection, setInspection] = useState<PageRecoveryInspection | null>(null);
  const [inspectionError, setInspectionError] = useState<string | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const isFocusMode = useLayoutStore((s) => s.isFocusMode);
  const inspectionRequest = useRef(0);
  const pagePath = file.storageHandle?.relPath || file.storageHandle?.path || null;

  useEffect(() => {
    inspectionRequest.current += 1;
    setInspection(null);
    setInspectionError(null);
    setIsInspecting(false);
    setActionError(null);
  }, [file.id, pagePath]);

  const inspectRecovery = async () => {
    const requestId = ++inspectionRequest.current;
    setInspection(null);
    setInspectionError(null);
    setActionError(null);
    setIsInspecting(true);
    try {
      if (!pagePath) throw new Error(t("notOnDisk"));
      const result = await services.inspect(pagePath);
      if (inspectionRequest.current === requestId) setInspection(result);
    } catch (error) {
      if (inspectionRequest.current === requestId) {
        const detail = error instanceof Error ? error.message : String(error);
        setInspectionError(`${t("checkFailed")}: ${detail}`);
      }
    } finally {
      if (inspectionRequest.current === requestId) setIsInspecting(false);
    }
  };

  const exportRecovery = async () => {
    setActionError(null);
    setIsExporting(true);
    try {
      if (!pagePath) throw new Error("Page is not stored on disk");
      await services.exportRecovery(pagePath);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Opaque backing for the Page-controls band. The floating chrome model
          is "paint an opaque backing so editor content never shows through"
          (see DesktopEditor) — the 44px header does that, this row did not, so
          every Block scrolled visibly through y=44..80 across the whole column
          while only the pills (38% of the width, and translucent at that) hid
          anything. The band ends at the pills' bottom edge (80px); it starts
          at the header's bottom edge, or at the surface's top in focus mode
          where there is no header to start from. `pointer-events-none` keeps
          the wheel and the caret talking to the scroll surface underneath,
          exactly as before. */}
      <div
        aria-hidden
        data-native-editor-chrome
        data-testid="page-controls-backdrop"
        className={cn(
          "pointer-events-none absolute inset-x-0 z-30 bg-background",
          isFocusMode ? "top-0 h-20" : "top-11 h-9"
        )}
      />
      <div data-native-editor-chrome className="absolute left-4 top-12 z-40 flex items-start gap-2">
        <PagePropertiesPanel file={file} />
        <PageBacklinksPanel file={file} />
        <PageGraphPanel file={file} />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("check")}
          title={t("check")}
          disabled={isInspecting}
          className="h-8 w-8 rounded-lg bg-background/90 text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
          onClick={() => void inspectRecovery()}
        >
          {isInspecting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArchiveRestore className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      {inspectionError && (
        <div
          role="alert"
          className="mx-4 mt-24 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {inspectionError}
        </div>
      )}
      {inspection?.recoveryStatus === "none" && (
        <div
          role="status"
          className="mx-4 mt-24 rounded-xl border border-border/70 bg-muted/40 p-3 text-sm text-muted-foreground"
        >
          {t("noneFound")}
        </div>
      )}
      {inspection?.recoveryStatus === "available" && (
        <div
          role="alert"
          data-testid="page-legacy-recovery"
          className="mx-4 mt-24 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t("description", { count: inspection.artifacts.length })}
              </p>
              <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                {inspection.artifacts.join(" · ")}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                disabled={isExporting}
                onClick={() => void exportRecovery()}
              >
                <Download className="mr-2 h-4 w-4" />
                {t("export")}
              </Button>
              {actionError && <p className="mt-2 text-sm text-destructive">{actionError}</p>}
            </div>
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <PageEditorHost file={file} reservedRightInset={reservedRightInset} />
      </div>
    </div>
  );
}
