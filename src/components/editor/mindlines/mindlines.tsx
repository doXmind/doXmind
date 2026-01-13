"use client";

import { useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layout-store";
import { useHeadings } from "./use-headings";
import { useMindlinesState } from "./use-mindlines-state";
import { MindlinesHeader } from "./mindlines-header";
import { OutlineView } from "./outline-view";
import { MindmapFlow } from "./mindmap-flow";

interface MindlinesProps {
  editor: Editor | null;
}

// Animation variants for width transitions
const containerVariants = {
  collapsed: {
    width: 208,
    transition: { duration: 0.25, ease: "easeOut" },
  },
  preview: {
    width: 320,
    transition: { duration: 0.2, ease: "easeOut" },
  },
  expanded: {
    width: "min(90vw, 1200px)",
    transition: { duration: 0.35, ease: [0.4, 0, 0.2, 1] },
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
          "relative border-r bg-background/95 backdrop-blur-sm flex flex-col min-h-0 h-full",
          // Non-expanded: standard sidebar
          !isExpanded && "z-30 shrink-0",
          // Expanded: fixed overlay
          isExpanded &&
            "fixed left-0 top-[57px] bottom-0 z-30 shadow-2xl border-r-0 rounded-r-lg"
        )}
        style={
          shouldReduceMotion
            ? {
                width:
                  mode === "collapsed"
                    ? 208
                    : mode === "preview"
                      ? 320
                      : "min(90vw, 1200px)",
              }
            : undefined
        }
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
