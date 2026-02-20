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
import { OutlineCollapsed } from "./outline-collapsed";
import { MindmapFlow } from "./mindmap-flow";

interface MindlinesProps {
  editor: Editor | null;
}

// Easing function for smooth animations
const EASE_OUT_QUART = [0.4, 0, 0.2, 1] as const;

// Content fade animations
const contentVariants = {
  initial: { opacity: 0, scale: 0.98 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98 },
};

/**
 * Mindlines - Unified document outline and mindmap component
 *
 * Three states:
 * - Collapsed: minimal line indicators (48px width) - click anywhere to expand
 * - Expanded outline: full outline view (280px width) - click header to collapse
 * - Mindmap overlay: full-screen mindmap
 *
 * Click-to-toggle interaction:
 * - Collapsed: Click container, header, or headings to expand
 * - Expanded: Click header (not buttons) to collapse
 */
export function Mindlines({ editor }: MindlinesProps) {
  const {
    isMindlinesOpen,
    setMindlinesOpen,
    isMindlinesCollapsed,
    toggleMindlinesCollapsed,
    setMindlinesCollapsed,
  } = useLayoutStore();
  const { headings, activeId, navigateTo } = useHeadings(editor);
  const shouldReduceMotion = useReducedMotion();

  const { mode, handleToggleExpand, handleClose } = useMindlinesState();

  // Close the entire panel (hide from view)
  const handleClosePanel = useCallback(() => {
    setMindlinesOpen(false);
  }, [setMindlinesOpen]);

  // Handle navigation from mindmap (navigate + close)
  const handleMindmapNavigate = useCallback(
    (heading: { id: string; level: number; text: string; pos: number }) => {
      navigateTo(heading);
      handleClose();
    },
    [navigateTo, handleClose]
  );

  // Expand the outline (used by OutlineCollapsed headings)
  const handleExpand = useCallback(() => {
    setMindlinesCollapsed(false);
  }, [setMindlinesCollapsed]);

  if (!isMindlinesOpen || !editor || headings.length === 0) return null;

  const isExpanded = mode === "expanded";

  // Determine current width based on state
  const currentWidth = isExpanded
    ? "auto"
    : isMindlinesCollapsed
      ? MINDLINES_WIDTH.COLLAPSED
      : MINDLINES_WIDTH.EXPANDED;

  // Animation variants for width transitions
  const containerVariants = {
    collapsed: {
      width: currentWidth,
      transition: { duration: ANIMATION_DURATION.NORMAL / 1000, ease: EASE_OUT_QUART },
    },
    expanded: {
      width: "auto", // Full screen with margin, controlled by inset-0 + m-4
      transition: { duration: ANIMATION_DURATION.TRANSITION / 1000, ease: EASE_OUT_QUART },
    },
  };

  // Disable animations if user prefers reduced motion
  const animationProps = shouldReduceMotion
    ? {}
    : {
        variants: containerVariants,
        initial: false,
        animate: isExpanded ? "expanded" : "collapsed",
      };

  return (
    <>
      {/* Backdrop overlay for expanded mode */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            className="fixed inset-0 z-20 bg-background/60 backdrop-blur-sm"
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
          "relative flex min-h-0 flex-col border-r bg-background/95 backdrop-blur-sm",
          // Non-expanded: standard sidebar
          !isExpanded && "z-30 h-full shrink-0",
          // Expanded: fixed overlay - use calc for proper height with margins
          isExpanded && "fixed z-30 overflow-hidden rounded-lg border-r-0 shadow-2xl"
        )}
        style={{
          ...(shouldReduceMotion && !isExpanded ? { width: currentWidth } : {}),
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
        role="navigation"
        aria-label={isExpanded ? "Document mindmap" : "Document outline"}
      >
        {/* Header with title and controls */}
        <MindlinesHeader
          mode={mode}
          isCollapsed={isMindlinesCollapsed}
          onToggle={handleToggleExpand}
          onToggleCollapse={toggleMindlinesCollapsed}
          onClose={handleClosePanel}
          headingsCount={headings.length}
        />

        {/* Content: OutlineCollapsed, OutlineView, or MindmapFlow */}
        <div className="min-h-0 flex-1 overflow-hidden">
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
                  onToggleView={handleToggleExpand}
                  onClose={handleClose}
                />
              </motion.div>
            ) : isMindlinesCollapsed ? (
              <motion.div
                key="outline-collapsed"
                className="h-full overflow-y-auto"
                variants={contentVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.15 }}
              >
                <OutlineCollapsed
                  headings={headings}
                  activeId={activeId}
                  onNavigate={navigateTo}
                  onExpand={handleExpand}
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
                <OutlineView headings={headings} activeId={activeId} onNavigate={navigateTo} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.aside>
    </>
  );
}
