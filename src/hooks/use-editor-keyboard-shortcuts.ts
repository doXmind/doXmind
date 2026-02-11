"use client";

import { useEffect, useCallback } from "react";
import { useLayoutStore } from "@/stores/layout-store";

/**
 * Hook for managing global keyboard shortcuts in the editor page
 *
 * Handles:
 * - Ctrl+? / Cmd+? - Toggle keyboard shortcuts modal
 * - Ctrl+K / Cmd+K - Toggle command palette
 * - Ctrl+Shift+F / Cmd+Shift+F - AI semantic search
 * - Ctrl+F / Cmd+F - Find in document
 */
export function useEditorKeyboardShortcuts() {
  const {
    isKeyboardShortcutsOpen,
    setKeyboardShortcutsOpen,
    isCommandPaletteOpen,
    setCommandPaletteOpen,
    openCommandPalette,
    isSearchBarOpen,
    setSearchBarOpen,
    openSearchBarWithAI,
    isFocusMode,
    toggleFocusMode,
    setQuickSwitcherOpen,
  } = useLayoutStore();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ctrl+? or Cmd+? (Shift+/ on most keyboards) - Keyboard shortcuts
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "?") {
        e.preventDefault();
        setKeyboardShortcutsOpen(!isKeyboardShortcutsOpen);
        return;
      }

      // Ctrl+K or Cmd+K - Command palette (all scope)
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        if (isCommandPaletteOpen) {
          setCommandPaletteOpen(false);
        } else {
          openCommandPalette();
        }
        return;
      }

      // Ctrl+Shift+F or Cmd+Shift+F - AI Search (semantic search)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (isCommandPaletteOpen) {
          setCommandPaletteOpen(false);
        }
        openSearchBarWithAI();
        return;
      }

      // Ctrl+F or Cmd+F - Search bar (find in document)
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        if (isCommandPaletteOpen) {
          setCommandPaletteOpen(false);
        }
        setSearchBarOpen(!isSearchBarOpen);
        return;
      }

      // F11 - Toggle focus mode
      if (e.key === "F11") {
        e.preventDefault();
        toggleFocusMode();
        return;
      }

      // Escape - Exit focus mode
      if (e.key === "Escape" && isFocusMode) {
        e.preventDefault();
        toggleFocusMode();
        return;
      }

      // Ctrl+Tab - Quick file switcher
      if ((e.ctrlKey || e.metaKey) && e.key === "Tab") {
        e.preventDefault();
        setQuickSwitcherOpen(true);
        return;
      }
    },
    [
      isKeyboardShortcutsOpen,
      setKeyboardShortcutsOpen,
      isCommandPaletteOpen,
      setCommandPaletteOpen,
      openCommandPalette,
      isSearchBarOpen,
      setSearchBarOpen,
      openSearchBarWithAI,
      isFocusMode,
      toggleFocusMode,
      setQuickSwitcherOpen,
    ]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
