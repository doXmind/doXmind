"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { X, ChevronDown, ChevronUp, Sparkles, Trash2, Send } from "lucide-react";
import { motion, AnimatePresence, useDragControls, PanInfo } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useLayoutStore } from "@/stores/layout-store";
import { useChatStore } from "@/stores/chat-store";
import { useFileStore } from "@/stores/file-store";
import { ChatPanel } from "@/components/ai/chat-panel";
import { Z_INDEX, MOBILE_V2, MOBILE_SPRINGS, AI_PANEL_STATES } from "@/lib/constants";
import { haptics } from "@/lib/haptics";
import { cn } from "@/lib/utils";

// Get height for each state
const getStateHeight = (state: string): number => {
  if (typeof window === "undefined") return 100;
  switch (state) {
    case AI_PANEL_STATES.PEEK:
      return MOBILE_V2.AI_PEEK_HEIGHT;
    case AI_PANEL_STATES.CHAT:
      return window.innerHeight * MOBILE_V2.AI_CHAT_RATIO;
    case AI_PANEL_STATES.FULL:
      return window.innerHeight * MOBILE_V2.AI_FULL_RATIO;
    default:
      return 0;
  }
};

export function AIPanel() {
  const { aiPanelState, setAIPanelState, closeAIPanel } = useLayoutStore();
  const { currentFileId } = useFileStore();
  const { conversations, clearConversation } = useChatStore();
  const conversationKey = currentFileId || "global";
  const conversation = conversations[conversationKey];

  const dragControls = useDragControls();
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentHeight, setCurrentHeight] = useState<number>(MOBILE_V2.AI_PEEK_HEIGHT);

  // Update height when state changes
  useEffect(() => {
    if (aiPanelState !== AI_PANEL_STATES.CLOSED) {
      const height = getStateHeight(aiPanelState);
      setCurrentHeight(height);
    }
  }, [aiPanelState]);

  const handleClose = useCallback(() => {
    haptics.light();
    closeAIPanel();
  }, [closeAIPanel]);

  const handleClear = useCallback(() => {
    if (conversation?.messages?.length > 0) {
      haptics.medium();
      clearConversation(conversationKey);
    }
  }, [conversation, clearConversation, conversationKey]);

  const handleExpand = useCallback(() => {
    haptics.light();
    if (aiPanelState === AI_PANEL_STATES.PEEK) {
      setAIPanelState(AI_PANEL_STATES.CHAT);
    } else if (aiPanelState === AI_PANEL_STATES.CHAT) {
      setAIPanelState(AI_PANEL_STATES.FULL);
    }
  }, [aiPanelState, setAIPanelState]);

  const handleCollapse = useCallback(() => {
    haptics.light();
    if (aiPanelState === AI_PANEL_STATES.FULL) {
      setAIPanelState(AI_PANEL_STATES.CHAT);
    } else if (aiPanelState === AI_PANEL_STATES.CHAT) {
      setAIPanelState(AI_PANEL_STATES.PEEK);
    }
  }, [aiPanelState, setAIPanelState]);

  const handleDragEnd = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      const velocity = info.velocity.y;
      const offset = info.offset.y;

      // Fast swipe down - close or collapse
      if (velocity > 500 || offset > 150) {
        haptics.tick();
        if (aiPanelState === AI_PANEL_STATES.PEEK) {
          closeAIPanel();
        } else if (aiPanelState === AI_PANEL_STATES.CHAT) {
          setAIPanelState(AI_PANEL_STATES.PEEK);
        } else if (aiPanelState === AI_PANEL_STATES.FULL) {
          setAIPanelState(AI_PANEL_STATES.CHAT);
        }
        return;
      }

      // Fast swipe up - expand
      if (velocity < -500 || offset < -100) {
        haptics.tick();
        if (aiPanelState === AI_PANEL_STATES.PEEK) {
          setAIPanelState(AI_PANEL_STATES.CHAT);
        } else if (aiPanelState === AI_PANEL_STATES.CHAT) {
          setAIPanelState(AI_PANEL_STATES.FULL);
        }
        return;
      }

      // Snap to nearest state
      const peekHeight = getStateHeight(AI_PANEL_STATES.PEEK);
      const chatHeight = getStateHeight(AI_PANEL_STATES.CHAT);
      const fullHeight = getStateHeight(AI_PANEL_STATES.FULL);
      const currentH = currentHeight - offset;

      const distToPeek = Math.abs(currentH - peekHeight);
      const distToChat = Math.abs(currentH - chatHeight);
      const distToFull = Math.abs(currentH - fullHeight);

      const minDist = Math.min(distToPeek, distToChat, distToFull);

      if (minDist === distToPeek) {
        setAIPanelState(AI_PANEL_STATES.PEEK);
      } else if (minDist === distToChat) {
        setAIPanelState(AI_PANEL_STATES.CHAT);
      } else {
        setAIPanelState(AI_PANEL_STATES.FULL);
      }
    },
    [aiPanelState, currentHeight, closeAIPanel, setAIPanelState]
  );

  const isPeekMode = aiPanelState === AI_PANEL_STATES.PEEK;
  const isOpen = aiPanelState !== AI_PANEL_STATES.CLOSED;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop - only show for chat/full modes */}
          {!isPeekMode && (
            <motion.div
              className="fixed inset-0 bg-black/40 dark:bg-black/60 md:hidden"
              style={{ zIndex: Z_INDEX.MOBILE_OVERLAY }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleClose}
            />
          )}

          {/* Panel */}
          <motion.div
            ref={containerRef}
            className={cn(
              "fixed inset-x-0 bottom-0 flex flex-col overflow-hidden bg-background md:hidden",
              !isPeekMode && "shadow-2xl"
            )}
            style={{
              zIndex: Z_INDEX.MOBILE_PANEL,
              height: currentHeight,
              borderTopLeftRadius: MOBILE_V2.PANEL_BORDER_RADIUS,
              borderTopRightRadius: MOBILE_V2.PANEL_BORDER_RADIUS,
              paddingBottom: "env(safe-area-inset-bottom)",
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
            {/* Drag Handle Area */}
            <div
              className="flex-shrink-0 cursor-grab touch-none active:cursor-grabbing"
              style={{ height: MOBILE_V2.PANEL_HANDLE_HEIGHT }}
              onPointerDown={(e) => dragControls.start(e)}
            >
              {/* Handle Bar */}
              <div className="flex justify-center py-3">
                <div className="h-1 w-10 rounded-full bg-border" />
              </div>
            </div>

            {isPeekMode ? (
              /* Peek Mode - Compact Input */
              <div className="flex-1 flex items-center px-4 pb-2 gap-3">
                <div className="flex items-center gap-2 text-primary flex-shrink-0">
                  <Sparkles className="h-5 w-5" />
                </div>
                {/* Tappable area that expands the panel - no auto focus */}
                <button
                  type="button"
                  onClick={handleExpand}
                  className={cn(
                    "flex-1 bg-accent/50 rounded-full px-4 py-2.5 text-left",
                    "text-base text-muted-foreground",
                    "active:bg-accent/70 transition-colors"
                  )}
                >
                  Ask AI anything...
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleExpand}
                  className="h-10 w-10 rounded-full flex-shrink-0"
                >
                  <ChevronUp className="h-5 w-5" />
                </Button>
              </div>
            ) : (
              /* Chat/Full Mode - Full Interface */
              <>
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border px-4 pb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    <h3 className="text-base font-semibold">AI Assistant</h3>
                  </div>
                  <div className="flex items-center gap-1">
                    {conversation?.messages?.length > 0 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleClear}
                        className="h-10 w-10"
                        aria-label="Clear conversation"
                      >
                        <Trash2 className="h-5 w-5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={
                        aiPanelState === AI_PANEL_STATES.FULL
                          ? handleCollapse
                          : handleExpand
                      }
                      className="h-10 w-10"
                      aria-label={
                        aiPanelState === AI_PANEL_STATES.FULL
                          ? "Collapse"
                          : "Expand"
                      }
                    >
                      {aiPanelState === AI_PANEL_STATES.FULL ? (
                        <ChevronDown className="h-5 w-5" />
                      ) : (
                        <ChevronUp className="h-5 w-5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleClose}
                      className="h-10 w-10"
                      aria-label="Close"
                    >
                      <X className="h-5 w-5" />
                    </Button>
                  </div>
                </div>

                {/* Chat Content */}
                <div className="flex-1 overflow-hidden">
                  <ChatPanelEmbedded />
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Embedded version of ChatPanel without the header
function ChatPanelEmbedded() {
  return (
    <div className="h-full [&>div>div:first-child]:hidden [&>div>div:nth-child(2)]:hidden">
      <ChatPanel />
    </div>
  );
}
