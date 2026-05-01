"use client";

import { Editor } from "@/components/editor/editor";
import { PdfEditorWorkspace } from "@/components/pdf-editor/pdf-editor-workspace";
import { isPdfFile } from "@/lib/document-types";
import type { FileItem } from "@/stores/file-store";

interface DocumentWorkspaceProps {
  file: FileItem;
}

export function DocumentWorkspace({ file }: DocumentWorkspaceProps) {
  if (isPdfFile(file)) {
    return <PdfEditorWorkspace file={file} />;
  }

  return <Editor file={file} />;
}
