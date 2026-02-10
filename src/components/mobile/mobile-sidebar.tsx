"use client";

import { useRef, useEffect } from "react";
import { X, ChevronLeft } from "lucide-react";
import { motion, AnimatePresence, useDragControls, PanInfo } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useLayoutStore } from "@/stores/layout-store";
import { useFileStore } from "@/stores/file-store";
import { Sidebar } from "@/components/sidebar/sidebar";
import { Z_INDEX } from "@/lib/constants";

const SIDEBAR_WIDTH = 300; // Sidebar width in pixels
const DRAG_CLOSE_THRESHOLD = 100; // Pixels dragged to trigger close

export function MobileSidebar() {
  const { isMobileSidebarOpen, setMobileSidebarOpen } = useLayoutStore();
  const { currentFolderId, getFile, setCurrentFolder } = useFileStore();
  const dragControls = useDragControls();
  const containerRef = useRef<HTMLDivElement>(null);

  const currentFolder = currentFolderId ? getFile(currentFolderId) : null;

  const handleClose = () => {
    setMobileSidebarOpen(false);
  };

  const handleDragEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    // Close if dragged left past threshold or with high velocity
    if (info.offset.x < -DRAG_CLOSE_THRESHOLD || info.velocity.x < -500) {
      handleClose();
    }
  };

  // Handle escape key
  useEffect(() => {
    if (!isMobileSidebarOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleClose is stable
  }, [isMobileSidebarOpen]);

  return (
    <AnimatePresence>
      {isMobileSidebarOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/40 dark:bg-black/60 md:hidden"
            style={{ zIndex: Z_INDEX.MOBILE_OVERLAY }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          />

          {/* Sidebar Panel - Slides in from left */}
          <motion.div
            ref={containerRef}
            className="fixed inset-y-0 left-0 flex flex-col overflow-hidden bg-background shadow-2xl md:hidden"
            style={{
              zIndex: Z_INDEX.MOBILE_PANEL,
              width: SIDEBAR_WIDTH,
              maxWidth: "85vw",
              paddingTop: "env(safe-area-inset-top)",
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{
              type: "spring",
              damping: 30,
              stiffness: 300,
            }}
            drag="x"
            dragControls={dragControls}
            dragConstraints={{ left: -SIDEBAR_WIDTH, right: 0 }}
            dragElastic={{ left: 0.5, right: 0 }}
            onDragEnd={handleDragEnd}
          >
            {/* Header */}
            <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {currentFolder && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setCurrentFolder(null)}
                    className="h-8 w-8 flex-shrink-0"
                    aria-label="Back to all files"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                )}
                <h3 className="truncate text-base font-semibold">
                  {currentFolder ? currentFolder.name : "Files"}
                </h3>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClose}
                className="h-10 w-10 flex-shrink-0"
                aria-label="Close sidebar"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            {/* Sidebar Content */}
            <div className="flex-1 overflow-hidden">
              <Sidebar />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
