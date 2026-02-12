/**
 * Block Operations
 *
 * Core functions for block-level manipulation in the TipTap editor.
 * Used by Block Action Menu, keyboard shortcuts, and drag & drop.
 * All operations create atomic ProseMirror transactions (Ctrl+Z undoable).
 */

import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface BlockInfo {
  /** Start position of the block in the document */
  from: number;
  /** End position of the block in the document */
  to: number;
  /** The ProseMirror node */
  node: ProseMirrorNode;
}

/**
 * Get the top-level block (depth=1) containing the current cursor position
 */
export function getCurrentBlock(editor: Editor): BlockInfo | null {
  const { $from } = editor.state.selection;
  if ($from.depth < 1) return null;

  const from = $from.before(1);
  const to = $from.after(1);
  const node = $from.node(1);

  return { from, to, node };
}

/**
 * Get the block node at a specific ProseMirror position.
 * Works for both top-level blocks and nested nodes (e.g., list items).
 */
export function getBlockAtPos(editor: Editor, pos: number): BlockInfo | null {
  try {
    const node = editor.state.doc.nodeAt(pos);
    if (node) {
      return { from: pos, to: pos + node.nodeSize, node };
    }
  } catch {
    // Position out of bounds
  }
  return null;
}

/**
 * Move a block up (swap with previous sibling).
 * Works at any nesting level (top-level blocks, list items, etc.).
 */
export function moveBlockUp(editor: Editor, from: number, _to: number): boolean {
  const { state } = editor;
  const $pos = state.doc.resolve(from);
  const depth = $pos.depth;
  const parent = $pos.node(depth);
  const index = $pos.index(depth);

  if (index === 0) return false; // Already first child

  const currentNode = parent.child(index);
  const prevNode = parent.child(index - 1);
  const prevFrom = from - prevNode.nodeSize;

  const tr = state.tr;
  tr.replaceWith(prevFrom, from + currentNode.nodeSize, [
    currentNode.copy(currentNode.content),
    prevNode.copy(prevNode.content),
  ]);

  editor.view.dispatch(tr);
  return true;
}

/**
 * Move a block down (swap with next sibling).
 * Works at any nesting level (top-level blocks, list items, etc.).
 */
export function moveBlockDown(editor: Editor, from: number, to: number): boolean {
  const { state } = editor;
  const $pos = state.doc.resolve(from);
  const depth = $pos.depth;
  const parent = $pos.node(depth);
  const index = $pos.index(depth);

  if (index >= parent.childCount - 1) return false; // Already last child

  const currentNode = parent.child(index);
  const nextNode = parent.child(index + 1);

  const tr = state.tr;
  tr.replaceWith(from, to + nextNode.nodeSize, [
    nextNode.copy(nextNode.content),
    currentNode.copy(currentNode.content),
  ]);

  editor.view.dispatch(tr);
  return true;
}

/**
 * Duplicate a block (insert copy after the original)
 */
export function duplicateBlock(editor: Editor, from: number, to: number): boolean {
  const { state } = editor;
  const slice = state.doc.slice(from, to);

  const tr = state.tr;
  tr.insert(to, slice.content);
  editor.view.dispatch(tr);
  return true;
}

/**
 * Delete a block.
 * For list items: if this is the last item in the list, deletes the entire list.
 */
export function deleteBlock(editor: Editor, from: number, to: number): boolean {
  const { state } = editor;
  const $pos = state.doc.resolve(from);
  const depth = $pos.depth;
  const parent = $pos.node(depth);

  // If this is the only child of a non-doc parent (e.g., last item in a list),
  // delete the parent wrapper instead to avoid leaving an empty list.
  if (depth >= 1 && parent.childCount <= 1) {
    const parentFrom = $pos.before(depth);
    const parentTo = $pos.after(depth);
    return deleteBlock(editor, parentFrom, parentTo);
  }

  // Don't delete the last top-level block
  if (depth === 0 && state.doc.childCount <= 1) {
    editor.chain().focus().clearContent().run();
    return true;
  }

  const tr = state.tr;
  tr.delete(from, to);
  editor.view.dispatch(tr);
  return true;
}

/**
 * Delete multiple blocks (processes in reverse order to avoid position shifts)
 */
export function deleteBlocks(editor: Editor, blocks: Array<{ from: number; to: number }>): boolean {
  if (blocks.length === 0) return false;

  const { state } = editor;

  // Don't delete all blocks
  if (blocks.length >= state.doc.childCount) {
    editor.chain().focus().clearContent().run();
    return true;
  }

  // Sort blocks in reverse position order to avoid position shifts
  const sorted = [...blocks].sort((a, b) => b.from - a.from);

  const tr = state.tr;
  for (const block of sorted) {
    tr.delete(block.from, block.to);
  }

  editor.view.dispatch(tr);
  return true;
}

/**
 * Copy a block's HTML content to the clipboard
 */
export async function copyBlockToClipboard(
  editor: Editor,
  from: number,
  to: number
): Promise<boolean> {
  try {
    const slice = editor.state.doc.slice(from, to);
    const div = document.createElement("div");
    const fragment = (
      editor.view as unknown as {
        serializeForClipboard: (slice: unknown) => { dom: DocumentFragment };
      }
    ).serializeForClipboard?.(slice);

    if (fragment) {
      div.appendChild(fragment.dom);
    } else {
      // Fallback: get text content
      div.textContent = slice.content.textBetween(0, slice.content.size, "\n");
    }

    await navigator.clipboard.writeText(div.textContent || "");
    return true;
  } catch {
    // Clipboard API might not be available
    return false;
  }
}
