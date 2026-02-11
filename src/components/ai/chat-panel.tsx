"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Trash2, Loader2, Mic, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { Tooltip } from "@/components/ui/tooltip";
import {
  ChatMessage,
  ChatMessageList,
  ChatFeedbackToolbar,
  ChatToolSteps,
  ChatThinking,
  ChatComposer,
  ChatEmptyState,
} from "@/components/chat";
import { TodoProgress } from "./todo-progress";
import { ContextPill } from "./context-pill";
import { AttachmentMenu } from "./attachment-menu";
import { ChatSettings } from "./chat-settings";
import { useChatStore } from "@/stores/chat-store";
import { useFileStore } from "@/stores/file-store";
import { useChatContextStore } from "@/stores/chat-context-store";
import { useDataFilesStore, isDataFile, isKBFile } from "@/stores/data-files-store";
import { useKBStore } from "@/stores/kb-store";
import { useChat } from "@/hooks/use-chat";
import { useVoiceRecording, useSpeechToText } from "@/hooks/use-voice-recording";
import { useIsMobile } from "@/hooks/use-device-type";
import { haptics } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { CHAT_MAX_IMAGES, CHAT_MAX_IMAGE_SIZE } from "@/lib/constants";
import { useOnboardingStore } from "@/stores/onboarding-store";

interface ChatPanelProps {
  isDemoMode?: boolean;
}

const SUGGESTIONS = [
  { label: "Write a report", prompt: "Help me write a report" },
  { label: "Improve writing style", prompt: "Help me improve the writing style" },
  { label: "Summarize document", prompt: "Summarize this document" },
  { label: "Brainstorm ideas", prompt: "Help me brainstorm ideas" },
];

const ONBOARDING_SUGGESTIONS = [
  { label: "Improve my writing", prompt: "Review and improve the current document" },
  { label: "Summarize this", prompt: "Summarize the key points of this document" },
  { label: "Continue writing", prompt: "Continue writing from where I left off" },
  { label: "What can you do?", prompt: "What are all the things you can help me with?" },
];

export function ChatPanel({ isDemoMode = false }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragCounterRef = useRef(0);

  const isMobile = useIsMobile();
  const { currentFileId } = useFileStore();
  const { conversations, clearConversation, loadConversation, isLoadingHistory } = useChatStore();
  const { checklist } = useOnboardingStore();
  const chatSuggestions = checklist.triedAIChat ? SUGGESTIONS : ONBOARDING_SUGGESTIONS;

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

  // Chat context store for "Ask in Chat" feature (Context Pills)
  const { chatContexts, removeChatContext, clearAllChatContexts, addChatContext } =
    useChatContextStore();

  // Data files store for code execution
  const { uploadDataFile, getDataFiles } = useDataFilesStore();

  // KB store for document uploads
  const { uploadAttachments: uploadKBFiles } = useKBStore();

  // Get conversation key without triggering store updates during render
  const effectiveFileId = isDemoMode ? "demo-file" : currentFileId;
  const conversationKey = effectiveFileId || "global";
  const conversation = useMemo(() => {
    return (
      conversations[conversationKey] || {
        id: conversationKey,
        fileId: effectiveFileId,
        messages: [],
        createdAt: new Date().toISOString(),
      }
    );
  }, [conversations, conversationKey, effectiveFileId]);

  const { sendMessage, isStreaming, stopStreaming, currentTool, toolHistory, thinking, todos } =
    useChat();

  // Load conversation history from backend when file changes
  useEffect(() => {
    if (currentFileId && !isDemoMode) {
      loadConversation(currentFileId);
    }
  }, [currentFileId, isDemoMode, loadConversation]);

  // Focus textarea when chat context is added
  useEffect(() => {
    if (chatContexts.length > 0 && textareaRef.current && window.innerWidth >= 768) {
      textareaRef.current.focus();
    }
  }, [chatContexts.length]);

  const handleSubmit = async () => {
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

    const dataFilesForConversation =
      conversation.isLoaded && conversation.id ? getDataFiles(conversation.id) : [];
    const dataFileIdsToSend = dataFilesForConversation
      .filter((f) => f.status === "ready")
      .map((f) => f.id);

    setInput("");
    clearAllChatContexts();

    await sendMessage(
      message,
      effectiveFileId ? [effectiveFileId] : [],
      contextsToSend,
      dataFileIdsToSend
    );
  };

  const handleClear = () => {
    if (conversation.messages.length > 0) {
      setShowClearModal(true);
    }
  };

  const handleClearConfirm = () => {
    clearConversation(conversationKey);
    setShowClearModal(false);
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

  const formatDuration = (ms: number) => `${Math.floor(ms / 1000)}s`;

  const currentImageCount = chatContexts.filter((c) => c.type === "image").length;

  // Process image file and add to context
  const processImageFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) return;
      const imageCount = chatContexts.filter((c) => c.type === "image").length;
      if (imageCount >= CHAT_MAX_IMAGES) return;
      if (file.size > CHAT_MAX_IMAGE_SIZE) return;

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        addChatContext({
          type: "image",
          src: dataUrl,
          alt: file.name || "Pasted image",
          base64: dataUrl.split(",")[1],
          mediaType: file.type,
        });
      };
      reader.readAsDataURL(file);
    },
    [chatContexts, addChatContext]
  );

  const handleImageFilesFromMenu = (files: FileList) => {
    for (const file of Array.from(files)) {
      processImageFile(file);
    }
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

  // Drag-and-drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);

      if (!conversation.isLoaded || !conversation.id) return;

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      const kbFiles: File[] = [];
      const dataFilesToUpload: File[] = [];
      const imageFiles: File[] = [];

      for (const file of files) {
        const filename = file.name.toLowerCase();
        if (isKBFile(filename)) {
          kbFiles.push(file);
        } else if (isDataFile(filename)) {
          if (file.type.startsWith("image/")) {
            if (file.size <= CHAT_MAX_IMAGE_SIZE) imageFiles.push(file);
            else dataFilesToUpload.push(file);
          } else {
            dataFilesToUpload.push(file);
          }
        }
      }

      if (kbFiles.length > 0) await uploadKBFiles(conversation.id, kbFiles);
      for (const file of dataFilesToUpload) await uploadDataFile(conversation.id, file);
      for (const file of imageFiles) processImageFile(file);
    },
    [conversation.isLoaded, conversation.id, uploadKBFiles, uploadDataFile, processImageFile]
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="chat-header-desktop hidden items-center justify-between border-b border-border/60 px-4 py-2.5 md:flex">
        <span className="text-xs font-semibold text-foreground">AI Assistant</span>
        {conversation.messages.length > 0 && (
          <Tooltip content="Clear conversation" side="bottom">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClear}
              className="h-7 w-7 text-muted-foreground"
              aria-label="Clear conversation"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </Tooltip>
        )}
      </div>

      {/* Messages */}
      <ChatMessageList
        className="p-3 md:p-4"
        scrollDeps={[conversation.messages, currentTool, toolHistory, thinking, todos]}
      >
        {isLoadingHistory ? (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center">
            <Loader2 className="mb-4 h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading conversation history...</p>
          </div>
        ) : conversation.messages.length === 0 ? (
          <ChatEmptyState
            greeting="How can I help?"
            subtitle="Ask me to write, edit, or improve your document."
            suggestions={chatSuggestions}
            onSelectSuggestion={setInput}
          />
        ) : (
          <div className="space-y-1">
            {conversation.messages.map((message, index) => {
              const userPrompt =
                message.role === "assistant"
                  ? conversation.messages
                      .slice(0, index)
                      .reverse()
                      .find((m) => m.role === "user")?.content
                  : undefined;

              return (
                <ChatMessage
                  key={message.id}
                  role={message.role as "user" | "assistant"}
                  content={message.content}
                  isStreaming={message.isStreaming}
                  contexts={message.contexts ?? undefined}
                >
                  {/* Feedback toolbar for completed AI messages */}
                  {message.role === "assistant" &&
                    !message.isStreaming &&
                    message.content &&
                    conversation.id && (
                      <ChatFeedbackToolbar
                        messageId={message.id}
                        conversationId={conversation.id || ""}
                        content={message.content}
                        userPrompt={userPrompt}
                        aiResponse={message.content}
                        fileId={message.fileIds?.[0]}
                        model={message.model ?? undefined}
                        hadToolCalls={!!(message.toolCalls && message.toolCalls.length > 0)}
                      />
                    )}
                </ChatMessage>
              );
            })}

            {/* Thinking indicator */}
            {isStreaming && (thinking.isThinking || thinking.content) && (
              <div className="pl-7">
                <ChatThinking thinking={thinking} />
              </div>
            )}

            {/* Tool steps */}
            {isStreaming && toolHistory.length > 0 && (
              <div className="pl-7">
                <ChatToolSteps tools={toolHistory} collapseThreshold={isMobile ? 1 : 2} />
              </div>
            )}

            {/* TODO progress */}
            {todos.length > 0 && (
              <div className="pl-7">
                <TodoProgress todos={todos} />
              </div>
            )}
          </div>
        )}
      </ChatMessageList>

      {/* Input area */}
      <div className="p-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
        {/* Voice recording mode */}
        {isVoiceMode ? (
          <div className="flex flex-col items-center gap-3 py-2">
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
              {recordingError && <span className="text-xs text-destructive">{recordingError}</span>}
            </div>

            {!isTranscribing && (
              <motion.button
                type="button"
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-full px-6 py-3",
                  "touch-none select-none transition-all duration-150",
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

            <button
              type="button"
              onClick={handleVoiceCancel}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <ChatComposer
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            onStop={stopStreaming}
            isStreaming={isStreaming}
            placeholder="Ask AI anything..."
            showHint
            onPaste={handlePaste}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            isDragging={isDragging}
            contextSlot={
              chatContexts.length > 0 ? (
                <div className="mb-2 space-y-1">
                  {chatContexts.map((ctx) => (
                    <ContextPill
                      key={ctx.id}
                      context={ctx}
                      onRemove={() => removeChatContext(ctx.id)}
                    />
                  ))}
                </div>
              ) : undefined
            }
            leftActions={
              <>
                <AttachmentMenu
                  conversationId={conversation.isLoaded ? conversation.id : null}
                  onImageSelect={handleImageFilesFromMenu}
                  imageCount={currentImageCount}
                  maxImages={CHAT_MAX_IMAGES}
                  disabled={isStreaming}
                />
                <ChatSettings />
                {/* Mobile-only: Clear conversation */}
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
              </>
            }
            extraActions={
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
            }
          />
        )}
      </div>

      {/* Clear Conversation Confirmation Modal */}
      <Modal open={showClearModal} onClose={() => setShowClearModal(false)}>
        <ModalHeader onClose={() => setShowClearModal(false)}>
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Clear conversation?
          </span>
        </ModalHeader>
        <p className="text-sm text-muted-foreground">
          All messages in this conversation will be permanently deleted. This action cannot be
          undone.
        </p>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowClearModal(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleClearConfirm}>
            Clear
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
