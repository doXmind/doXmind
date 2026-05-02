"use client";

import { useEffect } from "react";
import { useLayoutStore } from "@/stores/layout-store";

/**
 * Hook for handling editor keyboard shortcuts.
 * Supports Ctrl/Cmd + Shift + O to toggle the outline panel
 * (between the Notion-style minimap rail and the full outline view).
 * Note: Cmd+F is handled at page level to open command palette.
 */
export function useEditorShortcuts() {
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        toggleSidebar();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);
}
