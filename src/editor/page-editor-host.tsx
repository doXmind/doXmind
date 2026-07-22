"use client";

import { MarkdownBlockRuntime } from "@/editor/markdown-block/markdown-block-runtime";
import type { FileItem } from "@/stores/file-store";

interface PageEditorHostProps {
  file: FileItem;
  reservedRightInset?: number;
}

/** Mount the source-backed editor Adapter for every Markdown Page. */
export function PageEditorHost({ file, reservedRightInset = 0 }: PageEditorHostProps) {
  return <MarkdownBlockRuntime file={file} reservedRightInset={reservedRightInset} />;
}
