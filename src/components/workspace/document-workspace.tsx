"use client";

import { ExcelEditorWorkspace } from "@/components/excel-editor/excel-editor-workspace";
import { PdfEditorWorkspace } from "@/components/pdf-editor/pdf-editor-workspace";
import { MarkdownRuntime } from "@/components/workspace/markdown-runtime";
import { isExcelFile, isMarkdownFile, isPdfFile } from "@/lib/document-types";
import { type FileItem } from "@/stores/file-store";

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
    return <MarkdownRuntime file={file} reservedRightInset={reservedRightInset} />;
  }
  // Fallback for unknown markdown-ish files; MarkdownRuntime handles
  // unknown file types harmlessly because its content area is just a
  // TipTap surface populated from `file.content`.
  return <MarkdownRuntime file={file} reservedRightInset={reservedRightInset} />;
}
