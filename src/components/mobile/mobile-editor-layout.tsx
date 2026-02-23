"use client";

/**
 * Mobile Editor Layout Component
 *
 * Main layout wrapper for the new mobile design.
 * Includes header, bottom bar, answer bubble, and overlays.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { MobileHeader } from "./mobile-header";
import { MobileBottomBar } from "./mobile-bottom-bar";
import { MobileFormattingToolbar } from "./mobile-formatting-toolbar";
import { MobileBlockInsertSheet } from "./mobile-block-insert-sheet";
import { AIAnswerBubble } from "./ai-answer-bubble";
import { EditSuccessIndicator } from "./edit-success-indicator";
import { MobileChatOverlay } from "./mobile-chat-overlay";
import { MobileSidebar } from "./mobile-sidebar";
import { MobileOutlineSheet } from "./mobile-outline-sheet";
import { useLayoutStore } from "@/stores/layout-store";
import { useChatStore } from "@/stores/chat-store";
import { useFileStore } from "@/stores/file-store";
import { useStreamingStore, type ToolStatus } from "@/stores/streaming-store";
import { useDiffReviewStore } from "@/stores/diff-review-store";
import { useKeyboardState } from "@/hooks/use-mobile-gestures";
import { FloatingOutline } from "./floating-outline";
import { MobileGestureHints } from "@/components/onboarding/mobile-gesture-hints";

interface MobileEditorLayoutProps {
  children: React.ReactNode;
}

// Edit tool names - constant that never changes
const EDIT_TOOLS = ["str_replace", "insert", "replace_all", "apply_edits"];

export function MobileEditorLayout({ children }: MobileEditorLayoutProps) {
  const {
    isMobileSidebarOpen,
    isMobileOutlineOpen,
    isMobileChatOverlayOpen,
    setMobileChatOverlayOpen,
    isMobileAnswerBubbleVisible,
    mobileAnswerBubbleContent,
    hideMobileAnswerBubble,
    showMobileAnswerBubble,
    showMobileEditSuccess,
    mobileEditCount,
    hideMobileEditSuccessIndicator,
    showMobileEditSuccessIndicator,
  } = useLayoutStore();

  const { currentFileId } = useFileStore();
  const { conversations } = useChatStore();
  const { isStreaming, toolHistory } = useStreamingStore();
  const { isReviewMode } = useDiffReviewStore();
  const { isVisible: isKeyboardVisible } = useKeyboardState();

  // Track the last response to detect when AI finishes
  const conversationKey = currentFileId || "global";
  const conversation = conversations[conversationKey];
  const messages = useMemo(() => conversation?.messages || [], [conversation?.messages]);

  // Find the last assistant message (not necessarily the very last message)
  const lastAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        return messages[i];
      }
    }
    return null;
  }, [messages]);

  // Find the last user message (for showing context in bubble)
  const lastUserMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        return messages[i];
      }
    }
    return null;
  }, [messages]);

  // Get user's question and selected context for the bubble
  const userQuestion = lastUserMessage?.content || "";
  const selectedContext = useMemo(() => {
    const contexts = lastUserMessage?.contexts;
    if (!contexts) return "";
    const selectionContext = contexts.find((c) => c.type === "selection");
    return selectionContext?.text || "";
  }, [lastUserMessage?.contexts]);

  // Detect whether the current response has edits
  const hasEditOperations = useMemo(() => {
    return toolHistory.some((tool: ToolStatus) => EDIT_TOOLS.includes(tool.name));
  }, [toolHistory]);

  // Count edit operations
  const editOperationCount = useMemo(() => {
    return toolHistory.filter((t: ToolStatus) => EDIT_TOOLS.includes(t.name)).length;
  }, [toolHistory]);

  // Track streaming state to detect completion
  const [wasStreaming, setWasStreaming] = useState(false);
  const [pendingShowBubble, setPendingShowBubble] = useState(false);

  // When streaming starts, prepare to show bubble
  useEffect(() => {
    if (isStreaming && !wasStreaming) {
      // Starting to stream - prepare bubble
      setPendingShowBubble(true);
    }
    setWasStreaming(isStreaming);
  }, [isStreaming, wasStreaming]);

  // When streaming ends, decide what to show
  // Use a separate effect that listens to lastAssistantMessage changes to avoid timing issues
  useEffect(() => {
    // Only process when streaming just ended (pendingShowBubble is true but not streaming)
    if (!isStreaming && pendingShowBubble) {
      // Streaming ended - decide what to show
      if (hasEditOperations && editOperationCount > 0) {
        // Had edit operations - show success indicator
        showMobileEditSuccessIndicator(editOperationCount);
        setPendingShowBubble(false);
      } else if (lastAssistantMessage?.content) {
        // No edits - show the final response in bubble
        // Don't check lastAssistantMessage.isStreaming - trust the hook's isStreaming flag
        showMobileAnswerBubble(lastAssistantMessage.content);
        setPendingShowBubble(false);
      }
    }
  }, [
    isStreaming,
    pendingShowBubble,
    lastAssistantMessage?.content,
    hasEditOperations,
    editOperationCount,
    showMobileAnswerBubble,
    showMobileEditSuccessIndicator,
  ]);

  // Get current streaming content for bubble
  const currentStreamingContent = useMemo(() => {
    if (!isStreaming) return "";
    // Use the last assistant message being streamed
    return lastAssistantMessage?.isStreaming ? lastAssistantMessage.content || "" : "";
  }, [isStreaming, lastAssistantMessage]);

  // Show bubble during streaming or when explicitly visible
  // Keep bubble visible even during edit operations (to show AI's explanation)
  const shouldShowBubble = useMemo(() => {
    // If explicitly visible (from showMobileAnswerBubble), show it
    if (isMobileAnswerBubbleVisible) return true;
    // If streaming, show bubble (regardless of edit operations)
    if (isStreaming && pendingShowBubble) return true;
    return false;
  }, [isMobileAnswerBubbleVisible, isStreaming, pendingShowBubble]);

  const isBubbleLoading = isStreaming && pendingShowBubble;

  const handleCloseBubble = useCallback(() => {
    hideMobileAnswerBubble();
    setPendingShowBubble(false);
  }, [hideMobileAnswerBubble]);

  const handleViewChatFromBubble = useCallback(() => {
    hideMobileAnswerBubble();
    setMobileChatOverlayOpen(true);
  }, [hideMobileAnswerBubble, setMobileChatOverlayOpen]);

  const handleOpenChatOverlay = useCallback(() => {
    setMobileChatOverlayOpen(true);
  }, [setMobileChatOverlayOpen]);

  const handleCloseChatOverlay = useCallback(() => {
    setMobileChatOverlayOpen(false);
  }, [setMobileChatOverlayOpen]);

  const handleDismissEditSuccess = useCallback(() => {
    hideMobileEditSuccessIndicator();
  }, [hideMobileEditSuccessIndicator]);

  const handleViewEditDetails = useCallback(() => {
    hideMobileEditSuccessIndicator();
    setMobileChatOverlayOpen(true);
  }, [hideMobileEditSuccessIndicator, setMobileChatOverlayOpen]);

  return (
    <div className="flex h-full flex-col bg-background md:hidden">
      {/* Header - flex child, not fixed */}
      <div className="h-12 flex-shrink-0">
        <MobileHeader />
      </div>

      {/* Main scroll container - SINGLE source of scrolling */}
      <main
        className="relative flex-1 overflow-y-auto overflow-x-hidden"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {children}
      </main>

      {/* Bottom bar - only show when a file is open AND keyboard is hidden */}
      {currentFileId && !isKeyboardVisible && (
        <div className="flex-shrink-0">
          <MobileBottomBar onViewChat={handleOpenChatOverlay} />
        </div>
      )}

      {/* Formatting toolbar - appears above keyboard when editing */}
      {currentFileId && <MobileFormattingToolbar />}

      {/* Block insert sheet */}
      <MobileBlockInsertSheet />

      {/* AI Answer Bubble */}
      <AIAnswerBubble
        response={isBubbleLoading ? currentStreamingContent : mobileAnswerBubbleContent}
        isVisible={shouldShowBubble}
        isLoading={isBubbleLoading}
        onClose={handleCloseBubble}
        onViewChat={handleViewChatFromBubble}
        userQuestion={userQuestion}
        selectedContext={selectedContext}
      />

      {/* Edit Success Indicator - hide when in diff review mode (review toolbar shows actual count) */}
      <EditSuccessIndicator
        isVisible={showMobileEditSuccess && !isReviewMode}
        editCount={mobileEditCount}
        onDismiss={handleDismissEditSuccess}
        onViewDetails={handleViewEditDetails}
      />

      {/* Chat Overlay */}
      <MobileChatOverlay isOpen={isMobileChatOverlayOpen} onClose={handleCloseChatOverlay} />

      {/* File Sidebar */}
      {isMobileSidebarOpen && <MobileSidebar />}

      {/* Outline Sheet */}
      {isMobileOutlineOpen && <MobileOutlineSheet />}

      {/* Floating outline indicator (scroll-triggered) */}
      {currentFileId && <FloatingOutline />}

      {/* Mobile Gesture Hints (first visit) */}
      <MobileGestureHints />
    </div>
  );
}
