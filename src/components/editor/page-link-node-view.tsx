"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { navigateToEditorFile } from "@/lib/editor-navigation";
import { useFileStore } from "@/stores/file-store";

const PREVIEW_DELAY_MS = 350;
const PREVIEW_WIDTH = 360;
const PREVIEW_GAP = 8;
const PREVIEW_VIEWPORT_MARGIN = 8;

/**
 * Notion-style "link to page" icon: a document with a small upward-left arrow
 * overlay at the bottom-left, indicating that this is a navigable link.
 */
function PageLinkIcon({ className }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Document outline */}
      <path
        d="M11.5 2.25H5.5C4.94772 2.25 4.5 2.69772 4.5 3.25V16.75C4.5 17.3023 4.94772 17.75 5.5 17.75H14.5C15.0523 17.75 15.5 17.3023 15.5 16.75V6.25L11.5 2.25Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* Folded corner */}
      <path
        d="M11.5 2.25V6.25H15.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* Arrow badge — rendered as a small filled circle that punches through the document, with an arrow inside */}
      <circle cx="6.5" cy="13.5" r="3.25" fill="currentColor" fillOpacity="0" />
      <path
        d="M8 12L5 15M5 15H7.25M5 15V12.75"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PageLinkNodeView({ node }: NodeViewProps) {
  const { pageId, pageTitle, pageIcon } = node.attrs;
  const currentFileId = useFileStore((s) => s.currentFileId);
  const file = useFileStore((s) => s.getFile(pageId));

  const linkRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPos, setPreviewPos] = useState<{ left: number; top: number } | null>(null);

  const displayTitle = file?.name || pageTitle || "Untitled";
  const displayIcon = pageIcon;
  const isDeleted = !file && pageId;

  const handleClick = () => {
    if (!pageId || isDeleted) return;
    if (currentFileId !== pageId) navigateToEditorFile(pageId);
  };

  const cancelHoverTimer = () => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  const handleMouseEnter = () => {
    if (isDeleted || !file) return;
    cancelHoverTimer();
    hoverTimer.current = window.setTimeout(() => {
      const rect = linkRef.current?.getBoundingClientRect();
      if (!rect) return;
      let left = rect.left;
      const top = rect.bottom + PREVIEW_GAP;
      if (left + PREVIEW_WIDTH > window.innerWidth - PREVIEW_VIEWPORT_MARGIN) {
        left = window.innerWidth - PREVIEW_VIEWPORT_MARGIN - PREVIEW_WIDTH;
      }
      if (left < PREVIEW_VIEWPORT_MARGIN) left = PREVIEW_VIEWPORT_MARGIN;
      setPreviewPos({ left, top });
      setPreviewOpen(true);
    }, PREVIEW_DELAY_MS);
  };

  const handleMouseLeave = () => {
    cancelHoverTimer();
    setPreviewOpen(false);
  };

  useEffect(() => {
    return () => {
      cancelHoverTimer();
    };
  }, []);

  const previewSnippet = (file?.preview || "").trim();

  return (
    <NodeViewWrapper data-type="page-link" contentEditable={false} className="not-prose my-1">
      <div
        ref={linkRef}
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={cn(
          // Icon sits flush at the content's left edge — matches Notion. The
          // hover background starts right at the icon (no leading padding) so
          // the link reads as a tight, content-aligned banner.
          "group flex w-full cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2",
          "transition-colors hover:bg-foreground/[0.04] dark:hover:bg-white/[0.05]",
          isDeleted && "opacity-50"
        )}
      >
        {/* Icon: emoji if user set one, otherwise the link badge */}
        <span className="flex h-6 w-6 shrink-0 items-center justify-center text-[18px] leading-none">
          {displayIcon ? (
            <span>{displayIcon}</span>
          ) : (
            <PageLinkIcon className="text-muted-foreground" />
          )}
        </span>

        {/* Title */}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.005em]",
            isDeleted ? "font-medium italic text-muted-foreground" : "text-foreground"
          )}
        >
          {isDeleted ? "Page not found" : displayTitle}
        </span>
      </div>

      {previewOpen && file && previewPos
        ? createPortal(
            <div
              role="tooltip"
              onMouseEnter={cancelHoverTimer}
              onMouseLeave={handleMouseLeave}
              style={{
                position: "fixed",
                left: previewPos.left,
                top: previewPos.top,
                width: PREVIEW_WIDTH,
                zIndex: 70,
              }}
              className={cn(
                "overflow-hidden rounded-[12px] bg-white shadow-[0_16px_40px_rgba(15,15,15,0.18)] ring-1 ring-black/5",
                "dark:bg-[#2a2a2a] dark:shadow-[0_16px_40px_rgba(0,0,0,0.6)] dark:ring-white/[0.07]",
                "animate-in fade-in-0 slide-in-from-top-1 duration-150"
              )}
            >
              <div className="px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center text-[20px] leading-none">
                    {displayIcon ? (
                      <span>{displayIcon}</span>
                    ) : (
                      <PageLinkIcon className="text-muted-foreground" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[16px] font-semibold tracking-[-0.005em]">
                    {displayTitle}
                  </span>
                </div>
                {previewSnippet ? (
                  <p className="mt-2.5 line-clamp-4 text-[13.5px] leading-[1.55] text-muted-foreground">
                    {previewSnippet}
                  </p>
                ) : (
                  <p className="mt-2.5 text-[13.5px] italic leading-[1.55] text-muted-foreground/60">
                    No content yet
                  </p>
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </NodeViewWrapper>
  );
}
