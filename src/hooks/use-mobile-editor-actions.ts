"use client";

import { useCallback } from "react";
import { useBlockSelectionStore } from "@/stores/block-selection-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useChatContextStore } from "@/stores/chat-context-store";
import { rangeToMarkdown } from "@/lib/markdown-selection";

/**
 * Hook for managing mobile editor actions (copy, cut, delete, AI)
 *
 * Handles block selection operations in mobile editor
 */
export function useMobileEditorActions() {
  const { selectedBlocks, getSelectedText, clearSelection } = useBlockSelectionStore();
  const { editor } = useEditorRefStore();
  const { addChatContext } = useChatContextStore();

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

  // Mobile: Prepare AI context from selection (serialized as markdown)
  const prepareAIContext = useCallback(() => {
    if (selectedBlocks.length > 0 && editor) {
      const firstBlock = selectedBlocks[0];
      const lastBlock = selectedBlocks[selectedBlocks.length - 1];
      const text = rangeToMarkdown(editor, firstBlock.from, lastBlock.to);
      if (text) {
        addChatContext({
          type: "selection",
          text,
          from: firstBlock.from,
          to: lastBlock.to,
        });
      }
      return text;
    }
    return getSelectedText();
  }, [editor, getSelectedText, selectedBlocks, addChatContext]);

  return {
    handleCopy,
    handleCut,
    handleDelete,
    prepareAIContext,
    clearSelection,
    hasSelection: selectedBlocks.length > 0,
  };
}
