"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { AttachmentWorkspace } from "@/components/workspace/attachment-workspace";
import { PageEditorHost } from "@/editor/page-editor-host";
import { PageBacklinksPanel } from "@/components/editor/page-backlinks-panel";
import { PageHistoryPanel } from "@/components/editor/page-history-panel";
import { PagePropertiesPanel } from "@/components/editor/page-properties-panel";
import { PageGraphPanel } from "@/components/editor/page-graph-panel";
import { isExcelFile, isHtmlFile, isMarkdownFile, isPdfFile } from "@/lib/document-types";
import { cn } from "@/lib/utils";
import { type FileItem } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";

interface DocumentWorkspaceProps {
  file: FileItem;
  reservedRightInset?: number;
  isActivePane?: boolean;
}

export function DocumentWorkspace({
  file,
  reservedRightInset = 0,
  isActivePane = true,
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
        isActivePane={isActivePane}
        reservedRightInset={reservedRightInset}
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
  isActivePane,
  reservedRightInset,
}: {
  file: FileItem;
  isActivePane: boolean;
  reservedRightInset: number;
}) {
  const isFocusMode = useLayoutStore((s) => s.isFocusMode);

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
        {/* Only the focused pane. The other three panels keep their open state locally, so a
            pane each is fine; version history reads one global flag, and mounted twice a
            single click opened it in both panes over two different Pages. */}
        {isActivePane && <PageHistoryPanel file={file} />}
      </div>
      <div className="min-h-0 flex-1">
        <PageEditorHost
          file={file}
          isActivePane={isActivePane}
          reservedRightInset={reservedRightInset}
        />
      </div>
    </div>
  );
}
