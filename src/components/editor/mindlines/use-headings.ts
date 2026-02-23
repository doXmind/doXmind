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

    // On mobile, prefer data-mobile-scroll container (getScrollParent is unreliable there)
    const mobileScroll = document.querySelector<HTMLElement>("[data-mobile-scroll]");
    const scrollParent = mobileScroll || getScrollParent(editor.view.dom as HTMLElement);
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
  // Uses manual scroll calculation instead of scrollIntoView for reliable
  // positioning across different layouts (editor, shared pages, community pages)
  const navigateTo = useCallback(
    (heading: Heading, options?: { skipFocus?: boolean }) => {
      if (!editor) return;

      if (editor.isEditable) {
        if (options?.skipFocus) {
          // Set selection without focus to avoid triggering mobile keyboard
          editor.commands.setTextSelection(heading.pos);
        } else {
          editor.chain().focus().setTextSelection(heading.pos).run();
        }
      }

      try {
        const dom = editor.view.nodeDOM(heading.pos);
        const element = dom instanceof HTMLElement ? dom : null;
        if (!element) return;

        // On mobile, prefer the data-mobile-scroll container (more reliable)
        const mobileScroll = document.querySelector<HTMLElement>("[data-mobile-scroll]");
        const scrollParent = mobileScroll || getScrollParent(editor.view.dom as HTMLElement);
        const elementRect = element.getBoundingClientRect();
        const containerRect = scrollParent.getBoundingClientRect();
        const relativeTop = elementRect.top - containerRect.top;
        const targetScrollTop = scrollParent.scrollTop + relativeTop - 80;

        scrollParent.scrollTo({
          top: Math.max(0, targetScrollTop),
          behavior: "smooth",
        });
      } catch {
        // Silently fail if coordinates can't be determined
      }
    },
    [editor]
  );

  return { headings, activeId, navigateTo };
}
