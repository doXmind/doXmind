"use client";

/**
 * Mobile Chat Overlay Component
 *
 * Full-screen chat history view that can be opened from the answer bubble
 * or the "View Chat" button in the bottom bar.
 */

import { useCallback } from "react";
import { X, ChevronDown } from "lucide-react";
import { motion, AnimatePresence, useDragControls, PanInfo } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ChatPanel } from "@/components/ai/chat-panel";
import { haptics } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { Z_INDEX, MOBILE_SPRINGS } from "@/lib/constants";

interface MobileChatOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean;
  /** Callback when overlay is closed */
  onClose: () => void;
}

export function MobileChatOverlay({ isOpen, onClose }: MobileChatOverlayProps) {
  const dragControls = useDragControls();

  const handleClose = useCallback(() => {
    haptics.light();
    onClose();
  }, [onClose]);

  const handleDragEnd = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      // Close if dragged down significantly or with high velocity
      if (info.offset.y > 100 || info.velocity.y > 300) {
        haptics.light();
        onClose();
      }
    },
    [onClose]
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/50 md:hidden"
            style={{ zIndex: Z_INDEX.MOBILE_PANEL + 10 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          />

          {/* Chat Panel */}
          <motion.div
            className={cn(
              "fixed inset-x-0 bottom-0 md:hidden",
              "flex flex-col overflow-hidden bg-background",
              "rounded-t-2xl"
            )}
            style={{
              zIndex: Z_INDEX.MOBILE_PANEL + 11,
              height: "90vh",
              maxHeight: "90vh",
            }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", ...MOBILE_SPRINGS.SMOOTH }}
            drag="y"
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.1, bottom: 0.3 }}
            onDragEnd={handleDragEnd}
          >
            {/* Drag Handle & Header */}
            <div
              className="flex-shrink-0 cursor-grab touch-none active:cursor-grabbing"
              onPointerDown={(e) => dragControls.start(e)}
            >
              {/* Handle Bar */}
              <div className="flex justify-center py-3">
                <div className="h-1 w-10 rounded-full bg-border" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between border-b border-border px-4 pb-3">
                <h2 className="text-base font-semibold">Chat History</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleClose}
                  className="h-10 w-10 rounded-full"
                  aria-label="Close chat"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>

            {/* Chat Content */}
            <div
              className="flex-1 overflow-hidden"
              style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            >
              {/* Embedded ChatPanel without its headers */}
              <div className="h-full [&_.chat-header-desktop]:hidden [&_.chat-header-mobile]:hidden">
                <ChatPanel />
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
