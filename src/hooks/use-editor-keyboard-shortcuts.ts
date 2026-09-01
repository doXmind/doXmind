"use client";

import { useEffect, useCallback } from "react";
import { useLayoutStore } from "@/stores/layout-store";
import { bindingForEvent } from "@/lib/commands";
import { commandsByBinding, useHotkeysStore } from "@/stores/hotkeys-store";

/**
 * Hook for managing global keyboard shortcuts in the editor page
 *
 * Handles:
 * - Ctrl+? / Cmd+? - Toggle keyboard shortcuts modal
 * - Ctrl+P / Cmd+P - Toggle command palette
 * - Ctrl+O / Cmd+O, or Ctrl+Tab - Quick switcher
 * - Ctrl+F / Cmd+F - Find in document
 * - Ctrl+Alt+F / Cmd+Alt+F - Find and replace
 *
 * Mod+K belongs to the editor's link editor, not to this hook: the editor stops that event and
 * opens the link editor, which is what the bubble menu and the shortcuts panel advertise.
 */
export function useEditorKeyboardShortcuts() {
  // Only what the Escape rule below has to read. Every other action reaches its store through
  // the command registry, at call time.
  const {
    isKeyboardShortcutsOpen,
    isCommandPaletteOpen,
    isSearchBarOpen,
    isFocusMode,
    toggleFocusMode,
    isQuickSwitcherOpen,
    setQuickSwitcherOpen,
  } = useLayoutStore();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // The editor claims a few Mod shortcuts when a text selection is live — Mod+K adds a link,
      // Mod+B/I/E apply marks — and signals that by calling `stopPropagation` and `preventDefault`.
      // Honouring `defaultPrevented` here is what stops one keystroke doing two things.
      if (e.defaultPrevented) return;

      // One registry, not a chain of conditions: every command is bindable, rebindable and
      // searchable from the same declaration.
      const binding = bindingForEvent(e);
      const command = binding
        ? commandsByBinding(useHotkeysStore.getState().overrides).get(binding)
        : undefined;
      if (command) {
        e.preventDefault();
        void command.run();
        return;
      }

      // Ctrl+Tab - the quick switcher's second binding, which is a chord the registry's
      // `Mod+Letter` shape cannot describe.
      if ((e.ctrlKey || e.metaKey) && e.key === "Tab") {
        e.preventDefault();
        setQuickSwitcherOpen(true);
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
    },
    [
      isKeyboardShortcutsOpen,
      isCommandPaletteOpen,
      isSearchBarOpen,
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
