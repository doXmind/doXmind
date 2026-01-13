"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import type { Heading } from "./types";
import { findActiveHeading } from "./utils/heading-utils";

/**
 * Hook to extract and track headings from a TipTap editor
 * Provides headings array, active heading ID, and navigation function
 */
export function useHeadings(editor: Editor | null) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Track if user has interacted with editor (clicked/selected)
  const hasInteractedRef = useRef(false);

  // Extract headings from editor content
  useEffect(() => {
    if (!editor) return;

    const updateHeadings = () => {
      const found: Heading[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading" && node.attrs.level <= 3) {
          found.push({
            id: `h-${pos}`,
            level: node.attrs.level,
            text: node.textContent || "Untitled",
            pos,
          });
        }
      });
      setHeadings(found);
    };

    updateHeadings();
    editor.on("update", updateHeadings);
    return () => {
      editor.off("update", updateHeadings);
    };
  }, [editor]);

  // Track cursor position to highlight active heading
  // Uses binary search for better performance on large documents
  // Default to first heading until user focuses the editor
  useEffect(() => {
    if (!editor || headings.length === 0) return;

    // Set initial active to first heading
    setActiveId(headings[0]?.id ?? null);

    const onFocus = () => {
      hasInteractedRef.current = true;
    };

    const trackPosition = () => {
      // Only track position after user has focused the editor
      if (!hasInteractedRef.current) return;
      const { from } = editor.state.selection;
      const active = findActiveHeading(headings, from);
      // Default to first heading if cursor is before all headings
      setActiveId(active?.id ?? headings[0]?.id ?? null);
    };

    editor.on("focus", onFocus);
    editor.on("selectionUpdate", trackPosition);
    return () => {
      editor.off("focus", onFocus);
      editor.off("selectionUpdate", trackPosition);
    };
  }, [editor, headings]);

  // Navigate to a specific heading
  const navigateTo = useCallback(
    (heading: Heading) => {
      if (!editor) return;

      // Set cursor position
      editor.chain().focus().setTextSelection(heading.pos).run();

      // Get the heading DOM element using nodeDOM which returns the actual node element
      const dom = editor.view.nodeDOM(heading.pos);
      const element = dom instanceof HTMLElement ? dom : null;

      if (element) {
        element.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    },
    [editor]
  );

  return { headings, activeId, navigateTo };
}
