"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Send, Square, Trash2, Sparkles, Loader2, Mic } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip } from "@/components/ui/tooltip";
import { ChatMessage } from "./chat-message";
import { ThinkingIndicator } from "./thinking-indicator";
import { ToolIndicator } from "./tool-indicator";
import { TodoProgress } from "./todo-progress";
import { ContextPill } from "./context-pill";
import { SuggestionButton } from "./suggestion-button";
import { AttachmentMenu } from "./attachment-menu";
import { ChatSettings } from "./chat-settings";
import { useChatStore } from "@/stores/chat-store";
import { useFileStore } from "@/stores/file-store";
import { useEditorStore } from "@/stores/editor-store";
import { useChat } from "@/hooks/use-chat";
import { useVoiceRecording, useSpeechToText } from "@/hooks/use-voice-recording";
import { haptics } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { CHAT_MAX_IMAGES, CHAT_MAX_IMAGE_SIZE } from "@/lib/constants";

export function ChatPanel() {
  const [input, setInput] = useState("");
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { currentFileId } = useFileStore();
  const { conversations, clearConversation, loadConversation, isLoadingHistory } = useChatStore();

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

  // Import editor store for chat context feature (Context Pills)
  const { chatContexts, removeChatContext, clearAllChatContexts, addChatContext } =
    useEditorStore();

  // Get conversation key without triggering store updates during render
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

  const { sendMessage, isStreaming, stopStreaming, currentTool, toolHistory, thinking, todos } =
    useChat();

  // Load conversation history from backend when file changes
  useEffect(() => {
    if (currentFileId) {
      loadConversation(currentFileId);
    }
  }, [currentFileId, loadConversation]);

  // Focus textarea when chat context is added (from Quick Edit "Ask in Chat")
  // Only on desktop to avoid keyboard popup on mobile
  useEffect(() => {
    if (chatContexts.length > 0 && textareaRef.current && window.innerWidth >= 768) {
      textareaRef.current.focus();
    }
  }, [chatContexts.length]);

  const scrollToBottom = () => {
    // Use scrollTop for more reliable scrolling on mobile
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current;
      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior: "smooth",
      });
    } else {
      // Fallback to scrollIntoView
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [conversation.messages, currentTool, toolHistory, thinking, todos]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isStreaming) return;

    const message = input.trim();
    // Pass contexts as a separate parameter (for display), not concatenated to message
    // Include base64 and mediaType for image contexts to enable multimodal API
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
    clearAllChatContexts(); // Clear all contexts after sending

    // Auto-resize textarea back
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
    // Auto-resize
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
  };

  const handleClear = () => {
    if (conversation.messages.length > 0) {
      // Use conversationKey (fileId or "global") instead of conversation.id (backend UUID)
      // because the local state uses conversationKey as the key
      clearConversation(conversationKey);
    }
  };

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

  const currentImageCount = chatContexts.filter((c) => c.type === "image").length;

  // Process image file and add to context
  const processImageFile = (file: File) => {
    // Only accept image files
    if (!file.type.startsWith("image/")) return;

    // Check image count limit
    const imageCount = chatContexts.filter((c) => c.type === "image").length;
    if (imageCount >= CHAT_MAX_IMAGES) {
      return;
    }

    // Check file size (5MB limit for Anthropic API)
    if (file.size > CHAT_MAX_IMAGE_SIZE) {
      return;
    }

    // Convert to base64
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      const mediaType = file.type;

      addChatContext({
        type: "image",
        src: dataUrl, // Data URL for preview display
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

  // Handle paste event for images
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          processImageFile(file);
        }
      }
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header - Hidden on mobile (title shown in mobile header) */}
      <div className="chat-header-desktop hidden items-center justify-between border-b border-border p-3 md:flex">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">AI Assistant</h2>
        </div>
        <div className="flex items-center gap-1">
          {/* Clear conversation button */}
          {conversation.messages.length > 0 && (
            <Tooltip content="Clear conversation" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClear}
                aria-label="Clear conversation"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Mobile Header Actions - removed, now in input bar */}

      {/* Messages */}
      <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1 p-4">
        {isLoadingHistory ? (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center">
            <Loader2 className="mb-4 h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading conversation history...</p>
          </div>
        ) : conversation.messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center">
            <Sparkles className="mb-4 h-8 w-8 text-muted-foreground" />
            <h3 className="mb-2 font-medium">Start a conversation</h3>
            <p className="max-w-[250px] text-sm text-muted-foreground">
              Ask me to help you write, edit, or improve your document.
            </p>
            <div className="mt-4 w-full space-y-2">
              <SuggestionButton onClick={() => setInput("Help me write a report")}>
                Write a report
              </SuggestionButton>
              <SuggestionButton onClick={() => setInput("Help me improve the writing style")}>
                Improve writing style
              </SuggestionButton>
              <SuggestionButton onClick={() => setInput("Summarize this document")}>
                Summarize document
              </SuggestionButton>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {conversation.messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}

            {/* Thinking indicator - shown during streaming */}
            {isStreaming && (thinking.isThinking || thinking.content) && (
              <ThinkingIndicator thinking={thinking} />
            )}

            {/* Tool indicators - shown during streaming */}
            {isStreaming && toolHistory.length > 0 && (
              <div className="ml-11 space-y-1">
                {toolHistory.map((tool, index) => (
                  <ToolIndicator key={`${tool.name}-${index}`} tool={tool} />
                ))}
              </div>
            )}

            {/* TODO progress - shown when agent is tracking tasks */}
            {todos.length > 0 && (
              <div className="ml-11">
                <TodoProgress todos={todos} />
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input - with safe area padding on mobile */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-border p-3 md:p-3"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        {/* Context Pills - shows attached images and selected text */}
        {chatContexts.length > 0 && (
          <div className="mb-2 space-y-1">
            {chatContexts.map((ctx) => (
              <ContextPill key={ctx.id} context={ctx} onRemove={() => removeChatContext(ctx.id)} />
            ))}
          </div>
        )}

        {/* Voice recording mode - WeChat style */}
        {isVoiceMode ? (
          <div className="flex flex-col items-center gap-3 py-2">
            {/* Recording status */}
            <div className="flex items-center gap-2 text-sm">
              {isRecording && (
                <>
                  <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
                  <span className="text-muted-foreground">{formatDuration(duration)}</span>
                </>
              )}
              {isTranscribing && (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-muted-foreground">Transcribing...</span>
                </>
              )}
              {recordingError && (
                <span className="text-destructive text-xs">{recordingError}</span>
              )}
            </div>

            {/* Press-and-hold button */}
            {!isTranscribing && (
              <motion.button
                type="button"
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-full py-3 px-6",
                  "transition-all duration-150 select-none touch-none",
                  isRecording || isPressing
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-muted text-muted-foreground"
                )}
                onTouchStart={(e) => {
                  e.preventDefault();
                  if (!isRecording) handleVoiceStart();
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  handleVoiceEnd();
                }}
                onTouchCancel={handleVoiceCancel}
                onMouseDown={() => {
                  if (!isRecording) handleVoiceStart();
                }}
                onMouseUp={handleVoiceEnd}
                onMouseLeave={() => {
                  if (isRecording || isPressing) handleVoiceCancel();
                }}
                animate={{ scale: isRecording || isPressing ? 0.98 : 1 }}
                transition={{ duration: 0.1 }}
              >
                <Mic className={cn("h-5 w-5", isRecording && "animate-pulse")} />
                <span className="text-sm font-medium">
                  {isRecording ? "Release to send" : "Hold to talk"}
                </span>
              </motion.button>
            )}

            {/* Cancel button */}
            <button
              type="button"
              onClick={handleVoiceCancel}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="relative flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1.5">
            {/* Unified attachment menu */}
            <AttachmentMenu
              conversationId={conversation.id}
              onImageSelect={handleImageFilesFromMenu}
              imageCount={currentImageCount}
              maxImages={CHAT_MAX_IMAGES}
              disabled={isStreaming}
            />

            {/* Web tools settings */}
            <ChatSettings />

            {/* Mobile-only: Clear conversation button in input bar */}
            {conversation.messages.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClear}
                className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-foreground md:hidden"
                aria-label="Clear conversation"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}

            <Textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Ask AI anything..."
              className="max-h-[200px] min-h-[24px] flex-1 resize-none border-0 bg-transparent px-1 py-1 text-base md:text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
              disabled={isStreaming}
              rows={1}
            />

            {/* Mobile-only: Microphone button */}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => setIsVoiceMode(true)}
              disabled={isStreaming}
              className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-foreground md:hidden"
              aria-label="Voice input"
            >
              <Mic className="h-4 w-4" />
            </Button>

            {/* Send/Stop button */}
            {isStreaming ? (
              <Tooltip content="Stop generating" side="top">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={stopStreaming}
                  className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="Stop generating"
                >
                  <Square className="h-4 w-4" />
                </Button>
              </Tooltip>
            ) : (
              <Tooltip content="Send message" side="top">
                <Button
                  type="submit"
                  size="icon"
                  variant="default"
                  disabled={!input.trim() && chatContexts.length === 0}
                  className="h-7 w-7 flex-shrink-0"
                  aria-label="Send message"
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </Tooltip>
            )}
          </div>
        )}

        <p className="mt-2 hidden text-center text-xs text-muted-foreground md:block">
          Press Enter to send, Shift+Enter for new line
        </p>
      </form>
    </div>
  );
}
