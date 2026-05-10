"use client";

import { useCallback, useEffect, useState } from "react";
import { Editor } from "@/components/editor/editor";
import { ExcelEditorWorkspace } from "@/components/excel-editor/excel-editor-workspace";
import { PdfEditorWorkspace } from "@/components/pdf-editor/pdf-editor-workspace";
import {
  BrowsingRuntime,
  type EditActivationContext,
} from "@/components/workspace/browsing-runtime";
import { isExcelFile, isMarkdownFile, isPdfFile } from "@/lib/document-types";
import { TRANSIENT_ID_PREFIX, type FileItem } from "@/stores/file-store";

interface DocumentWorkspaceProps {
  file: FileItem;
  reservedRightInset?: number;
}

export function DocumentWorkspace({ file, reservedRightInset = 0 }: DocumentWorkspaceProps) {
  const [isEditing, setIsEditing] = useState(file.id.startsWith(TRANSIENT_ID_PREFIX));
  const [editActivationContext, setEditActivationContext] = useState<EditActivationContext>({
    scrollTop: 0,
  });

  useEffect(() => {
    setIsEditing(file.id.startsWith(TRANSIENT_ID_PREFIX));
    setEditActivationContext({ scrollTop: 0 });
  }, [file.id]);

  const activateEdit = useCallback((context: EditActivationContext) => {
    setEditActivationContext(context);
    setIsEditing(true);
  }, []);

  if (isPdfFile(file)) {
    return <PdfEditorWorkspace file={file} />;
  }
  if (isExcelFile(file)) {
    return <ExcelEditorWorkspace file={file} />;
  }
  if (isMarkdownFile(file) && !isEditing) {
    return (
      <BrowsingRuntime
        file={file}
        reservedRightInset={reservedRightInset}
        onActivateEdit={activateEdit}
      />
    );
  }

  return (
    <Editor
      file={file}
      reservedRightInset={reservedRightInset}
      initialScrollTop={editActivationContext.scrollTop}
      activationIntent={editActivationContext.intent}
    />
  );
}
