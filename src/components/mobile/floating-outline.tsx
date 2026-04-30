"use client";

/**
 * Floating Navigation Handle (Google Docs Mobile Style)
 *
 * Two separate elements:
 * 1. Handle: small pill on right edge, tracks scroll position via RAF polling
 * 2. Panel: fixed center-right floating card with headings, shown on handle tap
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { ChevronsUpDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useHeadings } from "@/components/editor/mindlines/use-headings";
import { useBlockSelectionStore } from "@/stores/block-selection-store";
import { useKeyboardState } from "@/hooks/use-mobile-gestures";
import { useFileStore } from "@/stores/file-store";
import { haptics } from "@/lib/haptics";
import { Z_INDEX } from "@/lib/constants";
import type { Heading } from "@/components/editor/mindlines/types";

/** Safe zone: handle stays within this vertical range */
const TRACK_TOP = 64;
const TRACK_BOTTOM = 80;
const PANEL_CLOSE_NAV_DELAY = 200;

/** Find the mobile scroll container via data attribute */
function getScrollContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-mobile-scroll]");
}

export function FloatingOutline() {
  const t = useTranslations("mobile");
  const { editor } = useEditorRefStore();
  const { headings, activeId, navigateTo } = useHeadings(editor);
  const { isSelectionActive } = useBlockSelectionStore();
  const { isVisible: isKeyboardVisible } = useKeyboardState();
  const { currentFileId, files } = useFileStore();

  const [isExpanded, setIsExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [handleTop, setHandleTop] = useState(TRACK_TOP);

  const panelRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const navTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragStartYRef = useRef(0);
  const dragStartScrollTopRef = useRef(0);
  const wasDraggingRef = useRef(false);
  const isDraggingRef = useRef(false);
  const rafRef = useRef(0);

  const currentFile = files.find((f) => f.id === currentFileId);
  const documentTitle = currentFile?.name || t("untitled");

  // Continuously poll scroll position to drive handle placement.
  useEffect(() => {
    if (headings.length === 0) return;

    const trackRange = window.innerHeight - TRACK_TOP - TRACK_BOTTOM;

    const tick = () => {
      if (isDraggingRef.current) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const sc = getScrollContainer();
      if (sc) {
        const maxScroll = sc.scrollHeight - sc.clientHeight;
        if (maxScroll > 0) {
          const progress = sc.scrollTop / maxScroll;
          setHandleTop(TRACK_TOP + progress * trackRange);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [headings.length]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimeout(navTimeoutRef.current);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Close expanded panel on outside click
  useEffect(() => {
    if (!isExpanded) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        handleRef.current &&
        !handleRef.current.contains(target)
      ) {
        setIsExpanded(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [isExpanded]);

  // --- Drag to scroll ---
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (isExpanded) return;
      dragStartYRef.current = e.touches[0].clientY;
      const sc = getScrollContainer();
      dragStartScrollTopRef.current = sc?.scrollTop ?? 0;
      wasDraggingRef.current = false;
    },
    [isExpanded]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (isExpanded) return;
      const deltaY = e.touches[0].clientY - dragStartYRef.current;

      if (!isDragging && Math.abs(deltaY) > 5) {
        setIsDragging(true);
        isDraggingRef.current = true;
        wasDraggingRef.current = true;
        haptics.light();
      }
      if (!isDragging && Math.abs(deltaY) <= 5) return;

      e.preventDefault();

      const sc = getScrollContainer();
      if (!sc) return;

      const trackRange = window.innerHeight - TRACK_TOP - TRACK_BOTTOM;
      const maxScroll = sc.scrollHeight - sc.clientHeight;
      const scrollDelta = (deltaY / trackRange) * maxScroll;
      const newScrollTop = Math.min(
        maxScroll,
        Math.max(0, dragStartScrollTopRef.current + scrollDelta)
      );
      sc.scrollTop = newScrollTop;

      const progress = newScrollTop / maxScroll;
      setHandleTop(TRACK_TOP + progress * trackRange);
    },
    [isDragging, isExpanded]
  );

  const handleTouchEnd = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      isDraggingRef.current = false;
    }
  }, [isDragging]);

  // Tap (not drag) on the handle → toggle outline panel
  const handleHandleTap = useCallback(() => {
    if (wasDraggingRef.current) return;
    haptics.light();
    setIsExpanded((prev) => !prev);
  }, []);

  const handleHeadingClick = useCallback(
    (heading: Heading) => {
      haptics.light();
      setIsExpanded(false);
      clearTimeout(navTimeoutRef.current);
      navTimeoutRef.current = setTimeout(() => {
        navigateTo(heading, { skipFocus: true });
      }, PANEL_CLOSE_NAV_DELAY);
    },
    [navigateTo]
  );

  // Don't render when no headings, block selection, or keyboard visible
  if (headings.length === 0 || isSelectionActive || isKeyboardVisible) {
    return null;
  }

  return (
    <>
      {/* Handle — always visible, tracks scroll position */}
      <div
        ref={handleRef}
        className="fixed right-0 md:hidden"
        style={{
          top: handleTop,
          zIndex: Z_INDEX.FLOATING_BUTTON,
        }}
      >
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onClick={handleHandleTap}
          className={cn(
            "flex touch-none items-center justify-center",
            "rounded-l-full border border-r-0",
            "shadow-md",
            "transition-all duration-150",
            isDragging
              ? "h-12 w-7 border-primary/50 bg-primary/15 backdrop-blur-xl"
              : "h-10 w-6 border-border/30 bg-background/90 backdrop-blur-md",
            "active:bg-accent"
          )}
          role="slider"
          aria-label={t("scrollPosition")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(
            ((handleTop - TRACK_TOP) / (window.innerHeight - TRACK_TOP - TRACK_BOTTOM)) * 100
          )}
        >
          <ChevronsUpDown
            className={cn(
              "text-muted-foreground transition-all",
              isDragging ? "h-4 w-4" : "h-3.5 w-3.5"
            )}
          />
        </div>
      </div>

      {/* Outline panel — fixed center-right, independent of handle position */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            ref={panelRef}
            key="outline-panel"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={cn(
              "fixed right-0 md:hidden",
              "bg-background/80 backdrop-blur-2xl",
              "rounded-l-2xl border border-r-0 border-border/40",
              "shadow-2xl",
              "max-h-[65vh] w-64 overflow-hidden",
              "flex flex-col"
            )}
            style={{
              top: "50%",
              marginTop: "-32.5vh",
              zIndex: Z_INDEX.FLOATING_BUTTON + 1,
            }}
          >
            {/* Document title */}
            <div className="border-b border-border/20 px-4 py-3">
              <p className="line-clamp-1 text-xs font-semibold text-foreground/80">
                {documentTitle}
              </p>
            </div>

            {/* Headings list */}
            <div className="flex-1 overflow-y-auto py-1">
              {headings.map((heading) => {
                const isActive = heading.id === activeId;
                return (
                  <button
                    key={heading.id}
                    type="button"
                    onClick={() => handleHeadingClick(heading)}
                    className={cn(
                      "text-ui-base w-full py-2.5 pr-4 text-left transition-colors",
                      "active:bg-accent/50",
                      isActive
                        ? "bg-foreground/10 font-semibold text-foreground"
                        : "text-foreground/60",
                      heading.level === 1 && "pl-4",
                      heading.level === 2 && "pl-8",
                      heading.level >= 3 && "pl-12"
                    )}
                  >
                    <span className="line-clamp-1">{heading.text || t("untitled")}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
