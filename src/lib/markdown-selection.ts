/**
 * Markdown Selection Utilities
 *
 * Serialize ProseMirror nodes and ranges to markdown via the editor's
 * markdown manager, ensuring selected content sent to AI matches
 * the markdown format the backend operates on.
 */

import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Serialize a ProseMirror node to markdown via the editor's markdown manager.
 * Falls back to textContent if manager unavailable.
 */
export function nodeToMarkdown(editor: Editor, node: PMNode): string {
  const manager = editor.storage.markdown?.manager;
  if (manager) {
    return manager.serialize({ type: "doc", content: [node.toJSON()] }).trim();
  }
  return node.textContent;
}

/**
 * Serialize a document range [from, to) to markdown.
 * Falls back to textBetween if manager unavailable.
 */
export function rangeToMarkdown(editor: Editor, from: number, to: number): string {
  const manager = editor.storage.markdown?.manager;
  if (!manager) {
    return editor.state.doc.textBetween(from, to, "\n\n");
  }

  const slice = editor.state.doc.slice(from, to);
  const content: Record<string, unknown>[] = [];
  slice.content.forEach((n) => content.push(n.toJSON()));
  if (content.length === 0) return "";

  // If content is inline (text nodes from partial block selection), wrap in paragraph
  const typeName = content[0].type as string;
  const nodeType = editor.schema.nodes[typeName];
  if (!nodeType || nodeType.isInline || typeName === "text") {
    return manager.serialize({ type: "doc", content: [{ type: "paragraph", content }] }).trim();
  }

  return manager.serialize({ type: "doc", content }).trim();
}
