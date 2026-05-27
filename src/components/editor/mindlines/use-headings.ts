"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { Heading } from "./types";
import { useCanonicalOutline } from "./use-canonical-outline";
import { getScrollParent } from "./utils/heading-utils";

/** Scroll-spy threshold: fraction of viewport height from top */
const SCROLLSPY_THRESHOLD = 0.2;
const OUTLINE_MAX_LEVEL = 3;
const MIN_OUTLINE_HEADINGS = 2;

function getEditorScrollParent(editor: Editor) {
  const editorDom = editor.view.dom as HTMLElement;
  return (
    editorDom.closest<HTMLElement>("[data-editor-scroll], [data-mobile-scroll]") ||
    getScrollParent(editorDom)
  );
}

/**
 * Hook to extract and track headings from a TipTap editor
 * Provides headings array, active heading ID (scroll-spy), and navigation function
 */
export function useHeadings(editor: Editor | null) {
  const { headings: canonical } = useCanonicalOutline(editor);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Sidebar shows level ≤ 3 only; the canonical source carries levels 1–6.
  const headings = useMemo<Heading[]>(() => {
    const filtered = canonical.filter((heading) => heading.level <= OUTLINE_MAX_LEVEL);
    return filtered.length >= MIN_OUTLINE_HEADINGS ? filtered : [];
  }, [canonical]);

  // Scroll-spy: track active heading based on scroll position
  // Finds the last heading whose top is above the threshold line (top ~20% of viewport)
  useEffect(() => {
    if (!editor || headings.length === 0) {
      setActiveId(null);
      return;
    }

    const scrollParent = getEditorScrollParent(editor);
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

      const nextActiveId = best?.id ?? headings[0]?.id ?? null;
      setActiveId((prev) => (prev === nextActiveId ? prev : nextActiveId));
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
  // positioning across different layouts (editor and presentation surfaces)
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

        const scrollParent = getEditorScrollParent(editor);
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
