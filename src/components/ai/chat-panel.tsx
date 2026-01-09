"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Send, Square, Trash2, Sparkles, Check, AlertCircle, Loader2, FileEdit, Eye, Search, Replace, Brain, ChevronDown, ChevronRight, X, FileText, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage } from "./chat-message";
import { useChatStore } from "@/stores/chat-store";
import { useFileStore } from "@/stores/file-store";
import { useEditorStore, type ChatContextItem } from "@/stores/editor-store";
import { useChat, type ToolStatus, type ThinkingStatus } from "@/hooks/use-chat";
import { cn } from "@/lib/utils";

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
    default:
      return toolName;
  }
}

// Thinking indicator component (shows AI reasoning process)
function ThinkingIndicator({ thinking }: { thinking: ThinkingStatus }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!thinking.content && !thinking.isThinking) return null;

  return (
    <div className="ml-11 mb-2">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-all duration-200 w-full text-left",
          thinking.isThinking
            ? "bg-purple-500/5 border-purple-500/20 text-purple-600 dark:text-purple-400"
            : "bg-purple-500/5 border-purple-500/10 text-purple-600/70 dark:text-purple-400/70"
        )}
      >
        <div className="relative flex-shrink-0">
          <Brain className="h-4 w-4" />
          {thinking.isThinking && (
            <span className="absolute -top-1 -right-1 h-2 w-2 bg-purple-500 rounded-full animate-pulse" />
          )}
        </div>
        <span className="font-medium truncate flex-1">
          {thinking.isThinking ? "Thinking..." : "Thought process"}
        </span>
        {thinking.isThinking && <Loader2 className="h-3 w-3 animate-spin" />}
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 flex-shrink-0" />
        )}
      </button>
      {isExpanded && thinking.content && (
        <div className="mt-1 px-3 py-2 text-xs text-muted-foreground bg-muted/50 rounded-lg border border-border/50 max-h-[200px] overflow-y-auto whitespace-pre-wrap">
          {thinking.content}
        </div>
      )}
    </div>
  );
}

// Tool status indicator component (like Claude's tool usage display)
function ToolIndicator({ tool }: { tool: ToolStatus }) {
  const Icon = getToolIcon(tool.name);
  const displayName = getToolDisplayName(tool.name);

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-all duration-200",
        tool.status === "running" && "bg-blue-500/5 border-blue-500/20 text-blue-600 dark:text-blue-400",
        tool.status === "completed" && "bg-green-500/5 border-green-500/20 text-green-600 dark:text-green-400",
        tool.status === "error" && "bg-red-500/5 border-red-500/20 text-red-600 dark:text-red-400"
      )}
    >
      {tool.status === "running" && (
        <>
          <div className="relative">
            <Icon className="h-4 w-4 flex-shrink-0" />
            <span className="absolute -top-1 -right-1 h-2 w-2 bg-blue-500 rounded-full animate-pulse" />
          </div>
          <span className="truncate font-medium">{displayName}...</span>
          <Loader2 className="h-3 w-3 animate-spin ml-auto" />
        </>
      )}
      {tool.status === "completed" && (
        <>
          <Icon className="h-4 w-4 flex-shrink-0" />
          <span className="truncate">{tool.message || `${displayName}`}</span>
          <Check className="h-3 w-3 ml-auto" />
        </>
      )}
      {tool.status === "error" && (
        <>
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span className="truncate">{tool.message || "Error"}</span>
        </>
      )}
    </div>
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
  const { chatContexts, removeChatContext, clearAllChatContexts } = useEditorStore();

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
    const contextsToSend = chatContexts.length > 0
      ? chatContexts.map(c => {
          if (c.type === 'image') {
            return { type: 'image' as const, src: c.src, alt: c.alt };
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">AI Assistant</h2>
        </div>
        {conversation.messages.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClear}
            title="Clear conversation"
          >
            <Trash2 className="h-4 w-4" />
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

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-border">
        <div className="relative">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask AI anything..."
            className="min-h-[44px] max-h-[200px] pr-12 resize-none"
            disabled={isStreaming}
            rows={1}
          />
          <div className="absolute right-2 bottom-2">
            {isStreaming ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={stopStreaming}
                className="h-8 w-8"
                title="Stop"
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                variant="ghost"
                disabled={!input.trim()}
                className="h-8 w-8"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Context Pills - shows selected text from "Ask in Chat" (supports multiple) */}
        {chatContexts.length > 0 && (
          <div className="mt-2 space-y-1">
            {chatContexts.map((ctx) => (
              <ContextPill
                key={ctx.id}
                context={ctx}
                onRemove={() => removeChatContext(ctx.id)}
              />
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-2 text-center">
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
      className="w-full text-left px-3 py-2 text-sm rounded-md border border-border hover:bg-accent transition-colors"
    >
      {children}
    </button>
  );
}
