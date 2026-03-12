"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  Trash2,
  Loader2,
  AlertTriangle,
  SquarePen,
  PanelRight,
  AppWindow,
  Minus,
  Check,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
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
import { PanelSubHeader } from "@/components/ui/panel-sub-header";
import { useLayoutStore } from "@/stores/layout-store";
import { useChatStore } from "@/stores/chat-store";
import { useFileStore } from "@/stores/file-store";
import { useChatContextStore } from "@/stores/chat-context-store";
import { useDataFilesStore, isDataFile, isKBFile } from "@/stores/data-files-store";
import { useKBStore } from "@/stores/kb-store";
import { useBillingStore } from "@/stores/billing-store";
import { useChat } from "@/hooks/use-chat";
import { useMentionTrigger } from "@/hooks/use-mention-trigger";
import { MentionDropdown } from "@/components/chat/mention-dropdown";
import { useKBPollingCleanup } from "@/hooks/use-kb-polling-cleanup";
import { useDataFilePollingCleanup } from "@/hooks/use-data-file-polling-cleanup";
import { useIsMobile } from "@/hooks/use-device-type";
import { useTranslations } from "next-intl";
import { CHAT_MAX_IMAGES, CHAT_MAX_IMAGE_SIZE } from "@/lib/constants";
import { eventBus } from "@/lib/events";

interface ChatPanelProps {
  isDemoMode?: boolean;
}

export function ChatPanel({ isDemoMode = false }: ChatPanelProps) {
  const t = useTranslations("chat");
  const tc = useTranslations("common");
  const tSafe = useCallback(
    (key: string, fallback: string) => {
      try {
        return t(key);
      } catch {
        return fallback;
      }
    },
    [t]
  );

  const SUGGESTIONS = [
    {
      label: t("writeReport"),
      prompt: tSafe("suggestionPromptWriteReport", "Help me write a report"),
    },
    {
      label: t("improveStyle"),
      prompt: tSafe("suggestionPromptImproveStyle", "Help me improve the writing style"),
    },
    {
      label: t("summarize"),
      prompt: tSafe("suggestionPromptSummarize", "Summarize this document"),
    },
    {
      label: t("brainstorm"),
      prompt: tSafe("suggestionPromptBrainstorm", "Help me brainstorm ideas"),
    },
  ];

  const [input, setInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragCounterRef = useRef(0);

  const isMobile = useIsMobile();
  const currentFileId = useFileStore((s) => s.currentFileId);
  const clearConversation = useChatStore((s) => s.clearConversation);
  const loadConversation = useChatStore((s) => s.loadConversation);
  const isLoadingHistory = useChatStore((s) => s.isLoadingHistory);
  const chatSuggestions = SUGGESTIONS;

  // Chat context store for "Ask in Chat" feature (Context Pills)
  const chatContexts = useChatContextStore((s) => s.chatContexts);
  const removeChatContext = useChatContextStore((s) => s.removeChatContext);
  const clearAllChatContexts = useChatContextStore((s) => s.clearAllChatContexts);
  const addChatContext = useChatContextStore((s) => s.addChatContext);
  const consumePendingInput = useChatContextStore((s) => s.consumePendingInput);

  // Data files store for code execution
  const uploadDataFile = useDataFilesStore((s) => s.uploadDataFile);
  const getDataFiles = useDataFilesStore((s) => s.getDataFiles);
  const loadDataFiles = useDataFilesStore((s) => s.loadDataFiles);

  // KB store for document uploads
  const uploadKBFiles = useKBStore((s) => s.uploadAttachments);

  // Credits lock
  const isAILocked = useBillingStore((s) => s.isAILocked)();

  // Subscribe to only the current conversation via selector (immer ensures
  // other conversations' changes don't create a new reference here).
  const effectiveFileId = isDemoMode ? "demo-file" : currentFileId;
  const conversationKey = effectiveFileId || "global";
  const storeConversation = useChatStore((s) => s.conversations[conversationKey]);
  const conversation = useMemo(
    () =>
      storeConversation || {
        id: conversationKey,
        fileId: effectiveFileId,
        messages: [] as never[],
        createdAt: new Date().toISOString(),
      },
    [storeConversation, conversationKey, effectiveFileId]
  );

  const {
    sendMessage,
    regenerateLastResponse,
    resendLastUserMessage,
    editAndResend,
    isStreaming,
    stopStreaming,
    currentTool,
    toolHistory,
    thinking,
    todos,
  } = useChat();

  // @ mention trigger for referencing files in chat
  const mention = useMentionTrigger(
    input,
    setInput,
    textareaRef,
    conversation.isLoaded && conversation.id ? conversation.id : null
  );

  // Clean up polling intervals when chat panel unmounts
  useKBPollingCleanup(conversation.id || null);
  useDataFilePollingCleanup(conversation.id || null);

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

  // Consume pending input (e.g. from "Analyze with AI" database toolbar button)
  useEffect(() => {
    const pending = consumePendingInput();
    if (pending) {
      setInput(pending);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [consumePendingInput]);

  // Refresh data files when a database block is deleted (its data files are cascade-deleted)
  useEffect(() => {
    return eventBus.on("database:deleted", () => {
      if (conversationKey) {
        loadDataFiles(conversationKey);
      }
    });
  }, [conversationKey, loadDataFiles]);

  const handleSubmit = async () => {
    if (!input.trim() || isStreaming) return;

    // Replace @displayName with @[displayName](fileid:id) so the backend
    // receives file IDs inline and the frontend can render styled tags.
    let message = input.trim();
    for (const ctx of chatContexts) {
      if (ctx.type === "file_mention") {
        message = message.replaceAll(
          `@${ctx.fileName}`,
          `@[${ctx.fileName}](fileid:${ctx.fileId})`
        );
      }
    }

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
            if (c.type === "file_mention") {
              return {
                type: "file_mention" as const,
                fileId: c.fileId,
                fileName: c.fileName,
                fileSource: c.fileSource,
              };
            }
            if (c.type === "inline_result") {
              return { type: "selection" as const, text: c.text };
            }
            return { type: "selection" as const, text: c.text };
          })
        : null;

    // Only send the currently-open file. Mentioned documents are communicated
    // via <referenced_files> XML in the message — the agent reads them from DB.
    const fileIds = effectiveFileId ? [effectiveFileId] : [];

    // Collect data file IDs: conversation data files + mentioned data files
    const fileMentions = chatContexts.filter((c) => c.type === "file_mention");
    const dataFilesForConversation =
      conversation.isLoaded && conversation.id ? getDataFiles(conversation.id) : [];
    const dataFileIdsToSend = dataFilesForConversation
      .filter((f) => f.status === "ready")
      .map((f) => f.id);
    for (const m of fileMentions) {
      if (
        m.type === "file_mention" &&
        m.fileSource === "data_file" &&
        !dataFileIdsToSend.includes(m.fileId)
      ) {
        dataFileIdsToSend.push(m.fileId);
      }
    }

    setInput("");
    clearAllChatContexts();

    await sendMessage(message, fileIds, contextsToSend, dataFileIdsToSend);
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
      <PanelSubHeader className="chat-header-desktop hidden justify-between md:flex">
        <span className="text-xs font-medium text-muted-foreground">{t("aiChat")}</span>
        <div className="flex items-center gap-0.5">
          {/* New chat / clear */}
          <Tooltip content={t("newChat")} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClear}
              disabled={conversation.messages.length === 0}
              className="h-6 w-6 text-muted-foreground"
              aria-label={t("newChat")}
            >
              <SquarePen className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          {/* Mode toggle: click to switch, right-click for dropdown */}
          <DropdownMenu open={modeMenuOpen} onOpenChange={setModeMenuOpen}>
            <Tooltip
              content={
                useLayoutStore.getState().chatMode === "sidebar"
                  ? t("switchToFloating")
                  : t("switchToSidebar")
              }
              side="bottom"
            >
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground"
                  aria-label={t("switchChatMode")}
                  onClick={(e) => {
                    e.preventDefault();
                    const store = useLayoutStore.getState();
                    store.setChatMode(store.chatMode === "sidebar" ? "floating" : "sidebar");
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setModeMenuOpen(true);
                  }}
                >
                  {useLayoutStore.getState().chatMode === "sidebar" ? (
                    <PanelRight className="h-3.5 w-3.5" />
                  ) : (
                    <AppWindow className="h-3.5 w-3.5" />
                  )}
                </Button>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent align="end" side="bottom" sideOffset={4}>
              <DropdownMenuItem onClick={() => useLayoutStore.getState().setChatMode("sidebar")}>
                <PanelRight className="mr-2 h-3.5 w-3.5" />
                {t("sidebarMode")}
                {useLayoutStore.getState().chatMode === "sidebar" && (
                  <Check className="ml-auto h-3.5 w-3.5" />
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => useLayoutStore.getState().setChatMode("floating")}>
                <AppWindow className="mr-2 h-3.5 w-3.5" />
                {t("floatingMode")}
                {useLayoutStore.getState().chatMode === "floating" && (
                  <Check className="ml-auto h-3.5 w-3.5" />
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Close / minimize */}
          <Tooltip content={tc("close")} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => useLayoutStore.getState().toggleChat()}
              className="h-6 w-6 text-muted-foreground"
              aria-label={t("closeAIChat")}
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
        </div>
      </PanelSubHeader>

      {/* Messages */}
      <ChatMessageList
        className="p-3 md:p-4"
        scrollDeps={[conversation.messages, currentTool, toolHistory, thinking, todos]}
      >
        {isLoadingHistory ? (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center">
            <Loader2 className="mb-4 h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("loadingHistory")}</p>
          </div>
        ) : conversation.messages.length === 0 ? (
          <ChatEmptyState
            greeting={t("howCanIHelp")}
            subtitle={t("askToEdit")}
            suggestions={chatSuggestions}
            onSelectSuggestion={setInput}
          />
        ) : (
          <div className="space-y-1">
            {conversation.messages.map((message, index) => {
              const isLast = index === conversation.messages.length - 1;
              const isLastAssistant = isLast && message.role === "assistant";
              const isLastUserWithNoReply = isLast && message.role === "user" && !isStreaming;
              const isEditable = message.role === "user" && !isStreaming;

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
                  quickEdit={message.quickEdit ?? undefined}
                  isEditable={isEditable}
                  onEdit={(newContent) =>
                    editAndResend(message.id, newContent, effectiveFileId ? [effectiveFileId] : [])
                  }
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
                        onRegenerate={
                          isLastAssistant
                            ? () => regenerateLastResponse(effectiveFileId ? [effectiveFileId] : [])
                            : undefined
                        }
                        isLastMessage={isLastAssistant}
                        isStreaming={isStreaming}
                      />
                    )}

                  {/* Resend button for last user message (no AI response yet) */}
                  {isLastUserWithNoReply && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() =>
                          resendLastUserMessage(effectiveFileId ? [effectiveFileId] : [])
                        }
                        className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <RefreshCw className="h-3 w-3" />
                        {t("resend")}
                      </button>
                    </div>
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
        <ChatComposer
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          onStop={stopStreaming}
          isStreaming={isStreaming}
          disabled={isAILocked}
          placeholder={isAILocked ? t("creditsExhausted") : t("placeholder")}
          showHint
          onPaste={handlePaste}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          isDragging={isDragging}
          textareaRef={textareaRef}
          onKeyDownIntercept={mention.handleKeyDown}
          onCursorChange={mention.trackCursor}
          mentionNames={chatContexts
            .filter((c) => c.type === "file_mention")
            .map((c) => (c as { fileName: string }).fileName)}
          mentionDropdown={
            mention.isOpen ? (
              <MentionDropdown
                items={mention.filteredItems}
                selectedIndex={mention.selectedIndex}
                onSelect={mention.handleSelect}
                onHover={mention.setSelectedIndex}
              />
            ) : undefined
          }
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
        />
      </div>

      {/* Clear Conversation Confirmation Modal */}
      <Modal open={showClearModal} onClose={() => setShowClearModal(false)}>
        <ModalHeader onClose={() => setShowClearModal(false)}>
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            {t("clearConversation")}
          </span>
        </ModalHeader>
        <p className="text-sm text-muted-foreground">{t("clearConversationDesc")}</p>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowClearModal(false)}>
            {tc("cancel")}
          </Button>
          <Button variant="destructive" onClick={handleClearConfirm}>
            {t("clear")}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
