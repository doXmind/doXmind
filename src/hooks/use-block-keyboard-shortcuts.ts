/**
 * Block Keyboard Shortcuts Hook
 *
 * Registers desktop keyboard shortcuts for block-level operations:
 * - Ctrl/Cmd+Shift+ArrowUp: Move block up
 * - Ctrl/Cmd+Shift+ArrowDown: Move block down
 * - Ctrl/Cmd+D: Duplicate block
 */

import { useEffect } from "react";
import type { Editor } from "@tiptap/core";
import {
  getCurrentBlock,
  moveBlockUp,
  moveBlockDown,
  duplicateBlock,
} from "@/lib/block-operations";

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

      const isMod = e.ctrlKey || e.metaKey;

      // Cmd/Ctrl+Shift+ArrowUp: Move block up
      if (isMod && e.shiftKey && e.key === "ArrowUp") {
        const block = getCurrentBlock(editor);
        if (block) {
          e.preventDefault();
          moveBlockUp(editor, block.from, block.to);
        }
        return;
      }

      // Cmd/Ctrl+Shift+ArrowDown: Move block down
      if (isMod && e.shiftKey && e.key === "ArrowDown") {
        const block = getCurrentBlock(editor);
        if (block) {
          e.preventDefault();
          moveBlockDown(editor, block.from, block.to);
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
    };

    // Use capture phase to intercept before browser default (e.g., Ctrl+D bookmark)
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [editor]);
}
