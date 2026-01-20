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
import { AIAnswerBubble } from "./ai-answer-bubble";
import { EditSuccessIndicator } from "./edit-success-indicator";
import { MobileChatOverlay } from "./mobile-chat-overlay";
import { MobileSidebar } from "./mobile-sidebar";
import { MobileOutlineSheet } from "./mobile-outline-sheet";
import { useLayoutStore } from "@/stores/layout-store";
import { useChatStore } from "@/stores/chat-store";
import { useFileStore } from "@/stores/file-store";
import { useStreamingStore, type ToolStatus } from "@/stores/streaming-store";

interface MobileEditorLayoutProps {
  children: React.ReactNode;
}

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

  // Track the last response to detect when AI finishes
  const conversationKey = currentFileId || "global";
  const conversation = conversations[conversationKey];
  const messages = conversation?.messages || [];

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

  // Edit tool names
  const EDIT_TOOLS = ["str_replace", "insert", "replace_all", "apply_edits"];

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
    <div className="flex h-screen flex-col bg-background md:hidden">
      {/* Header */}
      <MobileHeader />

      {/* Main Content - Editor area with padding for header and bottom bar */}
      <main
        className="flex-1 overflow-auto"
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 48px)", // Header height
          paddingBottom: "calc(env(safe-area-inset-bottom) + 140px)", // Bottom bar height (~56px input + 16px*2 padding + quick actions)
        }}
      >
        {children}
      </main>

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

      {/* Edit Success Indicator */}
      <EditSuccessIndicator
        isVisible={showMobileEditSuccess}
        editCount={mobileEditCount}
        onDismiss={handleDismissEditSuccess}
        onViewDetails={handleViewEditDetails}
      />

      {/* Bottom Bar with AI Input */}
      <MobileBottomBar onViewChat={handleOpenChatOverlay} />

      {/* Chat Overlay */}
      <MobileChatOverlay isOpen={isMobileChatOverlayOpen} onClose={handleCloseChatOverlay} />

      {/* File Sidebar */}
      {isMobileSidebarOpen && <MobileSidebar />}

      {/* Outline Sheet */}
      {isMobileOutlineOpen && <MobileOutlineSheet />}
    </div>
  );
}
