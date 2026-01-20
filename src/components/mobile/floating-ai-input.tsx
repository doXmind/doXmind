"use client";

/**
 * Floating AI Input Component
 *
 * Mobile-optimized AI input with:
 * - Pill-shaped design with processing animations
 * - Attachment menu (KB + images)
 * - Web tools settings toggle
 * - Context pills for selected text/images
 * - Voice input
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { Send, Mic, Loader2, MessageCircle, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { AttachmentMenu } from "@/components/ai/attachment-menu";
import { ChatSettings } from "@/components/ai/chat-settings";
import { ContextPill } from "@/components/ai/context-pill";
import { useChat } from "@/hooks/use-chat";
import { useFileStore } from "@/stores/file-store";
import { useEditorStore } from "@/stores/editor-store";
import { useChatStore } from "@/stores/chat-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useBlockSelectionStore } from "@/stores/block-selection-store";
import { useVoiceRecording, useSpeechToText } from "@/hooks/use-voice-recording";
import { haptics } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { CHAT_MAX_IMAGES, CHAT_MAX_IMAGE_SIZE } from "@/lib/constants";

interface FloatingAIInputProps {
  onViewChat?: () => void;
}

export function FloatingAIInput({ onViewChat }: FloatingAIInputProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { currentFileId } = useFileStore();
  const { conversations } = useChatStore();
  const { pendingSelectionForAI, clearPendingSelectionForAI } = useLayoutStore();
  const { sendMessage, isStreaming } = useChat();

  // Block selection store for mobile tap selection
  const {
    selectedBlocks,
    isSelectionActive,
    getSelectedText: getBlockSelectedText,
    clearSelection: clearBlockSelection,
  } = useBlockSelectionStore();

  // Chat context (selected text, images) from editor store
  const { chatContexts, removeChatContext, clearAllChatContexts, addChatContext } =
    useEditorStore();

  // Sync block selection with chat context
  // - When blocks are selected, add a selection context
  // - When blocks are unselected (tap again), remove the selection context
  useEffect(() => {
    const selectedText = getBlockSelectedText();
    const selectionContexts = chatContexts.filter((c) => c.type === "selection");

    if (isSelectionActive && selectedBlocks.length > 0 && selectedText) {
      // Check if we already have this exact selection as a context
      const existingSelectionContext = selectionContexts.find((c) => c.text === selectedText);
      if (!existingSelectionContext) {
        // Clear any old selection contexts first (selection changed)
        selectionContexts.forEach((c) => removeChatContext(c.id));
        // Add the new selected text as a chat context
        const firstBlock = selectedBlocks[0];
        const lastBlock = selectedBlocks[selectedBlocks.length - 1];
        addChatContext({
          type: "selection",
          text: selectedText,
          from: firstBlock.from,
          to: lastBlock.to,
        });
        haptics.light();
      }
    } else if (!isSelectionActive && selectionContexts.length > 0) {
      // No blocks selected - remove all selection contexts
      selectionContexts.forEach((c) => removeChatContext(c.id));
    }
  }, [
    isSelectionActive,
    selectedBlocks,
    getBlockSelectedText,
    chatContexts,
    addChatContext,
    removeChatContext,
  ]);

  // Get conversation for attachment menu
  const conversationKey = currentFileId || "global";
  const conversation = conversations[conversationKey];

  // Speech-to-text hook
  const { isTranscribing, transcribe, reset: resetTranscription } = useSpeechToText({
    onComplete: (text) => {
      if (text) {
        setInput((prev) => (prev ? `${prev} ${text}` : text));
      }
    },
  });

  // Voice recording hook
  const handleRecordingStop = useCallback(
    async (blob: Blob) => {
      await transcribe(blob);
    },
    [transcribe]
  );

  const {
    isRecording,
    duration,
    start: startRecording,
    stop: stopRecording,
  } = useVoiceRecording({
    maxDuration: 60000,
    onStop: handleRecordingStop,
    onCancel: () => {
      resetTranscription();
    },
  });

  const hasSelection = Boolean(pendingSelectionForAI?.trim());
  const hasContexts = chatContexts.length > 0;
  const currentImageCount = chatContexts.filter((c) => c.type === "image").length;

  const getPlaceholder = () => {
    if (isStreaming) return "AI is thinking...";
    if (isRecording) return "Listening...";
    if (isTranscribing) return "Transcribing...";
    if (hasSelection) return "Edit selected text...";
    if (hasContexts) return "Ask about attached content...";
    return "Ask AI anything...";
  };

  // Process image file and add to context
  const processImageFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const imageCount = chatContexts.filter((c) => c.type === "image").length;
    if (imageCount >= CHAT_MAX_IMAGES) return;
    if (file.size > CHAT_MAX_IMAGE_SIZE) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      const mediaType = file.type;

      addChatContext({
        type: "image",
        src: dataUrl,
        alt: file.name || "Pasted image",
        base64,
        mediaType,
      });
    };
    reader.readAsDataURL(file);
  };

  // Handle image files from AttachmentMenu
  const handleImageFilesFromMenu = (files: FileList) => {
    for (const file of Array.from(files)) {
      processImageFile(file);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!input.trim() && !hasContexts) || isStreaming) return;

    haptics.light();
    const message = input.trim();

    // Build contexts to send (images and selections)
    const contextsToSend =
      chatContexts.length > 0
        ? chatContexts.map((c) => {
            if (c.type === "image") {
              return {
                type: "image" as const,
                src: c.src,
                alt: c.alt,
                base64: c.base64,
                mediaType: c.mediaType,
              };
            }
            return { type: "selection" as const, text: c.text };
          })
        : null;

    // If there's pending selection from mobile layout, add it
    let messageForAI = message;
    if (hasSelection && pendingSelectionForAI) {
      messageForAI = message
        ? `${message}\n\n[Selected text for reference:]\n${pendingSelectionForAI}`
        : `Please help with the following text:\n\n"${pendingSelectionForAI}"`;
      clearPendingSelectionForAI();
    }

    setInput("");
    clearAllChatContexts();
    // Clear the visual block selection in editor when sending message
    clearBlockSelection();

    await sendMessage(messageForAI, currentFileId ? [currentFileId] : [], contextsToSend);
  };

  const handleMicPress = async () => {
    if (isRecording) {
      haptics.light();
      stopRecording();
    } else {
      haptics.medium();
      await startRecording();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    return `${seconds}s`;
  };

  const isProcessing = isStreaming || isRecording || isTranscribing;

  // Handle removing a context pill - also clear block selection if it's a selection context
  const handleRemoveContext = useCallback(
    (contextId: string) => {
      const context = chatContexts.find((c) => c.id === contextId);
      if (context?.type === "selection") {
        // Clear block selection when removing a selection context
        clearBlockSelection();
      }
      removeChatContext(contextId);
    },
    [chatContexts, removeChatContext, clearBlockSelection]
  );

  return (
    <div data-ai-input-area className="space-y-2">
      {/* Context Pills - show attached images and selected text */}
      <AnimatePresence>
        {hasContexts && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-1 overflow-hidden"
          >
            {chatContexts.map((ctx) => (
              <ContextPill key={ctx.id} context={ctx} onRemove={() => handleRemoveContext(ctx.id)} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pending selection preview (from block selection) */}
      <AnimatePresence>
        {hasSelection && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 overflow-hidden rounded-lg bg-accent/50 px-3 py-2"
          >
            <span className="flex-1 truncate text-xs text-muted-foreground">
              &quot;{pendingSelectionForAI?.slice(0, 50)}
              {pendingSelectionForAI && pendingSelectionForAI.length > 50 ? "..." : ""}&quot;
            </span>
            <button
              type="button"
              onClick={() => clearPendingSelectionForAI()}
              className="shrink-0 rounded p-1 hover:bg-accent"
            >
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input form */}
      <form onSubmit={handleSubmit} className="relative flex items-center gap-2">
        {/* Input container with animations */}
        <div className="relative flex-1">
          {/* Processing animation - gradient glow layer */}
          {isStreaming && (
            <div
              className={cn(
                "absolute inset-0 -m-[2px] rounded-full opacity-100 blur-[2px]",
                "bg-gradient-to-r from-primary via-primary/60 to-primary/40",
                "animate-gradient-xy"
              )}
            />
          )}

          {/* Processing animation - wave layer */}
          {isStreaming && <div className="absolute inset-0 rounded-full animate-border-wave" />}

          {/* Input field container */}
          <div
            className={cn(
              "relative z-10 flex items-center gap-1",
              "rounded-full bg-accent/80 backdrop-blur-sm",
              "border border-border/50",
              "transition-all duration-200",
              isStreaming && "border-primary/30"
            )}
          >
            {/* Attachment Menu (KB + Images) */}
            <AttachmentMenu
              conversationId={conversation?.id || ""}
              onImageSelect={handleImageFilesFromMenu}
              imageCount={currentImageCount}
              maxImages={CHAT_MAX_IMAGES}
              disabled={isStreaming}
              className="ml-1"
            />

            {/* Web Tools Settings */}
            <ChatSettings />

            {/* Text input */}
            <input
              ref={inputRef}
              type="text"
              value={isRecording ? formatDuration(duration) : input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isProcessing}
              placeholder={getPlaceholder()}
              className={cn(
                "flex-1 bg-transparent py-3 text-sm",
                "placeholder:text-muted-foreground/60",
                "focus:outline-none",
                "disabled:opacity-50",
                isRecording && "text-destructive font-medium"
              )}
            />

            {/* Microphone button */}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={handleMicPress}
              disabled={isStreaming || isTranscribing}
              className={cn(
                "h-8 w-8 shrink-0 rounded-full",
                isRecording && "bg-destructive text-destructive-foreground animate-pulse"
              )}
            >
              <Mic className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Send button */}
        <motion.div whileTap={{ scale: 0.95 }}>
          <Button
            type="submit"
            size="icon"
            disabled={(!input.trim() && !hasContexts && !hasSelection) || isStreaming}
            className={cn(
              "h-10 w-10 shrink-0 rounded-full shadow-md",
              "bg-primary text-primary-foreground",
              "disabled:opacity-50"
            )}
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </motion.div>

        {/* View chat button - always visible */}
        {onViewChat && (
          <motion.div whileTap={{ scale: 0.95 }}>
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => {
                haptics.light();
                onViewChat();
              }}
              className="h-10 w-10 shrink-0 rounded-full"
            >
              <MessageCircle className="h-4 w-4" />
            </Button>
          </motion.div>
        )}
      </form>
    </div>
  );
}
