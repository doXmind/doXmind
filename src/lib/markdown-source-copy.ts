"use client";

import { isMarkdownFile } from "@/lib/document-types";
import { pickNativeSaveLocation } from "@/lib/native-dialog";
import { invokeDesktop } from "@/lib/native-shell";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useEditorStore } from "@/stores/editor-store";
import { useFileStore } from "@/stores/file-store";

export interface MarkdownSourceCopyInput {
  root: string;
  relPath: string;
  name: string;
}

export interface MarkdownSourceCopyResult {
  path: string;
  bytes: number;
}

export function defaultMarkdownCopyName(name: string): string {
  const match = /^(.*?)(\.(?:md|markdown))$/i.exec(name);
  if (!match) return `${name} copy.md`;
  return `${match[1]} copy${match[2]}`;
}

/** Copy the complete Page file after the caller has flushed any live edits. */
export async function copyMarkdownSourceFile(
  input: MarkdownSourceCopyInput,
  dialogTitle = "Copy Markdown Source"
): Promise<MarkdownSourceCopyResult | null> {
  const destination = await pickNativeSaveLocation(
    dialogTitle,
    defaultMarkdownCopyName(input.name),
    [{ name: "Markdown", extensions: ["md", "markdown"] }]
  );
  if (!destination) return null;
  return invokeDesktop<MarkdownSourceCopyResult>("doc_copy_source", {
    root: input.root,
    path: input.relPath,
    destination,
  });
}

/**
 * Copy a Page's complete source file. The active Page is flushed first so the
 * copy can never silently lag behind the editor; a cancelled save/copy returns
 * null without writing anything.
 */
export async function copyPageMarkdownSource(
  fileId: string,
  dialogTitle?: string
): Promise<MarkdownSourceCopyResult | null> {
  let state = useFileStore.getState();
  let file = state.files.find((candidate) => candidate.id === fileId);
  if (!file || !isMarkdownFile(file)) {
    throw new Error("Only Markdown Pages can be copied as source.");
  }

  if (state.currentFileId === fileId) {
    const wasTransient = state.transientFile?.id === fileId;
    const requestSave = useEditorRefStore.getState().requestSave;
    if (requestSave) {
      if (!(await requestSave())) return null;
    } else if (state.transientFile?.id === fileId || useEditorStore.getState().isDirty) {
      throw new Error("The active Page is not ready to save.");
    }

    // Saving a transient Page replaces its synthetic id and workspace root.
    state = useFileStore.getState();
    const savedId = wasTransient ? state.currentFileId : fileId;
    file = savedId ? state.files.find((candidate) => candidate.id === savedId) : undefined;
    if (!file || !isMarkdownFile(file)) {
      throw new Error("The saved Markdown Page could not be resolved.");
    }
  }

  const relPath = file.storageHandle?.relPath;
  if (!state.rootPath || file.storageHandle?.mode !== "disk" || !relPath) {
    throw new Error("This Page does not have a readable Markdown source path.");
  }

  return copyMarkdownSourceFile({ root: state.rootPath, relPath, name: file.name }, dialogTitle);
}
