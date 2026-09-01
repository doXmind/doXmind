"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { aggregateMarkers } from "./aggregate-markers";
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
// The popover's preferred width, and the floor it will not shrink past. The
// rail reserves a fixed gutter in the editor's content frame; the popover was
// 260px against a ~200px gutter, so it painted 68px of every Page's own text
// column at every window width. The width is now measured against the frame's
// real right edge on open (see `measurePopoverWidth`) and clamped into the
// space the reservation actually bought, which is what keeps a control's paint
// area inside the region it points at.
const POPOVER_MAX_WIDTH_PX = 260;
const POPOVER_MIN_WIDTH_PX = 176;
// Breathing room between the Page's right-most glyph and the popover's edge.
const POPOVER_CONTENT_GAP_PX = 4;
const POPOVER_MAX_HEIGHT_PX = 640;
const POPOVER_VERTICAL_VIEWPORT_GUTTER_PX = 160;
const POPOVER_ROW_ESTIMATE_PX = 28;
const POPOVER_VERTICAL_PADDING_PX = 16;
const POPOVER_ROW_OVERSCAN = 6;
const HOVER_SAFE_AREA_PADDING_PX = 10;
// The rail's own box: `py-1` on the marker column, and the two marker sizes it
// switches between. The hover sensor is sized from these so its hit area is
// the marks it represents (plus a small grace) rather than the full height of
// the rail column — which reached 196px past the last mark and opened the
// popover, unbidden, over the text.
const RAIL_PADDING_Y_PX = 4;
const RAIL_MARKER_HEIGHT_PX = { compact: 8, default: 12 } as const;
const RAIL_MARKER_GAP_PX = { compact: 2, default: 5 } as const;
const HOVER_SENSOR_GRACE_PX = 8;
// Cap the rail's DOM marker count. Above this, neighbouring headings are
// collapsed into equal-position buckets so very large outlines stay cheap to
// render without losing the active row's exact placement.
const MAX_RAIL_MARKERS = 120;

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

/**
 * How wide the popover may be without covering the Page's text column, given
 * where the rail's right edge sits. `.markdown-page` is the Page frame the
 * editor's reserved outline gutter is applied to, so its right edge is exactly
 * the boundary this control must not cross.
 */
function measurePopoverWidth(railElement: HTMLElement | null): number {
  if (!railElement || typeof document === "undefined") return POPOVER_MAX_WIDTH_PX;
  // Scoped to the rail's own editor region rather than the whole document: `.markdown-page` is on
  // every mounted Page, so a document-wide query measures whichever sits first in the DOM.
  const frame = (railElement.closest("main") ?? document).querySelector(".markdown-page");
  if (!frame) return POPOVER_MAX_WIDTH_PX;
  const available =
    railElement.getBoundingClientRect().right -
    frame.getBoundingClientRect().right -
    POPOVER_CONTENT_GAP_PX;
  return Math.round(Math.min(POPOVER_MAX_WIDTH_PX, Math.max(POPOVER_MIN_WIDTH_PX, available)));
}

export function OutlineCollapsed({ headings, activeId, onNavigate }: OutlineCollapsedProps) {
  const [hoveredLineId, setHoveredLineId] = useState<string | null>(null);
  const [phase, setPhase] = useState<InteractionPhase>("idle");
  const [popoverWidth, setPopoverWidth] = useState(POPOVER_MAX_WIDTH_PX);
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

  // Measured before the popover paints, not in an effect after it: an effect
  // would show one frame at the preferred width, i.e. one frame of paint over
  // the text column — the exact thing being fixed.
  const syncPopoverWidth = useCallback(() => {
    setPopoverWidth(measurePopoverWidth(railRef.current));
  }, []);

  const openPopoverNow = useCallback(() => {
    cancelOpen();
    cancelClose();
    syncPopoverWidth();
    setPhase("open");
  }, [cancelClose, cancelOpen, syncPopoverWidth]);

  const schedulePopoverOpen = useCallback(() => {
    cancelClose();
    syncPopoverWidth();
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
  }, [cancelClose, cancelOpen, syncPopoverWidth]);

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
      : projectLeftAnchoredPopoverRect(triggerRect, popoverWidth, estimatedPopoverHeight());

    return { triggerRect, popoverRect };
  }, [estimatedPopoverHeight, popoverWidth]);

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
    window.addEventListener("resize", syncPopoverWidth);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("resize", syncPopoverWidth);
    };
  }, [
    cancelClose,
    closePopoverImmediate,
    isPointerInSafeArea,
    phase,
    schedulePopoverClose,
    syncPopoverWidth,
  ]);

  const compactRail = headings.length > 28;
  const railMarkerHeightPx = compactRail
    ? RAIL_MARKER_HEIGHT_PX.compact
    : RAIL_MARKER_HEIGHT_PX.default;
  const railMarkerGapPx = compactRail ? RAIL_MARKER_GAP_PX.compact : RAIL_MARKER_GAP_PX.default;
  const popoverMounted = phase === "open" || phase === "closing";

  // Bound the rail to MAX_RAIL_MARKERS DOM nodes; the active heading is
  // always represented exactly so the live row never snaps to a bucket
  // midpoint. See `aggregate-markers.ts`.
  const railMarkers = useMemo(
    () => aggregateMarkers(headings, activeId, MAX_RAIL_MARKERS),
    [headings, activeId]
  );

  // Resolve the click target for a bucket marker: navigate to the first
  // heading whose position falls in the marker's bucket. For markers that
  // map 1:1 to a heading (sub-cap path or the active marker), this returns
  // the heading itself.
  const resolveMarkerTarget = useCallback(
    (markerId: string): Heading | null => {
      const direct = headings.find((heading) => heading.id === markerId);
      if (direct) return direct;
      if (!markerId.startsWith("bucket-")) return null;
      const bucketIndex = Number(markerId.slice("bucket-".length));
      if (!Number.isFinite(bucketIndex) || headings.length === 0) return null;
      const firstPos = headings[0].pos;
      const lastPos = headings[headings.length - 1].pos;
      const span = lastPos - firstPos;
      if (span <= 0) return headings[0] ?? null;
      const bucketSize = span / MAX_RAIL_MARKERS;
      const bucketStart = firstPos + bucketIndex * bucketSize;
      const bucketEnd =
        bucketIndex === MAX_RAIL_MARKERS - 1
          ? lastPos + 1
          : firstPos + (bucketIndex + 1) * bucketSize;
      return (
        headings.find((heading) => heading.pos >= bucketStart && heading.pos < bucketEnd) ?? null
      );
    },
    [headings]
  );

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

  // What the rail actually occupies: the markers stack from the column's top,
  // but the column itself spans 18vh..86vh, so the two are hundreds of pixels
  // apart on a short outline.
  const railMarkerExtentPx =
    RAIL_PADDING_Y_PX * 2 +
    railMarkers.length * railMarkerHeightPx +
    Math.max(0, railMarkers.length - 1) * railMarkerGapPx;

  if (headings.length === 0) return null;

  const handleNavigate = (heading: Heading) => {
    onNavigate(heading, { skipFocus: true });
    closePopoverImmediate();
  };

  return (
    <div
      data-testid="outline-rail-root"
      // Not hit-testable itself: the sensor below is the rail's hit area, and
      // it is sized to the marks. With the root taking pointer events, hovering
      // anywhere in the 40x612 column — including 196px past the last mark —
      // opened the popover over the text.
      className="group/outline-rail pointer-events-none absolute right-0 top-0 flex h-full justify-end"
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
        className="pointer-events-auto absolute right-0 top-0 z-10 w-full"
        style={{ height: `min(100%, ${railMarkerExtentPx + HOVER_SENSOR_GRACE_PX}px)` }}
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
        style={{ gap: railMarkerGapPx, width: "100%" }}
        aria-hidden={popoverMounted}
      >
        {railMarkers.map((marker) => {
          const isHover = hoveredLineId === marker.id;
          const w = lineWidthForLevel(marker.level);
          const opacity = marker.isActive ? 0.9 : isHover ? 0.38 : 0.16;
          const target = resolveMarkerTarget(marker.id);
          const labelText = target?.text || "Untitled";

          return (
            <button
              key={marker.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (target) handleNavigate(target);
              }}
              onMouseEnter={() => {
                setHoveredLineId(marker.id);
                schedulePopoverOpen();
              }}
              onMouseLeave={() => setHoveredLineId(null)}
              onPointerEnter={schedulePopoverOpen}
              onFocus={() => setHoveredLineId(marker.id)}
              onBlur={() => setHoveredLineId(null)}
              className="flex shrink-0 cursor-pointer items-center rounded-sm bg-transparent p-0 outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
              style={{ height: railMarkerHeightPx }}
              aria-label={`Navigate to: ${labelText}`}
              aria-current={marker.isActive ? "location" : undefined}
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
            style={{ width: popoverWidth, transformOrigin: "right top" }}
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
