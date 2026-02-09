"use client";

/**
 * Mobile Outline Sheet (Notion Style)
 *
 * Full-screen overlay outline with:
 * - Document title at top
 * - Clean hierarchical heading list
 * - Tap to navigate and close
 * - Large touch targets (48px minimum)
 */

import { useRef, useCallback } from "react";
import { ChevronLeft, FileText } from "lucide-react";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLayoutStore } from "@/stores/layout-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useFileStore } from "@/stores/file-store";
import { useHeadings } from "@/components/editor/mindlines/use-headings";
import { cn } from "@/lib/utils";
import { Z_INDEX, MOBILE_SPRINGS } from "@/lib/constants";
import { haptics } from "@/lib/haptics";
import type { Heading } from "@/components/editor/mindlines/types";

/**
 * Notion-style heading item
 */
interface OutlineItemProps {
  heading: Heading;
  isActive: boolean;
  onClick: () => void;
}

function OutlineItem({ heading, isActive, onClick }: OutlineItemProps) {
  const handleClick = useCallback(() => {
    haptics.light();
    onClick();
  }, [onClick]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "notion-heading-item",
        isActive && "active",
        heading.level === 1 && "notion-heading-h1",
        heading.level === 2 && "notion-heading-h2",
        heading.level === 3 && "notion-heading-h3"
      )}
    >
      <span className="line-clamp-2">{heading.text}</span>
    </button>
  );
}

export function MobileOutlineSheet() {
  const { isMobileOutlineOpen, setMobileOutlineOpen } = useLayoutStore();
  const { editor } = useEditorRefStore();
  const { currentFileId, files } = useFileStore();
  const { headings, activeId, navigateTo } = useHeadings(editor);
  const dragControls = useDragControls();
  const containerRef = useRef<HTMLDivElement>(null);

  const currentFile = files.find((f) => f.id === currentFileId);
  const documentTitle = currentFile?.name || "Untitled";

  const handleClose = useCallback(() => {
    haptics.light();
    setMobileOutlineOpen(false);
  }, [setMobileOutlineOpen]);

  const handleHeadingClick = useCallback(
    (heading: Heading) => {
      // Navigate to heading and close sheet
      navigateTo(heading);
      handleClose();
    },
    [navigateTo, handleClose]
  );

  const handleDragEnd = useCallback(
    (
      _event: MouseEvent | TouchEvent | PointerEvent,
      info: { offset: { y: number }; velocity: { y: number } }
    ) => {
      // Close if dragged down more than 150px or with high velocity
      if (info.offset.y > 150 || info.velocity.y > 500) {
        handleClose();
      }
    },
    [handleClose]
  );

  return (
    <AnimatePresence>
      {isMobileOutlineOpen && (
        <>
          {/* Full-screen backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/40 dark:bg-black/60 md:hidden"
            style={{ zIndex: Z_INDEX.MOBILE_OVERLAY }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          />

          {/* Full-screen outline panel */}
          <motion.div
            ref={containerRef}
            className={cn(
              "fixed inset-x-0 bottom-0 md:hidden",
              "rounded-t-2xl bg-background shadow-2xl",
              "flex flex-col"
            )}
            style={{
              zIndex: Z_INDEX.MOBILE_PANEL,
              height: "85vh",
              maxHeight: "85vh",
            }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", ...MOBILE_SPRINGS.SMOOTH }}
            drag="y"
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.3 }}
            onDragEnd={handleDragEnd}
          >
            {/* Drag Handle */}
            <div
              className="flex cursor-grab justify-center pb-2 pt-3 active:cursor-grabbing"
              onPointerDown={(e) => dragControls.start(e)}
            >
              <div className="h-1 w-10 rounded-full bg-border" />
            </div>

            {/* Header - Notion style */}
            <div className="flex items-center border-b border-border/50 px-4 pb-3">
              <button
                type="button"
                onClick={handleClose}
                className="mr-3 flex items-center gap-1 text-primary transition-colors hover:text-primary/80"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="mb-0.5 text-xs text-muted-foreground">Contents</p>
                <h3 className="truncate text-base font-semibold">{documentTitle}</h3>
              </div>
            </div>

            {/* Heading List */}
            <ScrollArea className="flex-1">
              {headings.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <FileText className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="mb-1 text-base font-medium text-foreground">No headings yet</p>
                  <p className="max-w-[240px] text-sm text-muted-foreground">
                    Add headings (H1, H2, H3) to your document to create an outline.
                  </p>
                </div>
              ) : (
                <div className="py-2 pb-[env(safe-area-inset-bottom)]">
                  {headings.map((heading) => (
                    <OutlineItem
                      key={heading.id}
                      heading={heading}
                      isActive={heading.id === activeId}
                      onClick={() => handleHeadingClick(heading)}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>

            {/* Footer with heading count */}
            {headings.length > 0 && (
              <div className="safe-area-bottom border-t border-border/50 px-4 py-3">
                <p className="text-center text-xs text-muted-foreground">
                  {headings.length} heading{headings.length !== 1 ? "s" : ""}
                </p>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
