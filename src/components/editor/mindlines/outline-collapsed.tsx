"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import {
  isPointInOutlineSafeArea,
  projectLeftAnchoredPopoverRect,
  rectFromDomRect,
  type HoverRect,
} from "./hover-intent";
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
// Hover-intent delays. `OPEN = 0` makes the popover feel instant on hover —
// we previously had 120ms of "primed" buffer to filter incidental cursor
// passes, but on a real document users perceive that as outline lag and the
// safe-area pointer logic already prevents flicker. Close delay is kept
// short (60ms) as a small buffer when the cursor crosses the gap between
// rail and popover, before the safe-area check kicks in.
const POPOVER_OPEN_DELAY_MS = 0;
const POPOVER_CLOSE_DELAY_MS = 60;
const POPOVER_WIDTH_PX = 260;
const POPOVER_MAX_HEIGHT_PX = 640;
const POPOVER_VERTICAL_VIEWPORT_GUTTER_PX = 160;
const POPOVER_ROW_ESTIMATE_PX = 28;
const POPOVER_VERTICAL_PADDING_PX = 16;
const POPOVER_ROW_OVERSCAN = 6;
const HOVER_SAFE_AREA_PADDING_PX = 10;

// ease-out-expo: fast start, smooth tail — Notion's "settle" feel.
const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];
// ease-in: slow start, fast end — "pulled away" feel for exit.
const EASE_IN: [number, number, number, number] = [0.7, 0, 0.84, 0];

type InteractionPhase = "idle" | "primed" | "open" | "closing";

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
  const [phase, setPhase] = useState<InteractionPhase>("idle");
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLElement>(null);
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
    setPhase("open");
  }, [cancelClose, cancelOpen]);

  const schedulePopoverOpen = useCallback(() => {
    cancelClose();
    if (POPOVER_OPEN_DELAY_MS <= 0) {
      cancelOpen();
      setPhase("open");
      return;
    }
    setPhase((currentPhase) =>
      currentPhase === "open" || currentPhase === "closing" ? "open" : "primed"
    );
    if (openTimer.current !== null) return;
    openTimer.current = window.setTimeout(() => {
      setPhase("open");
      openTimer.current = null;
    }, POPOVER_OPEN_DELAY_MS);
  }, [cancelClose, cancelOpen]);

  const schedulePopoverClose = useCallback(() => {
    cancelOpen();
    cancelClose();
    setPhase((currentPhase) => (currentPhase === "idle" ? "idle" : "closing"));
    closeTimer.current = window.setTimeout(() => {
      setPhase("idle");
      closeTimer.current = null;
    }, POPOVER_CLOSE_DELAY_MS);
  }, [cancelClose, cancelOpen]);

  const closePopoverImmediate = useCallback(() => {
    cancelOpen();
    cancelClose();
    setPhase("idle");
  }, [cancelClose, cancelOpen]);

  const estimatedPopoverHeight = useCallback(() => {
    const viewportHeight =
      typeof window === "undefined" ? POPOVER_MAX_HEIGHT_PX : window.innerHeight;
    return Math.min(
      POPOVER_MAX_HEIGHT_PX,
      Math.max(POPOVER_ROW_ESTIMATE_PX, viewportHeight - POPOVER_VERTICAL_VIEWPORT_GUTTER_PX),
      headings.length * POPOVER_ROW_ESTIMATE_PX + POPOVER_VERTICAL_PADDING_PX
    );
  }, [headings.length]);

  const getHoverRects = useCallback((): {
    triggerRect: HoverRect;
    popoverRect: HoverRect;
  } | null => {
    const railElement = railRef.current;
    if (!railElement) return null;

    const triggerRect = rectFromDomRect(railElement.getBoundingClientRect());
    const popoverElement = popoverRef.current;
    const popoverRect = popoverElement
      ? rectFromDomRect(popoverElement.getBoundingClientRect())
      : projectLeftAnchoredPopoverRect(triggerRect, POPOVER_WIDTH_PX, estimatedPopoverHeight());

    return { triggerRect, popoverRect };
  }, [estimatedPopoverHeight]);

  const isPointerInSafeArea = useCallback(
    (point: { x: number; y: number }) => {
      const rects = getHoverRects();
      if (!rects) return false;
      return isPointInOutlineSafeArea({
        point,
        ...rects,
        padding: HOVER_SAFE_AREA_PADDING_PX,
      });
    },
    [getHoverRects]
  );

  const handlePointerExit = useCallback(
    (event: { clientX: number; clientY: number }) => {
      if (isPointerInSafeArea({ x: event.clientX, y: event.clientY })) {
        cancelClose();
        return;
      }
      if (phase === "primed") {
        closePopoverImmediate();
        return;
      }
      schedulePopoverClose();
    },
    [cancelClose, closePopoverImmediate, isPointerInSafeArea, phase, schedulePopoverClose]
  );

  useEffect(
    () => () => {
      cancelOpen();
      cancelClose();
    },
    [cancelClose, cancelOpen]
  );

  useEffect(() => {
    if (phase === "idle") return;

    const handlePointerMove = (event: PointerEvent) => {
      const isSafe = isPointerInSafeArea({ x: event.clientX, y: event.clientY });
      if (isSafe) {
        cancelClose();
        setPhase((currentPhase) => (currentPhase === "closing" ? "open" : currentPhase));
        return;
      }

      if (phase === "primed") {
        closePopoverImmediate();
        return;
      }
      if (phase === "open") {
        schedulePopoverClose();
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [cancelClose, closePopoverImmediate, isPointerInSafeArea, phase, schedulePopoverClose]);

  const compactRail = headings.length > 28;
  const popoverMounted = phase === "open" || phase === "closing";

  // Virtualize the popover rows so a 1k-heading outline mounts only what's
  // visible (plus a small overscan), keeping pointer-move + scroll cheap.
  // The estimate matches the row's `min-h-[28px]` so initial layout doesn't
  // jump when real heights settle in.
  const rowVirtualizer = useVirtualizer({
    count: headings.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => POPOVER_ROW_ESTIMATE_PX,
    overscan: POPOVER_ROW_OVERSCAN,
  });

  const activeIndex = useMemo(() => {
    if (!activeId) return -1;
    return headings.findIndex((h) => h.id === activeId);
  }, [activeId, headings]);

  // One-shot scroll-to-active when the popover transitions from closed to
  // open. We use an index-based call into the virtualizer rather than
  // `Element.scrollIntoView` so the row need not be in the DOM yet — the
  // virtualizer scrolls the viewport, then the windowed range catches up
  // and renders the active row in place. The transition is detected by an
  // effect comparing prev/current `popoverMounted`; firing inside an
  // effect keeps render-phase pure.
  const activeIndexRef = useRef(activeIndex);
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);
  const prevPopoverMountedRef = useRef(false);
  useEffect(() => {
    const wasOpen = prevPopoverMountedRef.current;
    prevPopoverMountedRef.current = popoverMounted;
    if (!popoverMounted || wasOpen) return;
    const target = activeIndexRef.current;
    if (target < 0) return;
    rowVirtualizer.scrollToIndex(target, { align: "center", behavior: "auto" });
  }, [popoverMounted, rowVirtualizer]);

  if (headings.length === 0) return null;

  const handleNavigate = (heading: Heading) => {
    onNavigate(heading, { skipFocus: true });
    closePopoverImmediate();
  };

  return (
    <div
      data-testid="outline-rail-root"
      className="group/outline-rail pointer-events-auto absolute right-0 top-0 flex h-full justify-end"
      style={{
        width: "100%",
      }}
      onMouseEnter={schedulePopoverOpen}
      onMouseLeave={handlePointerExit}
      onPointerEnter={schedulePopoverOpen}
      onPointerLeave={handlePointerExit}
      onFocusCapture={openPopoverNow}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          schedulePopoverClose();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closePopoverImmediate();
        }
      }}
    >
      <div
        aria-hidden="true"
        data-testid="outline-rail-hover-sensor"
        className="pointer-events-auto absolute inset-y-0 right-0 z-10 w-full"
        onClick={openPopoverNow}
        onMouseEnter={schedulePopoverOpen}
        onMouseLeave={handlePointerExit}
        onPointerEnter={schedulePopoverOpen}
        onPointerLeave={handlePointerExit}
      />

      {/* Rail — naked horizontal rules, fades to 0 when popover takes over */}
      <div
        ref={railRef}
        data-testid="outline-rail-trigger"
        onMouseEnter={schedulePopoverOpen}
        onMouseLeave={handlePointerExit}
        onPointerEnter={schedulePopoverOpen}
        onPointerLeave={handlePointerExit}
        className={cn(
          "pointer-events-none flex h-full flex-col items-end overflow-hidden py-1 pr-0.5 transition-opacity duration-150",
          popoverMounted
            ? "opacity-0 duration-100"
            : "opacity-[0.14] group-focus-within/outline-rail:opacity-[0.85] group-hover/outline-rail:opacity-[0.85]"
        )}
        style={{ gap: compactRail ? 2 : 5, width: "100%" }}
        aria-hidden={popoverMounted}
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
              onMouseEnter={() => {
                setHoveredLineId(heading.id);
                schedulePopoverOpen();
              }}
              onMouseLeave={() => setHoveredLineId(null)}
              onPointerEnter={schedulePopoverOpen}
              onFocus={() => setHoveredLineId(heading.id)}
              onBlur={() => setHoveredLineId(null)}
              className="flex shrink-0 cursor-pointer items-center rounded-sm bg-transparent p-0 outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
              style={{ height: compactRail ? 8 : 12 }}
              aria-label={`Navigate to: ${heading.text || "Untitled"}`}
              aria-current={isActive ? "location" : undefined}
              tabIndex={popoverMounted ? -1 : 0}
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
        {popoverMounted && (
          <motion.nav
            ref={popoverRef}
            key="outline-popover"
            role="navigation"
            aria-label="Document outline"
            onMouseEnter={openPopoverNow}
            onMouseLeave={handlePointerExit}
            onPointerEnter={openPopoverNow}
            onPointerLeave={handlePointerExit}
            initial={{ opacity: 0, x: 4, scale: 0.985 }}
            animate={{
              opacity: 1,
              x: 0,
              scale: 1,
              transition: { duration: 0.14, ease: EASE_OUT_EXPO },
            }}
            exit={{
              opacity: 0,
              x: 3,
              scale: 0.99,
              transition: { duration: 0.1, ease: EASE_IN },
            }}
            className="font-brand-sans pointer-events-auto absolute right-0 top-0 z-50 flex origin-right flex-col rounded-md border border-foreground/[0.09] bg-popover text-popover-foreground shadow-[0_1px_0_rgba(15,15,15,0.02),0_4px_16px_rgba(15,15,15,0.04)]"
            style={{ width: POPOVER_WIDTH_PX, transformOrigin: "right top" }}
          >
            <div
              ref={listRef}
              className="autohide-scrollbar max-h-[min(640px,calc(100vh-160px))] flex-1 overflow-y-auto py-2"
            >
              <div
                data-testid="outline-popover-virtual-list"
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: "100%",
                  position: "relative",
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const heading = headings[virtualRow.index];
                  if (!heading) return null;
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
                        "absolute left-0 top-0 mx-1.5 flex min-h-[28px] cursor-pointer items-center rounded py-[5px] pr-3 text-left leading-[1.4] tracking-[-0.005em] transition-colors duration-100 hover:bg-foreground/[0.045]",
                        "w-[calc(100%-12px)]",
                        popoverColorClass(heading.level, isActive),
                        isActive && "bg-foreground/[0.04]"
                      )}
                      style={{
                        paddingLeft: indentPx,
                        fontSize,
                        fontWeight,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      data-outline-id={heading.id}
                      data-outline-virtual-row="true"
                      aria-current={isActive ? "location" : undefined}
                      title={heading.text || "Untitled"}
                    >
                      <span className="min-w-0 flex-1 truncate">{heading.text || "Untitled"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </div>
  );
}
