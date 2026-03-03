"use client";

import { useRef, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { X, Minus, Sparkles, Trash2 } from "lucide-react";
import { motion, AnimatePresence, useDragControls, PanInfo } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useLayoutStore } from "@/stores/layout-store";
import { useChatStore } from "@/stores/chat-store";
import { useFileStore } from "@/stores/file-store";
import { ChatPanel } from "@/components/ai/chat-panel";
import { Z_INDEX } from "@/lib/constants";

// iOS-style bottom sheet heights
const SHEET_HEIGHTS = {
  MIN: 80, // Collapsed/peek height
  HALF: 0.5, // 50% of viewport
  FULL: 0.92, // Nearly full screen (leave space for status bar)
};

export function MobileChatSheet() {
  const t = useTranslations("mobile");
  const tc = useTranslations("common");
  const { isMobileChatOpen, setMobileChatOpen } = useLayoutStore();
  const { currentFileId } = useFileStore();
  const { conversations, clearConversation } = useChatStore();
  const conversationKey = currentFileId || "global";
  const conversation = conversations[conversationKey];

  const dragControls = useDragControls();
  const containerRef = useRef<HTMLDivElement>(null);
  const [sheetHeight, setSheetHeight] = useState<number>(400);
  const [_isDragging, setIsDragging] = useState(false);

  // Calculate height based on viewport
  const getHeightValue = (ratio: number): number => {
    if (typeof window === "undefined") return 400; // Fallback height
    return window.innerHeight * ratio;
  };

  const handleClose = () => {
    setMobileChatOpen(false);
  };

  const handleClear = () => {
    if (conversation?.messages?.length > 0) {
      clearConversation(conversationKey);
    }
  };

  const handleDragStart = () => {
    setIsDragging(true);
  };

  const handleDragEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setIsDragging(false);
    const velocity = info.velocity.y;
    const offset = info.offset.y;

    // Determine target height based on drag direction and velocity
    if (velocity > 500 || offset > 150) {
      // Fast downward swipe or dragged far down - close
      handleClose();
    } else if (velocity < -500 || offset < -100) {
      // Fast upward swipe - expand to full
      setSheetHeight(getHeightValue(SHEET_HEIGHTS.FULL));
    } else {
      // Snap to nearest height
      const currentHeight =
        typeof sheetHeight === "number" ? sheetHeight : window.innerHeight * 0.5;
      const halfHeight = getHeightValue(SHEET_HEIGHTS.HALF);
      const fullHeight = getHeightValue(SHEET_HEIGHTS.FULL);

      if (currentHeight > (halfHeight + fullHeight) / 2) {
        setSheetHeight(fullHeight);
      } else {
        setSheetHeight(halfHeight);
      }
    }
  };

  // Reset height when opening
  useEffect(() => {
    if (isMobileChatOpen) {
      setSheetHeight(getHeightValue(SHEET_HEIGHTS.HALF));
    }
  }, [isMobileChatOpen]);

  return (
    <AnimatePresence>
      {isMobileChatOpen && (
        <>
          {/* Backdrop - semi-transparent, tappable to close */}
          <motion.div
            className="fixed inset-0 bg-black/40 dark:bg-black/60 md:hidden"
            style={{ zIndex: Z_INDEX.MOBILE_OVERLAY }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          />

          {/* iOS-style Bottom Sheet */}
          <motion.div
            ref={containerRef}
            className="fixed inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-2xl bg-background shadow-2xl md:hidden"
            style={{
              zIndex: Z_INDEX.MOBILE_PANEL,
              height: sheetHeight,
              maxHeight: `${SHEET_HEIGHTS.FULL * 100}vh`,
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{
              type: "spring",
              damping: 30,
              stiffness: 300,
            }}
            drag="y"
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.1, bottom: 0.5 }}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {/* Drag Handle Area */}
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
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  <h3 className="text-base font-semibold">{t("aiAssistant")}</h3>
                </div>
                <div className="flex items-center gap-1">
                  {conversation?.messages?.length > 0 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleClear}
                      className="h-10 w-10"
                      aria-label={t("clearConversation")}
                    >
                      <Trash2 className="h-5 w-5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setSheetHeight(
                        typeof sheetHeight === "number" && sheetHeight > window.innerHeight * 0.6
                          ? getHeightValue(SHEET_HEIGHTS.HALF)
                          : getHeightValue(SHEET_HEIGHTS.FULL)
                      )
                    }
                    className="h-10 w-10"
                    aria-label={t("toggleSize")}
                  >
                    <Minus className="h-5 w-5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleClose}
                    className="h-10 w-10"
                    aria-label={tc("close")}
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Chat Content - Embedded ChatPanel without its header */}
            <div className="flex-1 overflow-hidden">
              <ChatPanelEmbedded />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Embedded version of ChatPanel without the header (for use in sheet)
function ChatPanelEmbedded() {
  return (
    <div className="h-full [&>div>div:first-child]:hidden [&>div>div:nth-child(2)]:hidden">
      <ChatPanel />
    </div>
  );
}
