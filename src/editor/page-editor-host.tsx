"use client";

import { MarkdownBlockRuntime } from "@/editor/markdown-block/markdown-block-runtime";
import type { FileItem } from "@/stores/file-store";

interface PageEditorHostProps {
  file: FileItem;
  isActivePane?: boolean;
  reservedRightInset?: number;
}

/** Mount the source-backed editor Adapter for every Markdown Page. */
export function PageEditorHost({
  file,
  isActivePane = true,
  reservedRightInset = 0,
}: PageEditorHostProps) {
  return (
    <MarkdownBlockRuntime
      file={file}
      isActivePane={isActivePane}
      reservedRightInset={reservedRightInset}
    />
  );
}
