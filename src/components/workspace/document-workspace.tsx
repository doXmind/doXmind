"use client";

import { Editor } from "@/components/editor/editor";
import { ExcelEditorWorkspace } from "@/components/excel-editor/excel-editor-workspace";
import { PdfEditorWorkspace } from "@/components/pdf-editor/pdf-editor-workspace";
import { isExcelFile, isPdfFile } from "@/lib/document-types";
import type { FileItem } from "@/stores/file-store";

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

  return <Editor file={file} reservedRightInset={reservedRightInset} />;
}
