"use client";

import { useEffect } from "react";

// doXmind is a desktop app, not a web page: the WebView's default context menu
// (Reload / Back / Forward) doesn't belong here and is actively harmful —
// Reload drops unsaved transient UI state, Back/Forward walk the history stack
// into routes the app never designed for re-entry.
//
// Custom menus (sidebar and Page surfaces) already preventDefault per-area.
// This is the global fallback for everywhere else, with two escape
// clauses so it never fights those menus or strips useful native ones:
//
//   1. defaultPrevented — an inner custom menu already handled this event.
//      Some (e.g. the Page editor) preventDefault without stopPropagation, so
//      their event still reaches document; bailing here lets them win.
//   2. text-input targets — real inputs / contenteditable surfaces (Page
//      source Blocks and rename fields) keep the native
//      Cut/Copy/Paste/spellcheck menu, which is genuinely useful there.
export function ContextMenuGuard() {
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  return null;
}
