"use client";

import { useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { MINDLINES_WIDTH, ANIMATION_DURATION } from "@/lib/constants";
import { useLayoutStore } from "@/stores/layout-store";
import { useHeadings } from "./use-headings";
import { useMindlinesState } from "./use-mindlines-state";
import { MindlinesHeader } from "./mindlines-header";
import { OutlineView } from "./outline-view";
import { MindmapFlow } from "./mindmap-flow";

interface MindlinesProps {
  editor: Editor | null;
}

// Easing function for smooth animations
const EASE_OUT_QUART = [0.4, 0, 0.2, 1] as const;

// Animation variants for width transitions
const containerVariants = {
  collapsed: {
    width: MINDLINES_WIDTH.COLLAPSED,
    transition: { duration: ANIMATION_DURATION.NORMAL / 1000, ease: EASE_OUT_QUART },
  },
  preview: {
    width: MINDLINES_WIDTH.PREVIEW,
    transition: { duration: ANIMATION_DURATION.NORMAL / 1000, ease: EASE_OUT_QUART },
  },
  expanded: {
    width: "auto", // Full screen with margin, controlled by inset-0 + m-4
    transition: { duration: ANIMATION_DURATION.TRANSITION / 1000, ease: EASE_OUT_QUART },
  },
};

// Content fade animations
const contentVariants = {
  initial: { opacity: 0, scale: 0.98 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98 },
};

/**
 * Mindlines - Unified document outline and mindmap component
 * Three states: collapsed (default), preview (on hover), expanded (mindmap overlay)
 */
export function Mindlines({ editor }: MindlinesProps) {
  const { isMindlinesOpen } = useLayoutStore();
  const { headings, activeId, navigateTo } = useHeadings(editor);
  const shouldReduceMotion = useReducedMotion();

  const {
    mode,
    handleMouseEnter,
    handleMouseLeave,
    handleToggleExpand,
    handleClose,
  } = useMindlinesState();

  // Handle navigation from mindmap (navigate + close)
  const handleMindmapNavigate = useCallback(
    (heading: { id: string; level: number; text: string; pos: number }) => {
      navigateTo(heading);
      handleClose();
    },
    [navigateTo, handleClose]
  );

  if (!isMindlinesOpen || !editor) return null;

  const isExpanded = mode === "expanded";
  const isPreview = mode === "preview";

  // Disable animations if user prefers reduced motion
  const animationProps = shouldReduceMotion
    ? {}
    : {
        variants: containerVariants,
        initial: false,
        animate: mode,
      };

  return (
    <>
      {/* Backdrop overlay for expanded mode */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            className="fixed inset-0 bg-background/60 backdrop-blur-sm z-20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleClose}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      {/* Main container */}
      <motion.aside
        className={cn(
          // Base styles
          "relative border-r bg-background/95 backdrop-blur-sm flex flex-col min-h-0",
          // Non-expanded: standard sidebar
          !isExpanded && "z-30 shrink-0 h-full",
          // Expanded: fixed overlay - use calc for proper height with margins
          isExpanded &&
            "fixed z-30 shadow-2xl border-r-0 rounded-lg overflow-hidden"
        )}
        style={{
          ...(shouldReduceMotion && !isExpanded
            ? {
                width:
                  mode === "collapsed"
                    ? MINDLINES_WIDTH.COLLAPSED
                    : mode === "preview"
                      ? MINDLINES_WIDTH.PREVIEW
                      : "auto",
              }
            : {}),
          ...(isExpanded
            ? {
                top: 16,
                left: 16,
                right: 16,
                bottom: 16,
                height: "calc(100vh - 32px)",
              }
            : {}),
        }}
        {...animationProps}
        onMouseEnter={!isExpanded ? handleMouseEnter : undefined}
        onMouseLeave={!isExpanded ? handleMouseLeave : undefined}
        role="navigation"
        aria-label={isExpanded ? "Document mindmap" : "Document outline"}
        aria-expanded={isExpanded}
      >
        {/* Header with title and controls */}
        <MindlinesHeader
          mode={mode}
          onToggle={handleToggleExpand}
          onClose={handleClose}
          headingsCount={headings.length}
        />

        {/* Content: OutlineView or MindmapFlow */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <AnimatePresence mode="wait">
            {isExpanded ? (
              <motion.div
                key="mindmap"
                className="h-full"
                variants={contentVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.2 }}
              >
                <MindmapFlow
                  headings={headings}
                  activeId={activeId}
                  onNodeClick={handleMindmapNavigate}
                />
              </motion.div>
            ) : (
              <motion.div
                key="outline"
                className="h-full overflow-y-auto"
                variants={contentVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.15 }}
              >
                <OutlineView
                  headings={headings}
                  activeId={activeId}
                  onNavigate={navigateTo}
                  isPreview={isPreview}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.aside>
    </>
  );
}
