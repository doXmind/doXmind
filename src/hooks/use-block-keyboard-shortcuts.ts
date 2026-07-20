/**
 * Block Keyboard Shortcuts Hook
 *
 * Registers desktop keyboard shortcuts for block-level operations:
 * - Ctrl/Cmd+Shift+ArrowUp: Move block up
 * - Ctrl/Cmd+Shift+ArrowDown: Move block down
 * - Ctrl/Cmd+D: Duplicate block
 * - Ctrl/Cmd+A: Select the current block, then the document
 *
 * Plus a Tab guard that keeps focus inside the editor.
 */

import { useEffect } from "react";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  getCurrentBlock,
  moveBlockUp,
  moveBlockDown,
  duplicateBlock,
} from "@/lib/block-operations";

/**
 * Move the block at [from, to] one slot in `direction` and carry the caret
 * with it. Without the caret move, a second press resolves the block under a
 * now-stale caret and shuffles the wrong block.
 */
export function moveBlockWithCaret(
  editor: Editor,
  from: number,
  to: number,
  direction: "up" | "down"
): boolean {
  const { state } = editor;
  const $pos = state.doc.resolve(from);
  const parent = $pos.node($pos.depth);
  const index = $pos.index($pos.depth);
  const caret = state.selection.from;
  const caretInsideBlock = caret >= from && caret <= to;

  let delta: number;
  let moved: boolean;
  if (direction === "up") {
    if (index === 0) return false;
    delta = -parent.child(index - 1).nodeSize;
    moved = moveBlockUp(editor, from, to);
  } else {
    if (index >= parent.childCount - 1) return false;
    delta = parent.child(index + 1).nodeSize;
    moved = moveBlockDown(editor, from, to);
  }
  if (!moved) return false;

  if (caretInsideBlock) {
    const target = Math.min(Math.max(caret + delta, 0), editor.state.doc.content.size);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(target)))
    );
  }
  editor.view.focus();
  return true;
}

export function useBlockKeyboardShortcuts(editor: Editor | null) {
  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // ProseMirror's `editable` flag only gates DOM-driven edits (typing,
      // paste, beforeinput); programmatic `view.dispatch(tr)` always lands.
      // Without this guard, a stray Cmd+D (macOS reflex for "Add bookmark")
      // would silently duplicate the first top-level block and autosave the
      // corruption to disk in read mode.
      if (!editor.isEditable) return;

      // These are editor commands, not app commands. A capture-phase document
      // listener sees every keystroke in the window, including the ones typed
      // into the sidebar or a modal input.
      const target = e.target as Node | null;
      if (!editor.view.hasFocus() && !(target && editor.view.dom.contains(target))) return;

      const isMod = e.ctrlKey || e.metaKey;

      // Cmd/Ctrl+Shift+ArrowUp: Move block up
      if (isMod && e.shiftKey && e.key === "ArrowUp") {
        const block = getCurrentBlock(editor);
        if (block) {
          e.preventDefault();
          moveBlockWithCaret(editor, block.from, block.to, "up");
        }
        return;
      }

      // Cmd/Ctrl+Shift+ArrowDown: Move block down
      if (isMod && e.shiftKey && e.key === "ArrowDown") {
        const block = getCurrentBlock(editor);
        if (block) {
          e.preventDefault();
          moveBlockWithCaret(editor, block.from, block.to, "down");
        }
        return;
      }

      // Cmd/Ctrl+D: Duplicate block
      if (isMod && e.key === "d") {
        const block = getCurrentBlock(editor);
        if (block) {
          e.preventDefault();
          duplicateBlock(editor, block.from, block.to);
        }
        return;
      }

      // Cmd/Ctrl+A: scope to the block under the caret first. Selecting the
      // whole document from inside a code block or a table cell is a keystroke
      // away from replacing the file's entire contents.
      if (isMod && !e.shiftKey && !e.altKey && (e.key === "a" || e.key === "A")) {
        const { selection } = editor.state;
        const { $from } = selection;
        if ($from.depth < 1) return;

        const blockFrom = $from.start($from.depth);
        const blockTo = $from.end($from.depth);
        // Already covering the block — fall through so the editor's own
        // select-all widens to the document.
        if (selection.from <= blockFrom && selection.to >= blockTo) return;

        e.preventDefault();
        e.stopPropagation();
        editor.view.dispatch(
          editor.state.tr.setSelection(TextSelection.create(editor.state.doc, blockFrom, blockTo))
        );
        return;
      }
    };

    // Use capture phase to intercept before browser default (e.g., Ctrl+D bookmark)
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;

    // Registered after the view exists, so ProseMirror's own keydown handler
    // has already run: anything that wanted Tab (list indent, table cell
    // navigation, code block) called preventDefault. What is left would move
    // focus out of the contenteditable, and every following keystroke would go
    // nowhere with no visible sign of why.
    const keepTabInsideEditor = (e: KeyboardEvent) => {
      if (e.key === "Tab" && !e.defaultPrevented) {
        e.preventDefault();
      }
    };

    dom.addEventListener("keydown", keepTabInsideEditor);
    return () => dom.removeEventListener("keydown", keepTabInsideEditor);
  }, [editor]);
}
