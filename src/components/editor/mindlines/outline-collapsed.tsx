"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useFileStore } from "@/stores/file-store";
import { isMarkdownFile } from "@/lib/document-types";
import type { Heading } from "./types";

interface OutlineCollapsedProps {
  headings: Heading[];
  activeId: string | null;
  onNavigate: (heading: Heading, options?: { skipFocus?: boolean }) => void;
}

// Notion-style minimap: each heading is a tiny horizontal rule. The top
// header button owns visibility, so this rail stays purely navigational.
const LEVEL_LINE_WIDTH_PX: Record<number, number> = {
  1: 22,
  2: 16,
  3: 11,
};

// Notion-style narrow outline: typography-only hierarchy (indent + weight +
// color). 16px base inset, 16px per level. No rails, no row backgrounds.
const POPOVER_BASE_LEFT_PX = 16;
const POPOVER_INDENT_PER_LEVEL_PX = 16;

const POPOVER_OPEN_DELAY_MS = 70;
const POPOVER_CLOSE_DELAY_MS = 220;

function lineWidthForLevel(level: number) {
  return LEVEL_LINE_WIDTH_PX[level] ?? 6;
}

function popoverIndentForLevel(level: number) {
  return POPOVER_BASE_LEFT_PX + (level - 1) * POPOVER_INDENT_PER_LEVEL_PX;
}

function popoverFontSizeForLevel(level: number) {
  return level === 1 ? 13.5 : 13;
}

function popoverWeightForLevel(level: number, isActive: boolean) {
  if (isActive) return 600;
  if (level === 1) return 600;
  if (level === 2) return 500;
  return 400;
}

function popoverColorClass(level: number, isActive: boolean, isHover: boolean) {
  if (isActive || isHover) return "text-foreground";
  if (level === 1) return "text-foreground";
  if (level === 2) return "text-foreground/[0.78]";
  return "text-foreground/[0.55]";
}

export function OutlineCollapsed({ headings, activeId, onNavigate }: OutlineCollapsedProps) {
  const [hoveredLineId, setHoveredLineId] = useState<string | null>(null);
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const currentFile = useFileStore((s) =>
    s.currentFileId ? s.files.find((file) => file.id === s.currentFileId) : undefined
  );
  const docTitle =
    currentFile && isMarkdownFile(currentFile)
      ? currentFile.name || "Untitled"
      : (currentFile?.name ?? "");

  const cancelOpen = useCallback(() => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const openPopoverNow = useCallback(() => {
    cancelOpen();
    cancelClose();
    setPopoverOpen(true);
  }, [cancelClose, cancelOpen]);

  const schedulePopoverOpen = useCallback(() => {
    cancelClose();
    if (popoverOpen || openTimer.current !== null) return;
    openTimer.current = window.setTimeout(() => {
      setPopoverOpen(true);
      openTimer.current = null;
    }, POPOVER_OPEN_DELAY_MS);
  }, [cancelClose, popoverOpen]);

  const schedulePopoverClose = useCallback(() => {
    cancelOpen();
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      setPopoverOpen(false);
      closeTimer.current = null;
    }, POPOVER_CLOSE_DELAY_MS);
  }, [cancelClose, cancelOpen]);

  useEffect(
    () => () => {
      cancelOpen();
      cancelClose();
    },
    [cancelClose, cancelOpen]
  );

  useEffect(() => {
    if (!popoverOpen || !activeId) return;
    const activeItem = listRef.current?.querySelector<HTMLElement>(
      `[data-outline-id="${activeId}"]`
    );
    activeItem?.scrollIntoView({ block: "nearest" });
  }, [activeId, popoverOpen]);

  if (headings.length === 0) return null;

  const compactRail = headings.length > 28;

  return (
    <div
      className="group/outline-rail relative flex h-full w-full justify-end"
      onMouseEnter={schedulePopoverOpen}
      onMouseLeave={schedulePopoverClose}
      onFocusCapture={openPopoverNow}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          schedulePopoverClose();
        }
      }}
    >
      {/* Rail — naked horizontal rules, no container chrome */}
      <div
        className={cn(
          "flex h-full flex-col items-end overflow-hidden py-1 pr-0.5 transition-opacity duration-150",
          popoverOpen
            ? "opacity-0"
            : "opacity-30 group-focus-within/outline-rail:opacity-100 group-hover/outline-rail:opacity-100"
        )}
        style={{ gap: compactRail ? 2 : 5 }}
        aria-hidden={popoverOpen}
      >
        {headings.map((heading) => {
          const isActive = heading.id === activeId;
          const isHover = hoveredLineId === heading.id;
          const w = lineWidthForLevel(heading.level);
          const opacity = isActive ? 0.9 : isHover ? 0.38 : 0.16;

          return (
            <button
              key={heading.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onNavigate(heading, { skipFocus: true });
              }}
              onMouseEnter={() => setHoveredLineId(heading.id)}
              onMouseLeave={() => setHoveredLineId(null)}
              onFocus={() => setHoveredLineId(heading.id)}
              onBlur={() => setHoveredLineId(null)}
              className="flex shrink-0 cursor-pointer items-center rounded-sm bg-transparent p-0 outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
              style={{ height: compactRail ? 8 : 12 }}
              aria-label={`Navigate to: ${heading.text || "Untitled"}`}
              aria-current={isActive ? "location" : undefined}
              tabIndex={popoverOpen ? -1 : 0}
            >
              <span
                aria-hidden="true"
                className="block rounded-[1px] bg-foreground transition-[opacity,width] duration-150"
                style={{ width: w, height: 2, opacity }}
              />
            </button>
          );
        })}
      </div>

      {popoverOpen && (
        <div
          role="dialog"
          aria-label="Document outline"
          onMouseEnter={openPopoverNow}
          onMouseLeave={schedulePopoverClose}
          className="font-brand-sans animate-in fade-in-0 zoom-in-95 absolute right-0 top-0 z-50 flex w-[240px] origin-top-right flex-col overflow-visible rounded-md border border-foreground/[0.09] bg-popover text-popover-foreground shadow-[0_1px_0_rgba(15,15,15,0.02),0_4px_16px_rgba(15,15,15,0.04)] duration-150"
        >
          {/* Header — mono eyebrow + count, then quiet doc title */}
          <div className="flex flex-col gap-2.5 border-b border-foreground/[0.09] px-[18px] pb-3.5 pt-[18px]">
            <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase leading-none tracking-[0.08em] text-foreground/[0.42]">
              <span>outline</span>
              <span className="text-foreground/[0.28]">·</span>
              <span>{headings.length}</span>
            </div>
            {docTitle && (
              <div
                className="text-[15px] font-semibold leading-[1.3] tracking-[-0.012em] text-foreground"
                style={{ textWrap: "balance" }}
              >
                {docTitle}
              </div>
            )}
          </div>

          {/* Tree — flat list, typography only (indent + weight + color) */}
          <div
            ref={listRef}
            className="autohide-scrollbar max-h-[min(640px,calc(100vh-160px))] flex-1 overflow-y-auto overflow-x-visible pb-3.5 pt-2.5"
          >
            {headings.map((heading) => {
              const isActive = heading.id === activeId;
              const isHover = heading.id === hoveredRowId;
              const indentPx = popoverIndentForLevel(heading.level);
              const fontSize = popoverFontSizeForLevel(heading.level);
              const fontWeight = popoverWeightForLevel(heading.level, isActive);
              return (
                <div
                  key={heading.id}
                  className="relative"
                  onMouseEnter={() => setHoveredRowId(heading.id)}
                  onMouseLeave={() =>
                    setHoveredRowId((prev) => (prev === heading.id ? null : prev))
                  }
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigate(heading, { skipFocus: true });
                    }}
                    onFocus={() => setHoveredRowId(heading.id)}
                    onBlur={() => setHoveredRowId((prev) => (prev === heading.id ? null : prev))}
                    className={cn(
                      "flex min-h-[26px] w-full cursor-pointer items-center py-[5px] pr-3 text-left leading-[1.4] tracking-[-0.005em] transition-colors duration-150",
                      popoverColorClass(heading.level, isActive, isHover)
                    )}
                    style={{ paddingLeft: indentPx, fontSize, fontWeight }}
                    data-outline-id={heading.id}
                    aria-current={isActive ? "location" : undefined}
                  >
                    <span className="min-w-0 flex-1 truncate">{heading.text || "Untitled"}</span>
                  </button>
                  {isHover && (
                    <span
                      aria-hidden="true"
                      className="font-brand-sans pointer-events-none absolute right-full top-1/2 z-10 -translate-y-1/2 whitespace-nowrap rounded-md border border-foreground/[0.10] bg-popover px-2.5 py-1 text-[12px] font-medium text-foreground shadow-[0_1px_2px_rgba(15,15,15,0.04),0_4px_12px_rgba(15,15,15,0.06)]"
                      style={{ marginRight: 8 }}
                    >
                      {heading.text || "Untitled"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
