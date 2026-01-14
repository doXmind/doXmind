"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square, Trash2, Sparkles, Check, AlertCircle, Loader2, FileEdit, Eye, Search, Replace, Brain, ChevronDown, ChevronRight, X, FileText, ImageIcon, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip } from "@/components/ui/tooltip";
import { ChatMessage } from "./chat-message";
import { useChatStore } from "@/stores/chat-store";
import { useFileStore } from "@/stores/file-store";
import { useEditorStore, type ChatContextItem } from "@/stores/editor-store";
import { useChat, type ToolStatus, type ThinkingStatus } from "@/hooks/use-chat";
import { cn } from "@/lib/utils";
import { AttachmentMenu } from "./attachment-menu";

// Get icon for tool type
function getToolIcon(toolName: string) {
  switch (toolName) {
    case "view_document":
      return Eye;
    case "str_replace_editor":
      return Replace;
    case "insert_text":
      return FileEdit;
    case "replace_document":
      return FileEdit;
    case "search_in_document":
      return Search;
    case "apply_edits":
      return Check;
    // Knowledge Base tools
    case "search_knowledge_base":
      return BookOpen;
    case "read_kb_document":
      return BookOpen;
    case "list_kb_documents":
      return BookOpen;
    default:
      return Sparkles;
  }
}

// Get display name for tool
function getToolDisplayName(toolName: string) {
  switch (toolName) {
    case "view_document":
      return "Reading document";
    case "str_replace_editor":
      return "Editing text";
    case "insert_text":
      return "Inserting text";
    case "replace_document":
      return "Replacing document";
    case "search_in_document":
      return "Searching document";
    case "apply_edits":
      return "Applying changes";
    // Knowledge Base tools
    case "search_knowledge_base":
      return "Searching knowledge base";
    case "read_kb_document":
      return "Reading KB document";
    case "list_kb_documents":
      return "Listing KB documents";
    default:
      return toolName;
  }
}

// Thinking indicator component (shows AI reasoning process)
function ThinkingIndicator({ thinking }: { thinking: ThinkingStatus }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!thinking.content && !thinking.isThinking) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="ml-11 mb-2"
    >
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-colors duration-200 w-full text-left",
          thinking.isThinking
            ? "bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-purple-400"
            : "bg-purple-500/5 border-purple-500/15 text-purple-600/70 dark:text-purple-400/70"
        )}
      >
        <div className="relative flex-shrink-0">
          <Brain className="h-4 w-4" />
          {thinking.isThinking && (
            <motion.span
              className="absolute -top-1 -right-1 h-2 w-2 bg-purple-500 rounded-full"
              animate={{
                scale: [1, 1.3, 1],
                boxShadow: [
                  '0 0 0 0 rgba(168, 85, 247, 0.4)',
                  '0 0 0 6px rgba(168, 85, 247, 0)',
                  '0 0 0 0 rgba(168, 85, 247, 0.4)'
                ]
              }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
        </div>
        <span className="font-medium truncate flex-1">
          {thinking.isThinking ? "Thinking..." : "Thought process"}
        </span>
        {thinking.isThinking && <Loader2 className="h-3 w-3 animate-spin" />}
        <motion.span
          animate={{ rotate: isExpanded ? 90 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronRight className="h-4 w-4 flex-shrink-0" />
        </motion.span>
      </button>
      <AnimatePresence>
        {isExpanded && thinking.content && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-1 px-3 py-2 text-xs text-muted-foreground bg-muted/50 rounded-lg border border-border/50 max-h-[200px] overflow-y-auto whitespace-pre-wrap">
              {thinking.content}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// Tool status indicator component (like Claude's tool usage display)
function ToolIndicator({ tool }: { tool: ToolStatus }) {
  const Icon = getToolIcon(tool.name);
  const displayName = getToolDisplayName(tool.name);

  // Determine colors based on status
  const statusStyles = {
    running: {
      bg: 'rgba(59, 130, 246, 0.1)',
      border: 'rgba(59, 130, 246, 0.3)',
      text: 'text-blue-600 dark:text-blue-400'
    },
    completed: {
      bg: 'rgba(34, 197, 94, 0.1)',
      border: 'rgba(34, 197, 94, 0.3)',
      text: 'text-green-600 dark:text-green-400'
    },
    error: {
      bg: 'rgba(239, 68, 68, 0.1)',
      border: 'rgba(239, 68, 68, 0.3)',
      text: 'text-red-600 dark:text-red-400'
    }
  };

  const currentStyle = statusStyles[tool.status] || statusStyles.running;

  return (
    <motion.div
      initial={{ opacity: 0, y: 5, scale: 0.98 }}
      animate={{
        opacity: 1,
        y: 0,
        scale: 1,
        backgroundColor: currentStyle.bg,
        borderColor: currentStyle.border
      }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg text-sm border",
        currentStyle.text
      )}
    >
      {tool.status === "running" && (
        <>
          <div className="relative">
            <Icon className="h-4 w-4 flex-shrink-0" />
            <motion.span
              className="absolute -top-1 -right-1 h-2 w-2 bg-blue-500 rounded-full"
              animate={{
                scale: [1, 1.2, 1],
                opacity: [1, 0.7, 1]
              }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>
          <span className="truncate font-medium">{displayName}...</span>
          <Loader2 className="h-3 w-3 animate-spin ml-auto" />
        </>
      )}
      {tool.status === "completed" && (
        <>
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 15 }}
          >
            <Icon className="h-4 w-4 flex-shrink-0" />
          </motion.div>
          <span className="truncate">{tool.message || `${displayName}`}</span>
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 15, delay: 0.1 }}
          >
            <Check className="h-3 w-3 ml-auto" />
          </motion.div>
        </>
      )}
      {tool.status === "error" && (
        <>
          <motion.div
            animate={{ x: [0, -2, 2, -2, 0] }}
            transition={{ duration: 0.4 }}
          >
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
          </motion.div>
          <span className="truncate">{tool.message || "Error"}</span>
        </>
      )}
    </motion.div>
  );
}

// Context Pill component - shows selected text or image as a collapsible pill (Cursor-style)
function ContextPill({
  context,
  onRemove
}: {
  context: ChatContextItem;
  onRemove: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isImage = context.type === 'image';
  const Icon = isImage ? ImageIcon : FileText;
  const label = isImage
    ? `Image${context.alt ? `: ${context.alt}` : ''}`
    : `Selected Text (${context.text.length} chars)`;

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-muted/30">
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left hover:text-primary transition-colors"
        >
          <Icon className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="truncate text-muted-foreground">
            {label}
          </span>
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          )}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="p-1 hover:bg-accent rounded transition-colors flex-shrink-0"
          title="Remove context"
        >
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
      {isExpanded && (
        <div className="px-3 py-2 text-sm text-muted-foreground bg-muted/50 border-t border-border max-h-[150px] overflow-y-auto">
          {isImage ? (
            <img
              src={context.src}
              alt={context.alt || 'Image'}
              className="max-w-full h-auto rounded"
            />
          ) : (
            <div className="whitespace-pre-wrap">{context.text}</div>
          )}
        </div>
      )}
    </div>
  );
}

export function ChatPanel() {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { currentFileId } = useFileStore();
  const { conversations, clearConversation, loadConversation, isLoadingHistory } = useChatStore();

  // Import editor store for chat context feature (Context Pills)
  const { chatContexts, removeChatContext, clearAllChatContexts, addChatContext } = useEditorStore();

  // Get conversation key without triggering store updates during render
  const conversationKey = currentFileId || "global";
  const conversation = useMemo(() => {
    return conversations[conversationKey] || {
      id: conversationKey,
      fileId: currentFileId,
      messages: [],
      createdAt: new Date().toISOString(),
    };
  }, [conversations, conversationKey, currentFileId]);

  const { sendMessage, isStreaming, stopStreaming, currentTool, toolHistory, thinking } = useChat();

  // Load conversation history from backend when file changes
  useEffect(() => {
    if (currentFileId) {
      loadConversation(currentFileId);
    }
  }, [currentFileId, loadConversation]);

  // Focus textarea when chat context is added (from Quick Edit "Ask in Chat")
  useEffect(() => {
    if (chatContexts.length > 0 && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [chatContexts.length]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [conversation.messages, currentTool, toolHistory, thinking]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isStreaming) return;

    const message = input.trim();
    // Pass contexts as a separate parameter (for display), not concatenated to message
    // Include base64 and mediaType for image contexts to enable multimodal API
    const contextsToSend = chatContexts.length > 0
      ? chatContexts.map(c => {
          if (c.type === 'image') {
            return {
              type: 'image' as const,
              src: c.src,
              alt: c.alt,
              base64: c.base64,
              mediaType: c.mediaType,
            };
          }
          return { type: 'selection' as const, text: c.text };
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

  // Max images allowed
  const MAX_IMAGES = 10;
  const currentImageCount = chatContexts.filter(c => c.type === 'image').length;

  // Process image file and add to context
  const processImageFile = (file: File) => {
    // Only accept image files
    if (!file.type.startsWith('image/')) return;

    // Check image count limit
    const imageCount = chatContexts.filter(c => c.type === 'image').length;
    if (imageCount >= MAX_IMAGES) {
      console.warn(`Maximum ${MAX_IMAGES} images allowed`);
      return;
    }

    // Check file size (5MB limit for Anthropic API)
    if (file.size > 5 * 1024 * 1024) {
      console.warn(`Image ${file.name} is too large (max 5MB)`);
      return;
    }

    // Convert to base64
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      const mediaType = file.type;

      addChatContext({
        type: 'image',
        src: dataUrl,  // Data URL for preview display
        alt: file.name || 'Pasted image',
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
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          processImageFile(file);
        }
      }
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header - Hidden on mobile (title shown in mobile header) */}
      <div className="hidden md:flex p-3 border-b border-border items-center justify-between">
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

      {/* Mobile Header Actions */}
      <div className="md:hidden flex justify-end items-center p-2 border-b border-border">
        {/* Clear button */}
        {conversation.messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="h-10 gap-2"
            aria-label="Clear conversation"
          >
            <Trash2 className="h-4 w-4" />
            <span className="text-sm">Clear</span>
          </Button>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        {isLoadingHistory ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <Loader2 className="h-8 w-8 text-muted-foreground mb-4 animate-spin" />
            <p className="text-sm text-muted-foreground">Loading conversation history...</p>
          </div>
        ) : conversation.messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <Sparkles className="h-8 w-8 text-muted-foreground mb-4" />
            <h3 className="font-medium mb-2">Start a conversation</h3>
            <p className="text-sm text-muted-foreground max-w-[250px]">
              Ask me to help you write, edit, or improve your document.
            </p>
            <div className="mt-4 space-y-2 w-full">
              <SuggestionButton onClick={() => setInput("Help me improve the writing style")}>
                Improve writing style
              </SuggestionButton>
              <SuggestionButton onClick={() => setInput("Summarize this document")}>
                Summarize document
              </SuggestionButton>
              <SuggestionButton onClick={() => setInput("Check for grammar errors")}>
                Check grammar
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

            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input - with safe area padding on mobile */}
      <form
        onSubmit={handleSubmit}
        className="p-3 md:p-3 border-t border-border"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        {/* Context Pills - shows attached images and selected text */}
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

        <div className="relative flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1.5">
          {/* Unified attachment menu */}
          <AttachmentMenu
            conversationId={conversation.id}
            onImageSelect={handleImageFilesFromMenu}
            imageCount={currentImageCount}
            maxImages={MAX_IMAGES}
            disabled={isStreaming}
          />

          <Textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Ask AI anything..."
            className="min-h-[24px] max-h-[200px] flex-1 resize-none border-0 bg-transparent py-1 px-1 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
            disabled={isStreaming}
            rows={1}
          />

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

        <p className="text-xs text-muted-foreground mt-2 text-center hidden md:block">
          Press Enter to send, Shift+Enter for new line
        </p>
      </form>
    </div>
  );
}

function SuggestionButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-4 md:px-3 py-3 md:py-2 text-base md:text-sm rounded-lg md:rounded-md border border-border hover:bg-accent active:scale-[0.98] transition-all"
    >
      {children}
    </button>
  );
}
