/**
 * Block Selection Hook
 *
 * Hook for managing block-based selection on mobile.
 * Listens for block-long-press events and manages selection state.
 * Long-press to select a block (entire block is selected).
 */

import { useEffect, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { useBlockSelectionStore } from "@/stores/block-selection-store";
import { extractBlocks } from "@/extensions/block-selection-extension";
import { haptics } from "@/lib/haptics";
import type { SelectableBlock, BlockLongPressEventDetail } from "@/types/block-selection";

export interface UseBlockSelectionOptions {
  /** TipTap editor instance */
  editor: Editor | null;
  /** Whether block selection is enabled */
  enabled?: boolean;
  /** Callback when selection changes */
  onSelectionChange?: (blocks: SelectableBlock[]) => void;
}

export function useBlockSelection({
  editor,
  enabled = true,
  onSelectionChange,
}: UseBlockSelectionOptions) {
  const {
    selectedBlocks,
    isSelectionActive,
    toggleBlockSelection,
    clearSelection,
    getSelectedText,
  } = useBlockSelectionStore();

  // Handle block selection events (tap or long-press)
  const handleBlockSelect = useCallback(
    (event: CustomEvent<BlockLongPressEventDetail>) => {
      if (!enabled) return;

      const { block } = event.detail;

      // Toggle selection with haptic feedback
      haptics.selection();
      toggleBlockSelection(block);
    },
    [enabled, toggleBlockSelection]
  );

  // Listen for block-select events
  useEffect(() => {
    if (!enabled) return;

    document.addEventListener("block-select", handleBlockSelect as EventListener);

    return () => {
      document.removeEventListener("block-select", handleBlockSelect as EventListener);
    };
  }, [enabled, handleBlockSelect]);

  // Sync selection with editor commands
  useEffect(() => {
    if (!editor) return;

    // Update editor decorations when selection changes
    const blockIds = selectedBlocks.map((b) => b.id);
    editor.commands.setSelectedBlocks(blockIds);
  }, [editor, selectedBlocks]);

  // Notify when selection changes
  useEffect(() => {
    onSelectionChange?.(selectedBlocks);
  }, [selectedBlocks, onSelectionChange]);

  // Clear selection when clicking outside editor
  // Use a flag to avoid clearing on the same interaction as long-press
  const handleDocumentClick = useCallback(
    (event: MouseEvent) => {
      if (!enabled || !isSelectionActive) return;

      const target = event.target as HTMLElement;

      // Don't clear if clicking on action bar
      const actionBar = document.querySelector("[data-action-bar]");
      if (actionBar?.contains(target)) {
        return;
      }

      // Don't clear if clicking on AI input area (context pills, input field, etc.)
      const aiInputArea = document.querySelector("[data-ai-input-area]");
      if (aiInputArea?.contains(target)) {
        return;
      }

      // Check if click is inside the editor content area
      const editorContent = document.querySelector(".ProseMirror");
      if (!editorContent?.contains(target)) {
        // Click outside editor - clear selection
        clearSelection();
        haptics.light();
      }
    },
    [enabled, isSelectionActive, clearSelection]
  );

  useEffect(() => {
    if (!enabled) return;

    // Use a small delay to avoid interfering with long-press
    const handleClick = (event: MouseEvent) => {
      // Wait a tick to ensure long-press handler runs first
      setTimeout(() => handleDocumentClick(event), 10);
    };

    document.addEventListener("click", handleClick, true);

    return () => {
      document.removeEventListener("click", handleClick, true);
    };
  }, [enabled, handleDocumentClick]);

  // Get all blocks from the document
  const getAllBlocks = useCallback((): SelectableBlock[] => {
    if (!editor) return [];
    return extractBlocks(editor.state.doc);
  }, [editor]);

  // Check if a specific block is selected
  const isBlockSelected = useCallback(
    (blockId: string): boolean => {
      return selectedBlocks.some((b) => b.id === blockId);
    },
    [selectedBlocks]
  );

  // Select all blocks
  const selectAll = useCallback(() => {
    if (!editor) return;
    const allBlocks = extractBlocks(editor.state.doc);
    for (const block of allBlocks) {
      if (!selectedBlocks.some((b) => b.id === block.id)) {
        toggleBlockSelection(block);
      }
    }
    haptics.medium();
  }, [editor, selectedBlocks, toggleBlockSelection]);

  // Get the combined text of selected blocks
  const selectedText = getSelectedText();

  return {
    // State
    selectedBlocks,
    isSelectionActive,
    selectedText,
    selectedCount: selectedBlocks.length,

    // Actions
    toggleBlockSelection,
    clearSelection,
    selectAll,
    getAllBlocks,
    isBlockSelected,
  };
}

/**
 * Hook for detecting block positions in the editor
 * Useful for positioning UI elements relative to selected blocks
 */
export function useBlockPositions(selectedBlocks: SelectableBlock[]) {
  const getBlockRect = useCallback((blockId: string): DOMRect | null => {
    const element = document.querySelector(`[data-block-id="${blockId}"]`);
    if (!element) return null;
    return element.getBoundingClientRect();
  }, []);

  const getSelectionBounds = useCallback((): DOMRect | null => {
    if (selectedBlocks.length === 0) return null;

    let minTop = Infinity;
    let maxBottom = -Infinity;
    let minLeft = Infinity;
    let maxRight = -Infinity;

    for (const block of selectedBlocks) {
      const rect = getBlockRect(block.id);
      if (rect) {
        minTop = Math.min(minTop, rect.top);
        maxBottom = Math.max(maxBottom, rect.bottom);
        minLeft = Math.min(minLeft, rect.left);
        maxRight = Math.max(maxRight, rect.right);
      }
    }

    if (minTop === Infinity) return null;

    return new DOMRect(minLeft, minTop, maxRight - minLeft, maxBottom - minTop);
  }, [selectedBlocks, getBlockRect]);

  return {
    getBlockRect,
    getSelectionBounds,
  };
}
