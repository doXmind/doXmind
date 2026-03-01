/**
 * Editor Edit Operations
 *
 * Functions for applying AI edits through ProseMirror transactions.
 */

import type { Editor as TiptapEditor } from "@tiptap/react";
import type { PendingEdit } from "@/stores/editor-store";

/**
 * Apply a pending edit through ProseMirror's transaction system.
 * Uses @tiptap/markdown for schema-aware parsing, preserving undo history.
 *
 * @param editor - TipTap editor instance
 * @param edit - Pending edit to apply
 */
export function applyPendingEdit(editor: TiptapEditor, edit: PendingEdit): void {
  // Get markdown directly from editor (schema-aware, no Turndown)
  const currentMarkdown = editor.getMarkdown();

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

  if (!success || !editor.markdown) {
    return;
  }

  // Parse markdown via @tiptap/markdown — schema-aware, no HTML roundtrip
  const json = editor.markdown.parse(newMarkdown);
  const newDoc = editor.schema.nodeFromJSON(json);

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

  for (const edit of edits) {
    try {
      applyPendingEdit(editor, edit);
      clearEdit(edit.id);
    } catch {
      clearEdit(edit.id);
    }
  }
}
