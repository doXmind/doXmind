"use client";

import { useState, useCallback, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { BlockActionMenu } from "./block-action-menu";

interface EditorContextMenuProps {
  editor: Editor;
}

/**
 * Resolve the start position of the top-level block (or list/task item) under
 * the given viewport coordinates. Probes a few x offsets (like the block
 * handle) and falls back to the block at the current selection, so a
 * right-click always resolves to a real block.
 */
function blockStartPosAtCoords(editor: Editor, x: number, y: number): number | null {
  const fromPos = (pos: number): number | null => {
    try {
      const $pos = editor.state.doc.resolve(pos);
      for (let depth = $pos.depth; depth >= 1; depth--) {
        const name = $pos.node(depth).type.name;
        if (name === "listItem" || name === "taskItem") return $pos.before(depth);
      }
      if ($pos.depth >= 1) return $pos.before(1);
    } catch {
      return null;
    }
    return null;
  };

  for (const probeX of [x, x + 24, x - 24]) {
    const info = editor.view.posAtCoords({ left: probeX, top: y });
    if (info) {
      const bp = fromPos(info.pos);
      if (bp !== null) return bp;
    }
  }

  // Fallback: the block containing the current selection.
  return fromPos(editor.state.selection.from);
}

/**
 * Notion-style right-click: opens the block action menu (Turn into / Color /
 * Align / Duplicate / Copy / Move / Delete) for the block under the cursor,
 * instead of a text Cut/Copy/Paste menu. Reuses BlockActionMenu, which owns
 * its positioning, keyboard navigation, and dismissal.
 */
export function EditorContextMenu({ editor }: EditorContextMenuProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [blockPos, setBlockPos] = useState<number | null>(null);

  const close = useCallback(() => {
    setPosition(null);
    setBlockPos(null);
  }, []);

  useEffect(() => {
    const dom = editor.view.dom;

    const handleContextMenu = (e: MouseEvent) => {
      // Always own the editor's context menu (no native Cut/Copy/Paste, like
      // Notion). Resolve the target block; fall back to the current selection.
      const pos = blockStartPosAtCoords(editor, e.clientX, e.clientY);
      // preventDefault (no stopPropagation) so the event still reaches the
      // document-level ContextMenuGuard, which bails on defaultPrevented — the
      // contract its comment documents. Stopping propagation would silently
      // break that escape clause.
      e.preventDefault();
      setBlockPos(pos);
      setPosition({ x: e.clientX, y: e.clientY });
    };

    dom.addEventListener("contextmenu", handleContextMenu);
    return () => dom.removeEventListener("contextmenu", handleContextMenu);
  }, [editor]);

  if (position === null || blockPos === null) return null;

  return (
    <BlockActionMenu editor={editor} blockPos={blockPos} position={position} onClose={close} />
  );
}
