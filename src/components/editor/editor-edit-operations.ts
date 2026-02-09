/**
 * Editor Edit Operations
 *
 * Functions for applying AI edits through ProseMirror transactions.
 */

import type { Editor as TiptapEditor } from "@tiptap/react";
import type { PendingEdit } from "@/stores/editor-store";
import { htmlToMarkdown, markdownToHtml, isHtml } from "@/lib/markdown";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";

/**
 * Apply a pending edit through ProseMirror's transaction system.
 * Uses replaceWith to properly replace document content while preserving undo history.
 *
 * @param editor - TipTap editor instance
 * @param edit - Pending edit to apply
 * @param currentHtmlContent - Current HTML content from editor
 */
export function applyPendingEdit(
  editor: TiptapEditor,
  edit: PendingEdit,
  currentHtmlContent: string
): void {
  // Convert current HTML to markdown for text operations
  const currentMarkdown = isHtml(currentHtmlContent)
    ? htmlToMarkdown(currentHtmlContent)
    : currentHtmlContent;

  let newMarkdown = currentMarkdown;
  let success = false;

  switch (edit.type) {
    case "str_replace":
      if (edit.oldStr && edit.newStr !== undefined) {
        if (currentMarkdown.includes(edit.oldStr)) {
          newMarkdown = currentMarkdown.replace(edit.oldStr, edit.newStr);
          success = true;
        }
      }
      break;

    case "replace_all":
      if (edit.newContent !== undefined) {
        newMarkdown = edit.newContent;
        success = true;
      }
      break;
  }

  if (!success) {
    return;
  }

  // Convert back to HTML
  const newHtml = markdownToHtml(newMarkdown);

  // Parse the new HTML into a ProseMirror document
  const element = document.createElement("div");
  element.innerHTML = newHtml;
  const newDoc = ProseMirrorDOMParser.fromSchema(editor.schema).parse(element);

  // Use ProseMirror transaction to replace the entire document
  // This properly adds to undo history
  const { tr } = editor.state;
  tr.replaceWith(0, editor.state.doc.content.size, newDoc.content);
  editor.view.dispatch(tr);
}

/**
 * Apply multiple pending edits to the editor
 *
 * @param editor - TipTap editor instance
 * @param edits - Array of pending edits
 * @param clearEdit - Function to clear a processed edit
 */
export function applyPendingEdits(
  editor: TiptapEditor,
  edits: PendingEdit[],
  clearEdit: (id: string) => void
): void {
  if (edits.length === 0) return;

  const currentEditorContent = editor.getHTML();

  for (const edit of edits) {
    try {
      applyPendingEdit(editor, edit, currentEditorContent);
      clearEdit(edit.id);
    } catch {
      clearEdit(edit.id);
    }
  }
}
