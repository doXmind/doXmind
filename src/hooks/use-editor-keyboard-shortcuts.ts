"use client";

import { useEffect, useCallback } from "react";
import { useLayoutStore } from "@/stores/layout-store";

/**
 * Hook for managing global keyboard shortcuts in the editor page
 *
 * Handles:
 * - Ctrl+? / Cmd+? - Toggle keyboard shortcuts modal
 * - Ctrl+P / Cmd+P - Toggle command palette
 * - Ctrl+O / Cmd+O, or Ctrl+Tab - Quick switcher
 * - Ctrl+F / Cmd+F - Find in document
 *
 * Mod+K belongs to the editor's link editor, not to this hook: the editor stops that event and
 * opens the link editor, which is what the bubble menu and the shortcuts panel advertise.
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
    isFocusMode,
    toggleFocusMode,
    isQuickSwitcherOpen,
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

      // The editor claims a few Mod shortcuts when a text selection is live — Mod+K adds a link,
      // Mod+B/I/E apply marks — and signals that by calling `stopPropagation` and `preventDefault`.
      // Honouring `defaultPrevented` here is what stops one keystroke doing two things.
      if (e.defaultPrevented) return;

      // Ctrl+B or Cmd+B - Toggle the files sidebar. Owned here rather than by a main-process
      // accelerator so the editor can claim it for bold while text is selected.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        useLayoutStore.getState().toggleFilesSidebar();
        return;
      }

      // Ctrl+P or Cmd+P - Command palette (all scope). Obsidian's map: ⌘P is the palette and ⌘O
      // is the switcher. ⌘K stays free for the editor's own link editor.
      if ((e.ctrlKey || e.metaKey) && e.key === "p") {
        e.preventDefault();
        if (isCommandPaletteOpen) {
          setCommandPaletteOpen(false);
        } else {
          openCommandPalette();
        }
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

      // Escape - Exit focus mode. This listener sits on window, the last stop
      // in the bubble path, so it must be the last claim on Escape: anything
      // nearer the user (the editor's block selection, a popup, an open panel)
      // gets to close first and only a genuinely unhandled Escape leaves
      // focus mode.
      if (e.key === "Escape" && isFocusMode) {
        if (e.defaultPrevented) return;
        if (
          isCommandPaletteOpen ||
          isSearchBarOpen ||
          isKeyboardShortcutsOpen ||
          isQuickSwitcherOpen
        ) {
          return;
        }
        e.preventDefault();
        toggleFocusMode();
        return;
      }

      // Ctrl+Tab, or Cmd/Ctrl+O - Quick file switcher. The desktop menu registers ⌘O so it works
      // on every route; this branch is what makes it work in browser development too.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "Tab" || e.key === "o")) {
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
      isFocusMode,
      toggleFocusMode,
      isQuickSwitcherOpen,
      setQuickSwitcherOpen,
    ]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
