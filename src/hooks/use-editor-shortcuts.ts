"use client";

import { useEffect } from "react";
import { useLayoutStore } from "@/stores/layout-store";

interface UseEditorShortcutsOptions {
  /** Callback when search shortcut is triggered */
  onSearchOpen?: () => void;
}

/**
 * Hook for handling editor keyboard shortcuts.
 * Supports Ctrl/Cmd + F for search and Ctrl/Cmd + Shift + O for outline toggle.
 */
export function useEditorShortcuts({ onSearchOpen }: UseEditorShortcutsOptions = {}) {
  const { toggleMindlines } = useLayoutStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;

      // Ctrl/Cmd + F: Open search
      if (isMod && e.key === "f") {
        e.preventDefault();
        onSearchOpen?.();
      }

      // Ctrl/Cmd + Shift + O: Toggle outline
      if (isMod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        toggleMindlines();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggleMindlines, onSearchOpen]);
}
