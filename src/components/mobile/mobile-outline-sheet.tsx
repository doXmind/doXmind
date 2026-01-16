"use client";

import { useRef } from "react";
import { X, ChevronDown } from "lucide-react";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLayoutStore } from "@/stores/layout-store";
import { cn } from "@/lib/utils";
import { Z_INDEX } from "@/lib/constants";
import type { Heading } from "@/components/editor/mindlines/types";

interface OutlineItemProps {
  heading: Heading;
  isActive: boolean;
  onClick: () => void;
}

function OutlineItem({ heading, isActive, onClick }: OutlineItemProps) {
  const paddingLeft = heading.level === 1 ? 0 : heading.level === 2 ? 16 : 32;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full px-4 py-3 text-left text-base transition-colors",
        "active:bg-accent/50",
        isActive ? "bg-primary/5 font-medium text-primary" : "text-foreground hover:bg-accent/30",
        heading.level === 1 && "font-semibold",
        heading.level === 3 && "text-sm text-muted-foreground"
      )}
      style={{ paddingLeft: paddingLeft + 16 }}
    >
      <span className="line-clamp-2">{heading.text}</span>
    </button>
  );
}

export function MobileOutlineSheet() {
  const { isMobileOutlineOpen, setMobileOutlineOpen } = useLayoutStore();
  const dragControls = useDragControls();
  const containerRef = useRef<HTMLDivElement>(null);

  // Get headings from editor store (we'll need to expose this)
  // For now, we'll create a simple placeholder that will be connected later
  const headings: Heading[] = [];
  const activeId: string | null = null;

  const handleClose = () => {
    setMobileOutlineOpen(false);
  };

  const handleHeadingClick = (_heading: Heading) => {
    // Navigate to heading and close sheet
    // This will need to be connected to the editor's navigateTo function
    handleClose();
  };

  const handleDragEnd = (
    event: MouseEvent | TouchEvent | PointerEvent,
    info: { offset: { y: number }; velocity: { y: number } }
  ) => {
    // Close if dragged down more than 100px or with high velocity
    if (info.offset.y > 100 || info.velocity.y > 500) {
      handleClose();
    }
  };

  return (
    <AnimatePresence>
      {isMobileOutlineOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/30 dark:bg-black/50 md:hidden"
            style={{ zIndex: Z_INDEX.MOBILE_OVERLAY }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          />

          {/* Bottom Sheet */}
          <motion.div
            ref={containerRef}
            className="fixed inset-x-0 bottom-0 overflow-hidden rounded-t-2xl bg-background shadow-lg md:hidden"
            style={{
              zIndex: Z_INDEX.MOBILE_PANEL,
              maxHeight: "60vh",
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            drag="y"
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={handleDragEnd}
          >
            {/* Drag Handle */}
            <div
              className="flex cursor-grab justify-center py-3 active:cursor-grabbing"
              onPointerDown={(e) => dragControls.start(e)}
            >
              <div className="h-1 w-10 rounded-full bg-border" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-4 pb-2">
              <h3 className="text-base font-semibold">Document Outline</h3>
              <Button variant="ghost" size="icon" onClick={handleClose} className="h-10 w-10">
                <X className="h-5 w-5" />
              </Button>
            </div>

            {/* Content */}
            <ScrollArea className="max-h-[calc(60vh-80px)] flex-1">
              {headings.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                  <ChevronDown className="mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    No headings found in this document.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Add headings (H1, H2, H3) to create an outline.
                  </p>
                </div>
              ) : (
                <div className="py-2">
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
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
