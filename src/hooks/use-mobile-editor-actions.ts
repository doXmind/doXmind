"use client";

import { useCallback } from "react";
import { useBlockSelectionStore } from "@/stores/block-selection-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";

/**
 * Hook for managing mobile editor actions (copy, cut, delete).
 *
 * Handles block selection operations in mobile editor
 */
export function useMobileEditorActions() {
  const { selectedBlocks, getSelectedText, clearSelection } = useBlockSelectionStore();
  const { editor } = useEditorRefStore();

  // Mobile: Handle copy
  const handleCopy = useCallback(() => {
    const text = getSelectedText();
    if (text) {
      navigator.clipboard.writeText(text);
    }
  }, [getSelectedText]);

  // Mobile: Handle cut (copy + delete)
  const handleCut = useCallback(() => {
    const text = getSelectedText();
    if (text && editor) {
      navigator.clipboard.writeText(text);
      // Delete selected blocks
      for (const block of selectedBlocks) {
        editor.chain().focus().deleteRange({ from: block.from, to: block.to }).run();
      }
      clearSelection();
    }
  }, [getSelectedText, editor, selectedBlocks, clearSelection]);

  // Mobile: Handle delete
  const handleDelete = useCallback(() => {
    if (editor && selectedBlocks.length > 0) {
      // Delete selected blocks in reverse order to maintain positions
      const sortedBlocks = [...selectedBlocks].sort((a, b) => b.from - a.from);
      for (const block of sortedBlocks) {
        editor.chain().focus().deleteRange({ from: block.from, to: block.to }).run();
      }
      clearSelection();
    }
  }, [editor, selectedBlocks, clearSelection]);

  return {
    handleCopy,
    handleCut,
    handleDelete,
    clearSelection,
    hasSelection: selectedBlocks.length > 0,
  };
}
