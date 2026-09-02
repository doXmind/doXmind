"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { AttachmentWorkspace } from "@/components/workspace/attachment-workspace";
import { PageEditorHost } from "@/editor/page-editor-host";
import { isExcelFile, isHtmlFile, isMarkdownFile, isPdfFile } from "@/lib/document-types";
import { type FileItem } from "@/stores/file-store";

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
  return (
    <div className="relative flex h-full min-h-0 flex-col">
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
