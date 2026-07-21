"use client";

import { AttachmentWorkspace } from "@/components/workspace/attachment-workspace";
import { MarkdownRuntime } from "@/components/workspace/markdown-runtime";
import { isMarkdownFile } from "@/lib/document-types";
import { type FileItem } from "@/stores/file-store";

interface DocumentWorkspaceProps {
  file: FileItem;
  reservedRightInset?: number;
}

export function DocumentWorkspace({ file, reservedRightInset = 0 }: DocumentWorkspaceProps) {
  if (isMarkdownFile(file)) {
    return <MarkdownRuntime file={file} reservedRightInset={reservedRightInset} />;
  }
  return <AttachmentWorkspace file={file} />;
}
