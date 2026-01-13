"use client";

import { useState, useEffect, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import type { Heading } from "./types";

/**
 * Hook to extract and track headings from a TipTap editor
 * Provides headings array, active heading ID, and navigation function
 */
export function useHeadings(editor: Editor | null) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

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
  useEffect(() => {
    if (!editor || headings.length === 0) return;

    const trackPosition = () => {
      const { from } = editor.state.selection;
      let active: Heading | null = null;

      for (let i = headings.length - 1; i >= 0; i--) {
        if (headings[i].pos <= from) {
          active = headings[i];
          break;
        }
      }
      setActiveId(active?.id ?? null);
    };

    trackPosition();
    editor.on("selectionUpdate", trackPosition);
    return () => {
      editor.off("selectionUpdate", trackPosition);
    };
  }, [editor, headings]);

  // Navigate to a specific heading
  const navigateTo = useCallback(
    (heading: Heading) => {
      if (!editor) return;
      editor.chain().focus().setTextSelection(heading.pos).scrollIntoView().run();
    },
    [editor]
  );

  return { headings, activeId, navigateTo };
}
