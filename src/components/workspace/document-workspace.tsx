"use client";

import dynamic from "next/dynamic";
import { MarkdownDocumentWorkspace } from "@/components/workspace/markdown-document-workspace";
import { MarkdownSkeleton } from "@/components/workspace/markdown-skeleton";
import { isExcelFile, isMarkdownFile, isPdfFile } from "@/lib/document-types";
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
  if (isPdfFile(file)) {
    return <PdfEditorWorkspace file={file} />;
  }
  if (isExcelFile(file)) {
    return <ExcelEditorWorkspace file={file} />;
  }
  if (isMarkdownFile(file)) {
    return <MarkdownDocumentWorkspace file={file} reservedRightInset={reservedRightInset} />;
  }
  // Fallback for unknown markdown-ish files; MarkdownDocumentWorkspace handles
  // unknown file types harmlessly because its content area is just a
  // TipTap surface populated from `file.content`.
  return <MarkdownDocumentWorkspace file={file} reservedRightInset={reservedRightInset} />;
}
