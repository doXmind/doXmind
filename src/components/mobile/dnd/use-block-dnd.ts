"use client";

/**
 * useBlockDnd Hook
 *
 * Core hook integrating @dnd-kit with TipTap editor for block reordering.
 * Handles drag events and executes ProseMirror transactions.
 */

import { useState, useCallback, useEffect } from "react";
import type { DragStartEvent, DragEndEvent, DragOverEvent } from "@dnd-kit/core";
import { useBlockSelectionStore } from "@/stores/block-selection-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { extractBlocks } from "@/extensions/block-selection-extension";
import { haptics } from "@/lib/haptics";
import type { SelectableBlock } from "@/types/block-selection";

export function useBlockDnd() {
  const { editor } = useEditorRefStore();
  const { startDrag, updateDrag, endDrag, clearSelection } = useBlockSelectionStore();

  const [activeBlock, setActiveBlock] = useState<SelectableBlock | null>(null);
  const [blocks, setBlocks] = useState<SelectableBlock[]>([]);

  // Sync blocks from editor document
  useEffect(() => {
    if (editor) {
      setBlocks(extractBlocks(editor.state.doc));
    }
  }, [editor]);

  // Refresh blocks when document changes
  useEffect(() => {
    if (!editor) return;

    const updateBlocks = () => {
      setBlocks(extractBlocks(editor.state.doc));
    };

    editor.on("update", updateBlocks);
    return () => {
      editor.off("update", updateBlocks);
    };
  }, [editor]);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const blockId = event.active.id as string;
      const block = blocks.find((b) => b.id === blockId);

      if (block) {
        haptics.medium();
        setActiveBlock(block);
        startDrag(block);
      }
    },
    [blocks, startDrag]
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { over } = event;
      if (over) {
        const overIndex = blocks.findIndex((b) => b.id === over.id);
        updateDrag(overIndex);
      }
    },
    [blocks, updateDrag]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      setActiveBlock(null);

      if (!over || !editor || active.id === over.id) {
        endDrag();
        return;
      }

      const oldIndex = blocks.findIndex((b) => b.id === active.id);
      const newIndex = blocks.findIndex((b) => b.id === over.id);

      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
        endDrag();
        return;
      }

      // Execute ProseMirror transaction to move the block
      try {
        const draggedBlock = blocks[oldIndex];
        const slice = editor.state.doc.slice(draggedBlock.from, draggedBlock.to);

        let targetPos: number;
        if (newIndex >= blocks.length) {
          targetPos = editor.state.doc.content.size;
        } else {
          targetPos = blocks[newIndex].from;
        }

        const tr = editor.state.tr;

        if (newIndex > oldIndex) {
          // Moving down: insert first, then delete
          tr.insert(targetPos, slice.content);
          tr.delete(draggedBlock.from, draggedBlock.to);
        } else {
          // Moving up: delete first, then insert at adjusted position
          tr.delete(draggedBlock.from, draggedBlock.to);
          const adjustedTargetPos = targetPos - (draggedBlock.to - draggedBlock.from);
          tr.insert(adjustedTargetPos, slice.content);
        }

        editor.view.dispatch(tr);
        haptics.light();
        clearSelection();
      } catch (err) {
        console.error("Failed to move block:", err);
      }

      endDrag();
    },
    [blocks, editor, endDrag, clearSelection]
  );

  const handleDragCancel = useCallback(() => {
    setActiveBlock(null);
    endDrag();
  }, [endDrag]);

  return {
    blocks,
    activeBlock,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
