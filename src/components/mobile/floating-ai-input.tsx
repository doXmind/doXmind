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
import { useTranslations } from "next-intl";
import { Send, Mic, Loader2, MessageCircle, X, AudioLines } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { AttachmentMenu } from "@/components/ai/attachment-menu";
import { ContextPill } from "@/components/ai/context-pill";
import { useChat } from "@/hooks/use-chat";
import { useFileStore } from "@/stores/file-store";
import { useChatContextStore } from "@/stores/chat-context-store";
import { useChatStore } from "@/stores/chat-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useBlockSelectionStore } from "@/stores/block-selection-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useVoiceRecording, useSpeechToText } from "@/hooks/use-voice-recording";
import { haptics } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { CHAT_MAX_IMAGES, CHAT_MAX_IMAGE_SIZE } from "@/lib/constants";

interface FloatingAIInputProps {
  onViewChat?: () => void;
}

export function FloatingAIInput({ onViewChat }: FloatingAIInputProps) {
  const t = useTranslations("mobile");
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { currentFileId } = useFileStore();
  const { conversations, loadConversation } = useChatStore();
  const { pendingSelectionForAI, clearPendingSelectionForAI } = useLayoutStore();
  const { sendMessage, isStreaming } = useChat();

  // Block selection store for mobile tap selection
  const {
    selectedBlocks,
    isSelectionActive,
    clearSelection: clearBlockSelection,
  } = useBlockSelectionStore();

  // Editor ref for copy/paste/delete operations
  const { editor } = useEditorRefStore();

  // Chat context (selected text, images)
  const { chatContexts, removeChatContext, clearAllChatContexts, addChatContext } =
    useChatContextStore();

  // Sync block selection with chat context
  // - Each selected block becomes its own context pill (section-level chunking)
  // - When blocks are unselected (tap again), remove the selection context
  useEffect(() => {
    const selectionContexts = chatContexts.filter((c) => c.type === "selection");

    if (isSelectionActive && selectedBlocks.length > 0) {
      // Check if existing contexts already match current block positions
      const existingPositions = new Set(selectionContexts.map((c) => `${c.from}-${c.to}`));
      const currentPositions = new Set(selectedBlocks.map((b) => `${b.from}-${b.to}`));
      const isMatch =
        existingPositions.size === currentPositions.size &&
        [...existingPositions].every((p) => currentPositions.has(p));

      if (!isMatch) {
        // Clear old selection contexts
        selectionContexts.forEach((c) => removeChatContext(c.id));
        // Add one context per selected block
        for (const block of selectedBlocks) {
          addChatContext({
            type: "selection",
            text: block.text,
            from: block.from,
            to: block.to,
          });
        }
        haptics.light();
      }
    } else if (!isSelectionActive && selectionContexts.length > 0) {
      // No blocks selected - remove all selection contexts
      selectionContexts.forEach((c) => removeChatContext(c.id));
    }
  }, [isSelectionActive, selectedBlocks, chatContexts, addChatContext, removeChatContext]);

  // Load conversation from backend when file changes (enables KB uploads)
  useEffect(() => {
    if (currentFileId) {
      loadConversation(currentFileId);
    }
  }, [currentFileId, loadConversation]);

  // Get conversation for attachment menu
  const conversationKey = currentFileId || "global";
  const conversation = conversations[conversationKey];

  // Speech-to-text hook
  const {
    isTranscribing,
    transcribe,
    reset: resetTranscription,
  } = useSpeechToText({
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
    if (isStreaming) return t("aiIsThinking");
    if (isRecording) return t("listening");
    if (isTranscribing) return t("transcribing");
    if (hasSelection) return t("editSelectedText");
    if (hasContexts) return t("askAboutAttached");
    return t("askAIAnything");
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
    resetTextareaHeight();
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

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize textarea — use 0px to get true content scrollHeight
    const textarea = e.target;
    textarea.style.height = "0px";
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
  };

  // Reset textarea height after submit
  const resetTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "24px";
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

  // Per-block copy
  const handleCopyBlock = useCallback(async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      haptics.light();
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, []);

  // Per-block delete
  const handleDeleteBlock = useCallback(
    (from: number, to: number) => {
      if (!editor) return;

      editor.chain().focus().setTextSelection({ from, to }).deleteSelection().run();

      haptics.medium();
      clearBlockSelection();
    },
    [editor, clearBlockSelection]
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
              <ContextPill
                key={ctx.id}
                context={ctx}
                onRemove={() => handleRemoveContext(ctx.id)}
                onCopy={ctx.type === "selection" ? () => handleCopyBlock(ctx.text) : undefined}
                onDelete={
                  ctx.type === "selection" ? () => handleDeleteBlock(ctx.from, ctx.to) : undefined
                }
                showActions={ctx.type === "selection"}
              />
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

      {/* Input form - ChatGPT style layout */}
      <form onSubmit={handleSubmit} className="relative flex items-end gap-3">
        {/* Plus button - separate from input */}
        <motion.div whileTap={{ scale: 0.95 }}>
          <AttachmentMenu
            conversationId={conversation?.isLoaded ? conversation.id : null}
            onImageSelect={handleImageFilesFromMenu}
            imageCount={currentImageCount}
            maxImages={CHAT_MAX_IMAGES}
            disabled={isStreaming || isRecording || isTranscribing}
            className="h-10 w-10 rounded-full bg-muted"
          />
        </motion.div>

        {/* Input container */}
        <div className="relative flex-1">
          {/* Processing animations */}
          {isStreaming && (
            <div
              className={cn(
                "absolute inset-0 -m-[2px] rounded-3xl opacity-100 blur-[2px]",
                "bg-gradient-to-r from-primary via-primary/60 to-primary/40",
                "animate-gradient-xy"
              )}
            />
          )}
          {isStreaming && <div className="animate-border-wave absolute inset-0 rounded-3xl" />}
          {isRecording && (
            <div
              className={cn(
                "absolute inset-0 -m-[2px] rounded-3xl blur-[3px]",
                "animate-pulse bg-destructive/60"
              )}
            />
          )}
          {isTranscribing && (
            <div
              className={cn(
                "absolute inset-0 -m-[2px] rounded-3xl blur-[2px]",
                "animate-pulse bg-primary/40"
              )}
            />
          )}

          {/* Input field container */}
          <div
            className={cn(
              "relative z-10 flex min-h-10 items-center",
              "rounded-3xl bg-muted",
              "border border-transparent",
              "transition-all duration-200",
              isStreaming && "border-primary/30",
              isRecording && "border-destructive/50 bg-destructive/10",
              isTranscribing && "border-primary/30 bg-primary/5"
            )}
          >
            {/* Text input area with inline indicators */}
            <div className="flex flex-1 items-center py-2 pl-4 pr-1">
              {/* Recording indicator - inline */}
              {isRecording && (
                <motion.span
                  className="mr-2 h-2.5 w-2.5 shrink-0 rounded-full bg-destructive"
                  animate={{ opacity: [1, 0.4, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
              )}

              {/* Transcribing indicator - inline */}
              {isTranscribing && (
                <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin text-primary" />
              )}

              {/* Text input */}
              <textarea
                ref={textareaRef}
                value={isRecording ? formatDuration(duration) : input}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                disabled={isProcessing}
                placeholder={getPlaceholder()}
                rows={1}
                style={{ height: input ? undefined : "24px" }}
                className={cn(
                  "max-h-[120px] flex-1 resize-none bg-transparent text-sm leading-6",
                  "placeholder:text-muted-foreground/60",
                  "focus:outline-none",
                  "disabled:opacity-50",
                  isRecording && "font-medium text-destructive",
                  isTranscribing && "font-medium text-primary"
                )}
              />
            </div>

            {/* Microphone button */}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={handleMicPress}
              disabled={isStreaming || isTranscribing}
              className={cn(
                "mr-1 h-8 w-8 shrink-0 rounded-full text-muted-foreground transition-colors",
                isRecording && "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              )}
            >
              {isRecording ? (
                <motion.div
                  animate={{ scale: [1, 1.15, 1] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                >
                  <AudioLines className="h-4 w-4" />
                </motion.div>
              ) : (
                <Mic className="h-4 w-4" />
              )}
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

        {/* View chat button - hidden during recording/transcribing to save space */}
        {onViewChat && !isRecording && !isTranscribing && (
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
