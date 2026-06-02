"use client";

import dynamic from "next/dynamic";
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

const HtmlRuntime = dynamic(
  () =>
    import("@/components/workspace/html-runtime").then((m) => ({
      default: m.HtmlRuntime,
    })),
  { ssr: false, loading: () => <MarkdownSkeleton /> }
);

interface DocumentWorkspaceProps {
  file: FileItem;
  reservedRightInset?: number;
}

export function DocumentWorkspace({ file, reservedRightInset = 0 }: DocumentWorkspaceProps) {
  if (isPdfFile(file)) {
    return <PdfEditorWorkspace file={file} />;
  }
  if (isExcelFile(file)) {
    return <ExcelEditorWorkspace file={file} />;
  }
  // HTML renders faithfully (real HTML + CSS) in a sandboxed iframe and is
  // edited in place — NOT through the TipTap schema (issue #139).
  if (isHtmlFile(file)) {
    return <HtmlRuntime file={file} />;
  }
  if (isMarkdownFile(file)) {
    return <MarkdownRuntime file={file} reservedRightInset={reservedRightInset} />;
  }
  // Fallback for unknown markdown-ish files; MarkdownRuntime handles
  // unknown file types harmlessly because its content area is just a
  // TipTap surface populated from `file.content`.
  return <MarkdownRuntime file={file} reservedRightInset={reservedRightInset} />;
}
