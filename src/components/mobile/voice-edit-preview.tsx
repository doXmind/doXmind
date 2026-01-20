"use client";

/**
 * Mobile AI Chat Sheet
 *
 * iOS-style draggable sheet for AI chat on mobile.
 * Similar to desktop ChatPanel but with:
 * - Drag to dismiss
 * - Microphone button for voice input
 * - Diff preview for pending changes
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence, PanInfo } from "framer-motion";
import { Send, Square, X, Sparkles, Mic, Check, Loader2, Trash2, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage } from "@/components/ai/chat-message";
import { ThinkingIndicator } from "@/components/ai/thinking-indicator";
import { ToolIndicator } from "@/components/ai/tool-indicator";
import { ContextPill } from "@/components/ai/context-pill";
import { AttachmentMenu } from "@/components/ai/attachment-menu";
import { ChatSettings } from "@/components/ai/chat-settings";
import { useDiffReviewStore } from "@/stores/diff-review-store";
import { useChatStore } from "@/stores/chat-store";
import { useFileStore } from "@/stores/file-store";
import { useEditorStore } from "@/stores/editor-store";
import { useChat } from "@/hooks/use-chat";
import { useVoiceRecording, useSpeechToText } from "@/hooks/use-voice-recording";
import type { ToolStatus, ThinkingStatus } from "@/hooks/use-chat";
import { haptics } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { Z_INDEX } from "@/lib/constants";
import { CHAT_MAX_IMAGES, CHAT_MAX_IMAGE_SIZE } from "@/lib/constants";

// Sheet snap points
const SNAP_COMPACT = "50%"; // Half screen
const SNAP_EXPANDED = "8%"; // Almost full screen

// Drag thresholds
const VELOCITY_THRESHOLD = 500;
const EXPAND_THRESHOLD = -80;
const CLOSE_THRESHOLD = 120;
const COLLAPSE_THRESHOLD = 80;

type SheetState = "compact" | "expanded";

interface MobileAIChatSheetProps {
  isOpen: boolean;
  /** Called when user closes the panel */
  onClose: () => void;
  /** Called when user accepts all edits */
  onAccept: () => void;
  /** Called when user rejects all edits */
  onReject: () => void;
  // These props are passed from parent for streaming state
  isStreaming: boolean;
  toolHistory: ToolStatus[];
  thinking: ThinkingStatus;
}

export function VoiceEditPreview({
  isOpen,
  onClose,
  onAccept,
  onReject,
  isStreaming: parentIsStreaming,
  toolHistory,
  thinking,
}: MobileAIChatSheetProps) {
  const [input, setInput] = useState("");
  const [sheetState, setSheetState] = useState<SheetState>("compact");
  const [isDragging, setIsDragging] = useState(false);
  const [isChangesExpanded, setIsChangesExpanded] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Stores
  const { diffSession, isReviewMode } = useDiffReviewStore();
  const { conversations, loadConversation, isLoadingHistory, clearConversation } = useChatStore();
  const { currentFileId } = useFileStore();
  const { chatContexts, removeChatContext, clearAllChatContexts, addChatContext } =
    useEditorStore();

  // Speech-to-text hook
  const {
    isTranscribing,
    transcribe,
    reset: resetTranscription,
  } = useSpeechToText({
    onComplete: (text) => {
      if (text) {
        setInput((prev) => (prev ? `${prev} ${text}` : text));
        setIsVoiceMode(false);
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
    error: recordingError,
    start: startRecording,
    stop: stopRecording,
    cancel: cancelRecording,
  } = useVoiceRecording({
    maxDuration: 60000,
    onStop: handleRecordingStop,
    onCancel: () => {
      resetTranscription();
      setIsVoiceMode(false);
    },
  });

  // Chat hook
  const { sendMessage, isStreaming: hookIsStreaming, stopStreaming } = useChat();
  const isStreaming = parentIsStreaming || hookIsStreaming;

  // Get conversation
  const conversationKey = currentFileId || "global";
  const conversation = useMemo(() => {
    return (
      conversations[conversationKey] || {
        id: conversationKey,
        fileId: currentFileId,
        messages: [],
        createdAt: new Date().toISOString(),
      }
    );
  }, [conversations, conversationKey, currentFileId]);

  // Load conversation history
  useEffect(() => {
    if (isOpen && currentFileId) {
      loadConversation(currentFileId);
    }
  }, [isOpen, currentFileId, loadConversation]);

  // Check for pending edits
  const hasChanges = isReviewMode && diffSession && diffSession.hunks.length > 0;
  const pendingHunks = diffSession?.hunks.filter((h) => h.status === "pending") || [];

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setSheetState("compact");
      setIsChangesExpanded(false);
    }
  }, [isOpen]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [isOpen, conversation.messages.length, isStreaming]);

  // Get snap position
  const getSnapPosition = (state: SheetState) => {
    return state === "expanded" ? SNAP_EXPANDED : SNAP_COMPACT;
  };

  // Handle drag
  const handleDragEnd = useCallback(
    (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      setIsDragging(false);
      const { offset, velocity } = info;

      if (sheetState === "compact") {
        if (offset.y < EXPAND_THRESHOLD || velocity.y < -VELOCITY_THRESHOLD) {
          haptics.light();
          setSheetState("expanded");
        } else if (offset.y > CLOSE_THRESHOLD || velocity.y > VELOCITY_THRESHOLD) {
          onClose();
        }
      } else {
        if (offset.y > COLLAPSE_THRESHOLD || velocity.y > VELOCITY_THRESHOLD) {
          haptics.light();
          setSheetState("compact");
        }
      }
    },
    [sheetState, onClose]
  );

  // Handle send message
  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isStreaming) return;

    const message = input.trim();
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

    setInput("");
    clearAllChatContexts();

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    await sendMessage(message, currentFileId ? [currentFileId] : [], contextsToSend);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  };

  // Handle image paste
  const processImageFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const imageCount = chatContexts.filter((c) => c.type === "image").length;
    if (imageCount >= CHAT_MAX_IMAGES) return;
    if (file.size > CHAT_MAX_IMAGE_SIZE) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      addChatContext({
        type: "image",
        src: dataUrl,
        alt: file.name || "Pasted image",
        base64,
        mediaType: file.type,
      });
    };
    reader.readAsDataURL(file);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) processImageFile(file);
      }
    }
  };

  const handleImageFilesFromMenu = (files: FileList) => {
    for (const file of Array.from(files)) {
      processImageFile(file);
    }
  };

  const currentImageCount = chatContexts.filter((c) => c.type === "image").length;

  // Voice recording handlers
  const handleVoiceStart = useCallback(async () => {
    setIsVoiceMode(true);
    setIsPressing(true);
    haptics.medium();
    await startRecording();
  }, [startRecording]);

  const handleVoiceEnd = useCallback(() => {
    setIsPressing(false);
    if (isRecording) {
      haptics.light();
      stopRecording();
    }
  }, [isRecording, stopRecording]);

  const handleVoiceCancel = useCallback(() => {
    setIsPressing(false);
    setIsVoiceMode(false);
    cancelRecording();
  }, [cancelRecording]);

  // Format recording duration
  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    return `${seconds}s`;
  };

  // Clear conversation handler
  const handleClear = useCallback(() => {
    if (conversation.messages.length > 0) {
      clearConversation(conversationKey);
    }
  }, [conversation.messages.length, clearConversation, conversationKey]);

  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/40 md:hidden"
            style={{ zIndex: Z_INDEX.MODAL - 1 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            className="fixed inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-2xl bg-background md:hidden"
            style={{
              zIndex: Z_INDEX.MODAL,
              top: getSnapPosition(sheetState),
            }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.1, bottom: 0.3 }}
            onDragStart={() => setIsDragging(true)}
            onDragEnd={handleDragEnd}
          >
            {/* Drag Handle */}
            <div
              className="flex cursor-grab items-center justify-center py-3 active:cursor-grabbing"
              style={{ touchAction: "none" }}
            >
              <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <span className="font-medium">AI Chat</span>
              </div>
              <div className="flex items-center gap-1">
                {conversation.messages.length > 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleClear}
                    className="h-8 w-8"
                    aria-label="Clear conversation"
                  >
                    <Trash2 className="h-5 w-5" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>

            {/* Messages Area */}
            <ScrollArea className="flex-1" style={{ pointerEvents: isDragging ? "none" : "auto" }}>
              <div className="space-y-4 p-4">
                {isLoadingHistory ? (
                  <div className="flex flex-col items-center justify-center py-8">
                    <Loader2 className="mb-4 h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Loading...</p>
                  </div>
                ) : conversation.messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8">
                    <Sparkles className="mb-4 h-8 w-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Ask me to help you write or edit
                    </p>
                  </div>
                ) : (
                  <>
                    {conversation.messages.map((message) => (
                      <ChatMessage key={message.id} message={message} />
                    ))}
                  </>
                )}

                {/* Thinking indicator */}
                {isStreaming && (thinking.isThinking || thinking.content) && (
                  <ThinkingIndicator thinking={thinking} />
                )}

                {/* Tool indicators */}
                {isStreaming && toolHistory.length > 0 && (
                  <div className="ml-11 space-y-1">
                    {toolHistory.map((tool, index) => (
                      <ToolIndicator key={`${tool.name}-${index}`} tool={tool} />
                    ))}
                  </div>
                )}

                {/* Diff Preview */}
                {hasChanges && !isStreaming && (
                  <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">Changes ({pendingHunks.length})</p>
                      {pendingHunks.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setIsChangesExpanded(!isChangesExpanded)}
                          className="text-xs text-primary"
                        >
                          {isChangesExpanded ? "Less" : "All"}
                        </button>
                      )}
                    </div>

                    {(isChangesExpanded ? pendingHunks : pendingHunks.slice(0, 1)).map(
                      (hunk, index) => (
                        <div key={hunk.id} className="space-y-2 text-xs">
                          {index > 0 && <div className="border-t border-border/50" />}
                          <div className="rounded border border-red-500/20 bg-red-500/5 p-2">
                            <p className="line-clamp-3 whitespace-pre-wrap">{hunk.oldContent}</p>
                          </div>
                          <div className="rounded border border-green-500/20 bg-green-500/5 p-2">
                            <p className="line-clamp-3 whitespace-pre-wrap">{hunk.newContent}</p>
                          </div>
                        </div>
                      )
                    )}

                    {/* Accept/Reject buttons */}
                    <div className="flex gap-2 pt-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={onReject}>
                        <X className="mr-1 h-4 w-4" />
                        Reject
                      </Button>
                      <Button size="sm" className="flex-1" onClick={onAccept}>
                        <Check className="mr-1 h-4 w-4" />
                        Accept
                      </Button>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Input Area */}
            <form
              onSubmit={handleSubmit}
              className="border-t border-border p-3"
              style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
            >
              {/* Context Pills */}
              {chatContexts.length > 0 && (
                <div className="mb-2 space-y-1">
                  {chatContexts.map((ctx) => (
                    <ContextPill
                      key={ctx.id}
                      context={ctx}
                      onRemove={() => removeChatContext(ctx.id)}
                    />
                  ))}
                </div>
              )}

              <div className="flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1.5">
                {/* Attachment menu */}
                <AttachmentMenu
                  conversationId={conversation.id}
                  onImageSelect={handleImageFilesFromMenu}
                  imageCount={currentImageCount}
                  maxImages={CHAT_MAX_IMAGES}
                  disabled={isStreaming || isRecording || isTranscribing}
                />

                {/* Web search toggle */}
                <ChatSettings />

                {/* Text input OR Hold to record button */}
                {isVoiceMode ? (
                  <motion.button
                    type="button"
                    className={cn(
                      "flex flex-1 items-center justify-center gap-2 rounded-md py-1.5 px-3",
                      "transition-all duration-150 select-none touch-none text-sm",
                      isRecording || isPressing
                        ? "bg-destructive text-destructive-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                    onTouchStart={(e) => {
                      e.preventDefault();
                      if (!isRecording && !isTranscribing) handleVoiceStart();
                    }}
                    onTouchEnd={(e) => {
                      e.preventDefault();
                      handleVoiceEnd();
                    }}
                    onTouchCancel={handleVoiceCancel}
                    onMouseDown={() => {
                      if (!isRecording && !isTranscribing) handleVoiceStart();
                    }}
                    onMouseUp={handleVoiceEnd}
                    onMouseLeave={() => {
                      if (isRecording || isPressing) handleVoiceCancel();
                    }}
                    animate={{ scale: isRecording || isPressing ? 0.98 : 1 }}
                    transition={{ duration: 0.1 }}
                  >
                    {isTranscribing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Transcribing...</span>
                      </>
                    ) : isRecording ? (
                      <>
                        <span className="h-2 w-2 animate-pulse rounded-full bg-destructive-foreground" />
                        <span>{formatDuration(duration)} - Release to send</span>
                      </>
                    ) : (
                      <>
                        <Mic className="h-4 w-4" />
                        <span>Hold to talk</span>
                      </>
                    )}
                  </motion.button>
                ) : (
                  <Textarea
                    ref={textareaRef}
                    value={input}
                    onChange={handleTextareaChange}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder="Ask AI..."
                    className="max-h-[120px] min-h-[24px] flex-1 resize-none border-0 bg-transparent px-1 py-1 text-base focus-visible:ring-0 focus-visible:ring-offset-0"
                    disabled={isStreaming}
                    rows={1}
                  />
                )}

                {/* Toggle voice/text mode OR cancel */}
                {isVoiceMode ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={handleVoiceCancel}
                    disabled={isTranscribing}
                    className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setIsVoiceMode(true)}
                    disabled={isStreaming}
                    className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <Mic className="h-4 w-4" />
                  </Button>
                )}

                {/* Send/Stop button */}
                {isStreaming ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={stopStreaming}
                    className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <Square className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="icon"
                    variant="default"
                    disabled={isVoiceMode || (!input.trim() && chatContexts.length === 0)}
                    className="h-7 w-7 flex-shrink-0"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
