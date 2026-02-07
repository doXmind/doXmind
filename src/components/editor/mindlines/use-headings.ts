"use client";

import { useState, useEffect, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import type { Heading } from "./types";
import { getScrollParent } from "./utils/heading-utils";

/** Scroll-spy threshold: fraction of viewport height from top */
const SCROLLSPY_THRESHOLD = 0.2;

/**
 * Hook to extract and track headings from a TipTap editor
 * Provides headings array, active heading ID (scroll-spy), and navigation function
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

  // Scroll-spy: track active heading based on scroll position
  // Finds the last heading whose top is above the threshold line (top ~20% of viewport)
  useEffect(() => {
    if (!editor || headings.length === 0) return;

    const scrollParent = getScrollParent(editor.view.dom as HTMLElement);
    let rafId: number | null = null;

    const findTopHeading = () => {
      rafId = null;
      const containerRect = scrollParent.getBoundingClientRect();
      const threshold = containerRect.top + containerRect.height * SCROLLSPY_THRESHOLD;

      let best: Heading | null = null;
      for (const heading of headings) {
        try {
          const dom = editor.view.nodeDOM(heading.pos);
          if (!(dom instanceof HTMLElement)) continue;
          if (dom.getBoundingClientRect().top <= threshold) {
            best = heading;
          } else {
            break; // Headings are in document order
          }
        } catch {
          // nodeDOM may throw if pos is stale during a transaction
          continue;
        }
      }

      setActiveId(best?.id ?? headings[0]?.id ?? null);
    };

    const handleScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(findTopHeading);
    };

    scrollParent.addEventListener("scroll", handleScroll, { passive: true });

    // Initial check for pre-scrolled state
    findTopHeading();

    return () => {
      scrollParent.removeEventListener("scroll", handleScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
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
