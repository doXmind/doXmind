"use client";

/**
 * Floating Outline Component (Google Docs Style)
 *
 * A small chevron button pinned to the right edge of the screen.
 * Tapping it opens a compact floating outline panel.
 *
 * Design matches Google Docs mobile:
 * - Collapsed: small `<` arrow tab on right edge, always visible
 * - Expanded: floating panel with heading list + active heading highlighted
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useHeadings } from "@/components/editor/mindlines/use-headings";
import { useBlockSelectionStore } from "@/stores/block-selection-store";
import { haptics } from "@/lib/haptics";
import { Z_INDEX } from "@/lib/constants";
import type { Heading } from "@/components/editor/mindlines/types";

export function FloatingOutline() {
  const { editor } = useEditorRefStore();
  const { headings, activeId, navigateTo } = useHeadings(editor);
  const { isSelectionActive } = useBlockSelectionStore();

  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const handleHeadingClick = useCallback(
    (heading: Heading) => {
      haptics.light();
      navigateTo(heading);
      setIsExpanded(false);
    },
    [navigateTo]
  );

  // Hide when no headings or block selection is active
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
          /* Expanded: outline panel */
          <motion.div
            key="expanded"
            initial={{ opacity: 0, x: 20, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className={cn(
              "bg-popover/95 backdrop-blur-xl",
              "rounded-l-xl border border-r-0 border-border/50 shadow-lg",
              "max-h-[60vh] w-60 overflow-hidden",
              "flex flex-col"
            )}
          >
            {/* Heading list */}
            <div className="flex-1 overflow-y-auto py-1.5">
              {headings.map((heading) => (
                <button
                  key={heading.id}
                  type="button"
                  onClick={() => handleHeadingClick(heading)}
                  className={cn(
                    "w-full py-2 pr-3 text-left text-[13px] transition-colors",
                    "active:bg-accent",
                    heading.id === activeId
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-foreground/80",
                    heading.level === 1 && "pl-3",
                    heading.level === 2 && "pl-7",
                    heading.level === 3 && "pl-11"
                  )}
                >
                  <span className="line-clamp-1">{heading.text}</span>
                </button>
              ))}
            </div>

            {/* Close button at bottom */}
            <button
              type="button"
              onClick={handleToggle}
              className="flex items-center justify-center gap-1 border-t border-border/30 py-2.5 text-xs text-muted-foreground active:bg-accent"
            >
              <ChevronRight className="h-3.5 w-3.5" />
              Close outline
            </button>
          </motion.div>
        ) : (
          /* Collapsed: small arrow tab */
          <motion.div
            key="collapsed"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.12 }}
          >
            <button
              type="button"
              onClick={handleToggle}
              className={cn(
                "flex h-11 w-7 items-center justify-center",
                "bg-popover/80 backdrop-blur-md",
                "rounded-l-lg border border-r-0 border-border/40 shadow-md",
                "transition-colors active:bg-accent"
              )}
              aria-label="Open document outline"
            >
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
