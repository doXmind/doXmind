"use client";

/**
 * Floating Outline Component (Google Docs Style)
 *
 * A floating button on the right side of the screen that expands
 * to show document outline. Features:
 * - Collapsed: Shows up/down arrows for navigation
 * - Expanded: Shows full outline list
 * - Current heading highlighted
 * - Tap to navigate
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { ChevronUp, ChevronDown, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useHeadings } from "@/components/editor/mindlines/use-headings";
import { useBlockSelectionStore } from "@/stores/block-selection-store";
import { haptics } from "@/lib/haptics";
import { Z_INDEX } from "@/lib/constants";
import type { Heading } from "@/components/editor/mindlines/types";

export function FloatingOutline() {
  const [isExpanded, setIsExpanded] = useState(false);
  const { editor } = useEditorRefStore();
  const { headings, activeId, navigateTo } = useHeadings(editor);
  const { isSelectionActive } = useBlockSelectionStore();
  const containerRef = useRef<HTMLDivElement>(null);

  // Find current and adjacent headings
  const activeIndex = headings.findIndex((h) => h.id === activeId);
  const hasPrev = activeIndex > 0;
  const hasNext = activeIndex < headings.length - 1 && activeIndex >= 0;

  // Close when clicking outside
  useEffect(() => {
    if (!isExpanded) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isExpanded]);

  const handleToggle = useCallback(() => {
    haptics.light();
    setIsExpanded((prev) => !prev);
  }, []);

  const handlePrev = useCallback(() => {
    if (hasPrev) {
      haptics.light();
      navigateTo(headings[activeIndex - 1]);
    }
  }, [hasPrev, activeIndex, headings, navigateTo]);

  const handleNext = useCallback(() => {
    if (hasNext) {
      haptics.light();
      navigateTo(headings[activeIndex + 1]);
    }
  }, [hasNext, activeIndex, headings, navigateTo]);

  const handleHeadingClick = useCallback(
    (heading: Heading) => {
      haptics.light();
      navigateTo(heading);
      setIsExpanded(false);
    },
    [navigateTo]
  );

  // Hide when no headings or selection is active
  if (headings.length === 0 || isSelectionActive) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="fixed right-0 md:hidden"
      style={{
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: Z_INDEX.FLOATING_BUTTON,
      }}
    >
      <AnimatePresence mode="wait">
        {isExpanded ? (
          // Expanded outline list
          <motion.div
            key="expanded"
            initial={{ opacity: 0, x: 20, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className={cn(
              "bg-popover/95 backdrop-blur-xl",
              "rounded-l-xl border border-border/50 shadow-lg",
              "max-h-[60vh] w-64 overflow-hidden",
              "flex flex-col"
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/30 px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">Document outline</span>
              <button
                type="button"
                onClick={handleToggle}
                className="rounded p-1 transition-colors hover:bg-accent/50"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>

            {/* Outline list */}
            <div className="flex-1 overflow-y-auto py-1">
              {headings.map((heading) => (
                <button
                  key={heading.id}
                  type="button"
                  onClick={() => handleHeadingClick(heading)}
                  className={cn(
                    "w-full px-3 py-2 text-left text-sm transition-colors",
                    "hover:bg-accent/50 active:bg-accent",
                    heading.id === activeId
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-foreground",
                    heading.level === 1 && "pl-3",
                    heading.level === 2 && "pl-6",
                    heading.level === 3 && "pl-9",
                    heading.level === 4 && "pl-12"
                  )}
                >
                  <span className="line-clamp-2">{heading.text}</span>
                </button>
              ))}
            </div>
          </motion.div>
        ) : (
          // Collapsed navigation buttons
          <motion.div
            key="collapsed"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.15 }}
            className={cn(
              "bg-popover/90 backdrop-blur-xl",
              "rounded-l-xl border border-r-0 border-border/50 shadow-lg",
              "flex flex-col items-center"
            )}
          >
            {/* Up button */}
            <button
              type="button"
              onClick={hasPrev ? handlePrev : handleToggle}
              className={cn(
                "p-2.5 transition-colors",
                hasPrev
                  ? "text-foreground hover:bg-accent/50 active:bg-accent"
                  : "text-muted-foreground/50 hover:bg-accent/50 active:bg-accent"
              )}
            >
              <ChevronUp className="h-5 w-5" />
            </button>

            {/* Down button */}
            <button
              type="button"
              onClick={hasNext ? handleNext : handleToggle}
              className={cn(
                "p-2.5 transition-colors",
                hasNext
                  ? "text-foreground hover:bg-accent/50 active:bg-accent"
                  : "text-muted-foreground/50 hover:bg-accent/50 active:bg-accent"
              )}
            >
              <ChevronDown className="h-5 w-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
