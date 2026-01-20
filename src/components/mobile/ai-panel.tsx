"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import {
  X,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Trash2,
  Wand2,
  Scissors,
  Maximize2,
  Check,
  Languages,
} from "lucide-react";
import { motion, AnimatePresence, useDragControls, PanInfo } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useLayoutStore } from "@/stores/layout-store";
import { useChatStore } from "@/stores/chat-store";
import { useFileStore } from "@/stores/file-store";
import { ChatPanel } from "@/components/ai/chat-panel";
import { useChat } from "@/hooks/use-chat";
import { Z_INDEX, MOBILE_V2, MOBILE_SPRINGS, AI_PANEL_STATES } from "@/lib/constants";
import { haptics } from "@/lib/haptics";
import { cn } from "@/lib/utils";

// Height for peek mode with selection (needs more space for quick actions)
const PEEK_HEIGHT_WITH_SELECTION = 180;

// Get height for each state
const getStateHeight = (state: string, hasSelection: boolean = false): number => {
  if (typeof window === "undefined") return 100;
  switch (state) {
    case AI_PANEL_STATES.PEEK:
      return hasSelection ? PEEK_HEIGHT_WITH_SELECTION : MOBILE_V2.AI_PEEK_HEIGHT;
    case AI_PANEL_STATES.CHAT:
      return window.innerHeight * MOBILE_V2.AI_CHAT_RATIO;
    case AI_PANEL_STATES.FULL:
      return window.innerHeight * MOBILE_V2.AI_FULL_RATIO;
    default:
      return 0;
  }
};

// Quick action button for selection mode
function QuickActionButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-2",
        "bg-accent/80 text-sm font-medium text-accent-foreground",
        "transition-transform active:scale-95"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function AIPanel() {
  const {
    aiPanelState,
    setAIPanelState,
    closeAIPanel,
    pendingSelectionForAI,
    clearPendingSelectionForAI,
  } = useLayoutStore();
  const { currentFileId } = useFileStore();
  const { conversations, clearConversation } = useChatStore();
  const { sendMessage } = useChat();
  const conversationKey = currentFileId || "global";
  const conversation = conversations[conversationKey];

  const dragControls = useDragControls();
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentHeight, setCurrentHeight] = useState<number>(MOBILE_V2.AI_PEEK_HEIGHT);

  // Update height when state or selection changes
  useEffect(() => {
    if (aiPanelState !== AI_PANEL_STATES.CLOSED) {
      const height = getStateHeight(
        aiPanelState,
        Boolean(pendingSelectionForAI && pendingSelectionForAI.trim())
      );
      setCurrentHeight(height);
    }
  }, [aiPanelState, pendingSelectionForAI]);

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

  // Handle quick AI actions on selected text
  const handleQuickAction = useCallback(
    (action: string) => {
      if (!pendingSelectionForAI) return;

      haptics.medium();
      const prompts: Record<string, string> = {
        improve: `Please improve the following text, making it clearer and more professional:\n\n"${pendingSelectionForAI}"`,
        shorten: `Please shorten the following text while keeping the main points:\n\n"${pendingSelectionForAI}"`,
        expand: `Please expand on the following text with more details:\n\n"${pendingSelectionForAI}"`,
        fix: `Please fix any grammar, spelling, or punctuation errors in the following text:\n\n"${pendingSelectionForAI}"`,
        translate: `Please translate the following text to English (or Chinese if it's already in English):\n\n"${pendingSelectionForAI}"`,
      };

      const prompt = prompts[action];
      if (prompt) {
        // Expand to chat mode and send message
        setAIPanelState(AI_PANEL_STATES.CHAT);
        sendMessage(prompt, currentFileId ? [currentFileId] : [], null);
        clearPendingSelectionForAI();
      }
    },
    [pendingSelectionForAI, currentFileId, setAIPanelState, sendMessage, clearPendingSelectionForAI]
  );

  const hasSelection = Boolean(pendingSelectionForAI && pendingSelectionForAI.trim());

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
              /* Peek Mode - Compact Input or Selection Quick Actions */
              <div className="flex flex-1 flex-col gap-2 px-4 pb-2">
                {hasSelection ? (
                  /* Selection Mode - Show selected text preview and quick actions */
                  <>
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-5 w-5 flex-shrink-0 text-primary" />
                      <div className="flex-1 truncate text-sm text-muted-foreground">
                        &quot;{pendingSelectionForAI?.slice(0, 50)}
                        {pendingSelectionForAI && pendingSelectionForAI.length > 50 ? "..." : ""}
                        &quot;
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleExpand}
                        className="h-8 w-8 flex-shrink-0 rounded-full"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="hide-scrollbar flex items-center gap-2 overflow-x-auto pb-1">
                      <QuickActionButton
                        icon={<Wand2 className="h-4 w-4" />}
                        label="Improve"
                        onClick={() => handleQuickAction("improve")}
                      />
                      <QuickActionButton
                        icon={<Scissors className="h-4 w-4" />}
                        label="Shorten"
                        onClick={() => handleQuickAction("shorten")}
                      />
                      <QuickActionButton
                        icon={<Maximize2 className="h-4 w-4" />}
                        label="Expand"
                        onClick={() => handleQuickAction("expand")}
                      />
                      <QuickActionButton
                        icon={<Check className="h-4 w-4" />}
                        label="Fix"
                        onClick={() => handleQuickAction("fix")}
                      />
                      <QuickActionButton
                        icon={<Languages className="h-4 w-4" />}
                        label="Translate"
                        onClick={() => handleQuickAction("translate")}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleExpand}
                      className={cn(
                        "w-full rounded-full bg-accent/50 px-4 py-2 text-left",
                        "text-sm text-muted-foreground",
                        "transition-colors active:bg-accent/70"
                      )}
                    >
                      Ask something else...
                    </button>
                  </>
                ) : (
                  /* Normal Mode - Simple input */
                  <div className="flex items-center gap-3">
                    <div className="flex flex-shrink-0 items-center gap-2 text-primary">
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <button
                      type="button"
                      onClick={handleExpand}
                      className={cn(
                        "flex-1 rounded-full bg-accent/50 px-4 py-2.5 text-left",
                        "text-base text-muted-foreground",
                        "transition-colors active:bg-accent/70"
                      )}
                    >
                      Ask AI anything...
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleExpand}
                      className="h-10 w-10 flex-shrink-0 rounded-full"
                    >
                      <ChevronUp className="h-5 w-5" />
                    </Button>
                  </div>
                )}
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
                        aiPanelState === AI_PANEL_STATES.FULL ? handleCollapse : handleExpand
                      }
                      className="h-10 w-10"
                      aria-label={aiPanelState === AI_PANEL_STATES.FULL ? "Collapse" : "Expand"}
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

// Embedded version of ChatPanel without headers
// Uses CSS to hide both desktop header (hidden md:flex) and mobile header actions
function ChatPanelEmbedded() {
  return (
    <div className="h-full [&_.chat-header-desktop]:hidden [&_.chat-header-mobile]:hidden">
      <ChatPanel />
    </div>
  );
}
