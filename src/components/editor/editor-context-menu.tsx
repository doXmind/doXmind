"use client";

import { useState, useCallback, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { BlockActionMenu } from "./block-action-menu";
import { LinkModal } from "./link-modal";

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
 *
 * Also hosts the Mod+K link modal: this component is mounted for as long as
 * the editor is, which a keyboard shortcut needs and the bubble menu (rendered
 * only while a selection is hovered) cannot offer.
 */
export function EditorContextMenu({ editor }: EditorContextMenuProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [blockPos, setBlockPos] = useState<number | null>(null);
  const [linkModalOpen, setLinkModalOpen] = useState(false);

  const close = useCallback(() => {
    setPosition(null);
    setBlockPos(null);
  }, []);

  // Mod+K. The bubble menu's tooltip and the shortcuts panel both advertise
  // this as "Add link", but the global palette shortcut is on window and would
  // otherwise take every press. Claim it here — this component is mounted for
  // the whole life of the editor, unlike the bubble menu — and only when there
  // is something to link; with no selection the palette still wins.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key !== "k") return;
      if (!editor.isEditable) return;

      const target = e.target as Node | null;
      if (!editor.view.hasFocus() && !(target && editor.view.dom.contains(target))) return;

      if (editor.state.selection.empty) return;

      e.preventDefault();
      e.stopPropagation();
      setLinkModalOpen(true);
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [editor]);

  const handleLinkConfirm = useCallback(
    (url: string) => {
      editor.chain().focus().setLink({ href: url }).run();
    },
    [editor]
  );

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

  return (
    <>
      <LinkModal
        open={linkModalOpen}
        onClose={() => setLinkModalOpen(false)}
        onConfirm={handleLinkConfirm}
      />
      {position !== null && blockPos !== null && (
        <BlockActionMenu editor={editor} blockPos={blockPos} position={position} onClose={close} />
      )}
    </>
  );
}
