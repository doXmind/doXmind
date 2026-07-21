"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { AttachmentWorkspace } from "@/components/workspace/attachment-workspace";
import { MarkdownRuntime } from "@/components/workspace/markdown-runtime";
import { MarkdownSkeleton } from "@/components/workspace/markdown-skeleton";
import { isExcelFile, isHtmlFile, isMarkdownFile, isPdfFile } from "@/lib/document-types";
import { type FileItem } from "@/stores/file-store";

const PdfEditorWorkspace = dynamic(
  () =>
    import("@/components/pdf-editor/pdf-editor-workspace").then((m) => ({
      default: m.PdfEditorWorkspace,
    })),
  { ssr: false, loading: () => <MarkdownSkeleton /> }
);

const ExcelEditorWorkspace = dynamic(
  () =>
    import("@/components/excel-editor/excel-editor-workspace").then((m) => ({
      default: m.ExcelEditorWorkspace,
    })),
  { ssr: false, loading: () => <MarkdownSkeleton /> }
);

interface DocumentWorkspaceProps {
  file: FileItem;
  reservedRightInset?: number;
}

export function DocumentWorkspace({ file, reservedRightInset = 0 }: DocumentWorkspaceProps) {
  const [legacyRecoveryFileId, setLegacyRecoveryFileId] = useState<string | null>(null);

  if (isHtmlFile(file)) {
    return <AttachmentWorkspace file={file} />;
  }
  if (isPdfFile(file)) {
    if (legacyRecoveryFileId !== file.id) {
      return (
        <AttachmentWorkspace
          file={file}
          onOpenLegacyRecovery={() => setLegacyRecoveryFileId(file.id)}
        />
      );
    }
    return (
      <div className="relative h-full min-h-0">
        <LegacyRecoveryControls kind="pdf" onExit={() => setLegacyRecoveryFileId(null)} />
        <PdfEditorWorkspace file={file} />
      </div>
    );
  }
  if (isExcelFile(file)) {
    if (legacyRecoveryFileId !== file.id) {
      return (
        <AttachmentWorkspace
          file={file}
          onOpenLegacyRecovery={() => setLegacyRecoveryFileId(file.id)}
        />
      );
    }
    return (
      <div className="relative h-full min-h-0">
        <LegacyRecoveryControls kind="excel" onExit={() => setLegacyRecoveryFileId(null)} />
        <ExcelEditorWorkspace file={file} />
      </div>
    );
  }
  if (isMarkdownFile(file)) {
    return <MarkdownRuntime file={file} reservedRightInset={reservedRightInset} />;
  }
  // Fallback for unknown markdown-ish files; MarkdownRuntime handles
  // unknown file types harmlessly because its content area is just a
  // TipTap surface populated from `file.content`.
  return <MarkdownRuntime file={file} reservedRightInset={reservedRightInset} />;
}

function LegacyRecoveryControls({ kind, onExit }: { kind: "pdf" | "excel"; onExit: () => void }) {
  const t = useTranslations("attachment");
  const exportRecoveredFile = () => {
    const eventName = kind === "pdf" ? "doxmind:export-pdf" : "doxmind:export-xlsx";
    window.dispatchEvent(new CustomEvent(eventName));
  };

  return (
    <div className="absolute inset-x-4 top-16 z-50 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-background/95 p-3 shadow-sm backdrop-blur">
      <p className="mr-auto text-sm font-semibold text-foreground">{t("recoveryMode")}</p>
      <Button size="sm" onClick={exportRecoveredFile}>
        {kind === "pdf" ? t("exportRecoveredPdf") : t("exportRecoveredSpreadsheet")}
      </Button>
      <Button variant="outline" size="sm" onClick={onExit}>
        {t("exitRecovery")}
      </Button>
    </div>
  );
}
