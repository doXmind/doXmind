"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { Heading } from "./types";
import { findActiveByPosition } from "./active-resolver";
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

  // Scroll-spy: probe a single viewport coordinate with `editor.view.posAtCoords`,
  // then resolve the active heading via binary search over the canonical list.
  // Cost per scroll: O(1) coord probe + O(log N) resolution, RAF-coalesced.
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  useEffect(() => {
    if (!editor || headings.length === 0) {
      setActiveId(null);
      return;
    }

    const scrollParent = getEditorScrollParent(editor);
    let rafId: number | null = null;

    const resolveActive = () => {
      rafId = null;
      const containerRect = scrollParent.getBoundingClientRect();
      const top = containerRect.top + containerRect.height * SCROLLSPY_THRESHOLD;
      const left = containerRect.left + containerRect.width / 2;

      let probePos: number | null = null;
      try {
        const result = editor.view.posAtCoords({ left, top });
        probePos = result?.pos ?? null;
      } catch {
        probePos = null;
      }

      const nextActiveId = findActiveByPosition(headings, probePos, activeIdRef.current);
      setActiveId((prev) => (prev === nextActiveId ? prev : nextActiveId));
    };

    const handleScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(resolveActive);
    };

    scrollParent.addEventListener("scroll", handleScroll, { passive: true });

    // Initial check for pre-scrolled state
    resolveActive();

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
