"use client";

import { useEffect } from "react";
import { useLayoutStore } from "@/stores/layout-store";

/**
 * Hook for handling editor keyboard shortcuts.
 * Supports Ctrl/Cmd + Shift + O for outline toggle.
 * Note: Cmd+F is handled at page level to open command palette.
 */
export function useEditorShortcuts() {
  const { toggleMindlines } = useLayoutStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;

      // Ctrl/Cmd + Shift + O: Toggle outline
      if (isMod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        toggleMindlines();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggleMindlines]);
}
