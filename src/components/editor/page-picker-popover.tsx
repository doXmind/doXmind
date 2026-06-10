"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText } from "lucide-react";
import { useEditorStore } from "@/stores/editor-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useFileStore } from "@/stores/file-store";
import { cn } from "@/lib/utils";

const POPOVER_WIDTH = 320;
const POPOVER_MAX_HEIGHT = 320;
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

/**
 * Notion-style page picker. The user keeps typing in the editor (where the
 * slash command was) and this popover is just the floating list of pages
 * filtered by what they've typed since the picker opened. There is no separate
 * search input — the editor's own placeholder switches to "Search for a
 * page..." (see editor.css `body[data-page-picker-open="true"]` rule).
 */
export function PagePickerPopover() {
  const { pagePickerOpen, pagePickerCallback, pagePickerAnchor, closePagePicker } =
    useEditorStore();
  const editor = useEditorRefStore((s) => s.editor);
  const files = useFileStore((s) => s.files);
  const currentFileId = useFileStore((s) => s.currentFileId);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Position in the doc where the user's "search query" begins. Captured when
  // the picker opens; everything typed after this position is the live query.
  const startPosRef = useRef<number | null>(null);

  const filteredPages = useMemo(() => {
    const pages = Object.values(files).filter((f) => !f.isFolder && f.id !== currentFileId);
    if (!query.trim()) return pages;
    const q = query.toLowerCase();
    return pages.filter((f) => (f.name || "").toLowerCase().includes(q));
  }, [files, query, currentFileId]);

  const handleClose = () => {
    setQuery("");
    setActiveIndex(0);
    startPosRef.current = null;
    closePagePicker();
  };

  const handleSelect = (file: (typeof filteredPages)[number]) => {
    const startPos = startPosRef.current;
    // Strip any text the user typed as the search query first, so when the
    // callback inserts the page link the cursor is at the original slash
    // position with no stray search text in front of it.
    if (editor && startPos !== null) {
      const currentPos = editor.state.selection.from;
      if (currentPos > startPos) {
        editor.chain().focus().deleteRange({ from: startPos, to: currentPos }).run();
      }
    }
    pagePickerCallback?.({
      pageId: file.id,
      pageTitle: file.name,
      pageIcon: null,
    });
    handleClose();
  };

  // On open, snapshot the cursor position so we can read everything typed
  // after it as the live query.
  useEffect(() => {
    if (pagePickerOpen && editor) {
      startPosRef.current = editor.state.selection.from;
      setQuery("");
      setActiveIndex(0);
    }
  }, [pagePickerOpen, editor]);

  // Reset active index whenever the query changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Subscribe to editor changes to track the live query.
  useEffect(() => {
    if (!pagePickerOpen || !editor) return;
    const update = () => {
      const startPos = startPosRef.current;
      if (startPos === null) return;
      const currentPos = editor.state.selection.from;
      // If the user backspaces past the start of the query, close the picker.
      if (currentPos < startPos) {
        handleClose();
        return;
      }
      const text = editor.state.doc.textBetween(startPos, currentPos, "\n", " ");
      // A newline in the query means the user pressed Enter without selecting;
      // bail out gracefully rather than capturing a multi-line query.
      if (text.includes("\n")) {
        handleClose();
        return;
      }
      setQuery(text);
    };
    editor.on("update", update);
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("update", update);
      editor.off("selectionUpdate", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagePickerOpen, editor]);

  // Position the popover relative to the anchor (or center as fallback).
  useLayoutEffect(() => {
    if (!pagePickerOpen) return;
    const measure = () => {
      const anchor = pagePickerAnchor;
      const w = POPOVER_WIDTH;
      const node = containerRef.current;
      const measuredHeight = node?.offsetHeight ?? POPOVER_MAX_HEIGHT;
      const h = Math.min(measuredHeight, POPOVER_MAX_HEIGHT);

      if (!anchor) {
        setPosition({
          left: Math.max(VIEWPORT_MARGIN, (window.innerWidth - w) / 2),
          top: Math.max(VIEWPORT_MARGIN, (window.innerHeight - h) / 2),
        });
        return;
      }

      let left = anchor.x;
      let top = anchor.y + anchor.height + ANCHOR_GAP;

      if (top + h > window.innerHeight - VIEWPORT_MARGIN) {
        const above = anchor.y - ANCHOR_GAP - h;
        if (above >= VIEWPORT_MARGIN) {
          top = above;
        } else {
          top = Math.max(VIEWPORT_MARGIN, window.innerHeight - VIEWPORT_MARGIN - h);
        }
      }

      if (left + w > window.innerWidth - VIEWPORT_MARGIN) {
        left = window.innerWidth - VIEWPORT_MARGIN - w;
      }
      if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;

      setPosition({ left, top });
    };

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [pagePickerOpen, pagePickerAnchor, filteredPages.length]);

  // Toggle the body attribute that switches the editor's placeholder text
  // (see editor.css).
  useEffect(() => {
    if (!pagePickerOpen) return;
    document.body.setAttribute("data-page-picker-open", "true");
    return () => document.body.removeAttribute("data-page-picker-open");
  }, [pagePickerOpen]);

  // Click-outside to close.
  useEffect(() => {
    if (!pagePickerOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        // Don't close if the click landed inside the editor — the user is
        // just continuing to type their search query there.
        const editorEl = editor?.view.dom;
        if (editorEl && editorEl.contains(e.target as Node)) return;
        handleClose();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagePickerOpen, editor]);

  // Capture-phase keydown so we intercept arrow / Enter / Escape before the
  // editor handles them. Letters and other typing keys flow through unchanged.
  useEffect(() => {
    if (!pagePickerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        if (filteredPages.length === 0) return;
        setActiveIndex((i) => (i + 1) % filteredPages.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        if (filteredPages.length === 0) return;
        setActiveIndex((i) => (i - 1 + filteredPages.length) % filteredPages.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const file = filteredPages[activeIndex];
        if (file) handleSelect(file);
        return;
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagePickerOpen, activeIndex, filteredPages]);

  // Keep active item visible when navigating with arrows.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-page-idx="${activeIndex}"]`);
    if (el) {
      const top = el.offsetTop;
      const bottom = top + el.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight)
        list.scrollTop = bottom - list.clientHeight;
    }
  }, [activeIndex]);

  if (!pagePickerOpen) return null;

  const style: React.CSSProperties = position
    ? { left: position.left, top: position.top, visibility: "visible" }
    : { left: -9999, top: -9999, visibility: "hidden" };

  return createPortal(
    <div
      ref={containerRef}
      role="listbox"
      style={{ position: "fixed", width: POPOVER_WIDTH, zIndex: 60, ...style }}
      className={cn(
        "overflow-hidden rounded-[10px] bg-white shadow-[0_8px_24px_rgba(15,15,15,0.12)] ring-1 ring-black/5",
        "dark:bg-[#2f2f2f] dark:shadow-[0_8px_24px_rgba(0,0,0,0.5)] dark:ring-white/[0.06]"
      )}
    >
      <div ref={listRef} className="max-h-[280px] overflow-y-auto px-1.5 py-1.5">
        <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-[#9b9a97] dark:text-[#8b8a87]">
          {query ? "Results" : "Select a page"}
        </div>
        {filteredPages.length === 0 ? (
          <div className="px-3 py-6 text-center text-[13px] text-[#9b9a97] dark:text-[#8b8a87]">
            {query ? "No pages match your search" : "No pages available"}
          </div>
        ) : (
          filteredPages.map((file, idx) => (
            <button
              key={file.id}
              type="button"
              data-page-idx={idx}
              onMouseDown={(e) => {
                // Prevent the mousedown from blurring the editor before our
                // click runs.
                e.preventDefault();
              }}
              onClick={() => handleSelect(file)}
              onMouseEnter={() => setActiveIndex(idx)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left text-[14px]",
                "text-[#37352f] dark:text-[#e8e8e6]",
                idx === activeIndex
                  ? "bg-[#e9e9e7] dark:bg-[#3f3f3f]"
                  : "hover:bg-[#f1f1ef] dark:hover:bg-[#373737]"
              )}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center text-base">
                <FileText className="h-4 w-4 text-[#9b9a97] dark:text-[#8b8a87]" />
              </span>
              <span className="min-w-0 flex-1 truncate">{file.name || "Untitled"}</span>
            </button>
          ))
        )}
      </div>
    </div>,
    document.body
  );
}
