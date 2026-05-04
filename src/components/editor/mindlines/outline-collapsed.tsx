"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Heading } from "./types";

interface OutlineCollapsedProps {
  headings: Heading[];
  activeId: string | null;
  onNavigate: (heading: Heading, options?: { skipFocus?: boolean }) => void;
}

const LEVEL_LINE_WIDTH_PX: Record<number, number> = {
  1: 22,
  2: 16,
  3: 11,
};

const POPOVER_BASE_LEFT_PX = 14;
const POPOVER_INDENT_PER_LEVEL_PX = 16;
const POPOVER_OPEN_DELAY_MS = 120;
const POPOVER_CLOSE_DELAY_MS = 180;
const POPOVER_WIDTH_PX = 260;

// ease-out-expo: fast start, smooth tail — Notion's "settle" feel.
const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];
// ease-in: slow start, fast end — "pulled away" feel for exit.
const EASE_IN: [number, number, number, number] = [0.7, 0, 0.84, 0];

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

function popoverColorClass(level: number, isActive: boolean) {
  if (isActive) return "text-foreground";
  if (level === 1) return "text-foreground";
  if (level === 2) return "text-foreground/[0.78]";
  return "text-foreground/[0.55]";
}

export function OutlineCollapsed({ headings, activeId, onNavigate }: OutlineCollapsedProps) {
  const [hoveredLineId, setHoveredLineId] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  // Tracks whether cursor is inside the wrapper hover zone. Flips synchronously
  // on mouseEnter/Leave so the wrapper can pre-expand to popover width before
  // the open delay elapses — otherwise the cursor leaves the narrow rail area
  // mid-transit and the open is cancelled.
  const [isHoverZone, setIsHoverZone] = useState(false);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

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
    setIsHoverZone(true);
    setPopoverOpen(true);
  }, [cancelClose, cancelOpen]);

  const schedulePopoverOpen = useCallback(() => {
    cancelClose();
    setIsHoverZone(true);
    if (popoverOpen || openTimer.current !== null) return;
    openTimer.current = window.setTimeout(() => {
      setPopoverOpen(true);
      openTimer.current = null;
    }, POPOVER_OPEN_DELAY_MS);
  }, [cancelClose, popoverOpen]);

  const schedulePopoverClose = useCallback(() => {
    cancelOpen();
    cancelClose();
    setIsHoverZone(false);
    closeTimer.current = window.setTimeout(() => {
      setPopoverOpen(false);
      closeTimer.current = null;
    }, POPOVER_CLOSE_DELAY_MS);
  }, [cancelClose, cancelOpen]);

  const closePopoverImmediate = useCallback(() => {
    cancelOpen();
    cancelClose();
    setIsHoverZone(false);
    setPopoverOpen(false);
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
  const expanded = isHoverZone || popoverOpen;

  const handleNavigate = (heading: Heading) => {
    onNavigate(heading, { skipFocus: true });
    closePopoverImmediate();
  };

  return (
    // Anchor to the parent column's right edge with `absolute right-0` so
    // the wrapper grows leftward when it expands to the popover width —
    // otherwise a normal-flow width change would push the popover off the
    // right side of the viewport (the parent column is only 40 px wide and
    // already inset against the window edge).
    <div
      className="group/outline-rail absolute right-0 top-0 flex h-full justify-end transition-[width] duration-100 ease-out"
      style={{ width: expanded ? POPOVER_WIDTH_PX : "100%" }}
      onMouseEnter={schedulePopoverOpen}
      onMouseLeave={schedulePopoverClose}
      onFocusCapture={openPopoverNow}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          schedulePopoverClose();
        }
      }}
    >
      {/* Rail — naked horizontal rules, fades to 0 when popover takes over */}
      <div
        className={cn(
          "flex h-full flex-col items-end overflow-hidden py-1 pr-0.5 transition-opacity duration-150",
          popoverOpen
            ? "opacity-0"
            : "opacity-[0.14] group-focus-within/outline-rail:opacity-[0.85] group-hover/outline-rail:opacity-[0.85]"
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
                handleNavigate(heading);
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

      <AnimatePresence>
        {popoverOpen && (
          <motion.div
            key="outline-popover"
            role="dialog"
            aria-label="Document outline"
            onMouseEnter={openPopoverNow}
            onMouseLeave={schedulePopoverClose}
            initial={{ opacity: 0, y: -4 }}
            animate={{
              opacity: 1,
              y: 0,
              transition: { duration: 0.15, ease: EASE_OUT_EXPO },
            }}
            exit={{
              opacity: 0,
              y: -2,
              transition: { duration: 0.1, ease: EASE_IN },
            }}
            className="font-brand-sans absolute right-0 top-0 z-50 flex flex-col rounded-md border border-foreground/[0.09] bg-popover text-popover-foreground shadow-[0_1px_0_rgba(15,15,15,0.02),0_4px_16px_rgba(15,15,15,0.04)]"
            style={{ width: POPOVER_WIDTH_PX }}
          >
            <div
              ref={listRef}
              className="autohide-scrollbar max-h-[min(640px,calc(100vh-160px))] flex-1 overflow-y-auto py-2"
            >
              {headings.map((heading) => {
                const isActive = heading.id === activeId;
                const indentPx = popoverIndentForLevel(heading.level);
                const fontSize = popoverFontSizeForLevel(heading.level);
                const fontWeight = popoverWeightForLevel(heading.level, isActive);
                return (
                  <button
                    key={heading.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleNavigate(heading);
                    }}
                    className={cn(
                      "mx-1.5 flex min-h-[28px] cursor-pointer items-center rounded py-[5px] pr-3 text-left leading-[1.4] tracking-[-0.005em] transition-colors duration-100 hover:bg-foreground/[0.045]",
                      "w-[calc(100%-12px)]",
                      popoverColorClass(heading.level, isActive),
                      isActive && "bg-foreground/[0.04]"
                    )}
                    style={{ paddingLeft: indentPx, fontSize, fontWeight }}
                    data-outline-id={heading.id}
                    aria-current={isActive ? "location" : undefined}
                    title={heading.text || "Untitled"}
                  >
                    <span className="min-w-0 flex-1 truncate">{heading.text || "Untitled"}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
