"use client";

import { useState } from "react";
import { User, Bot, Loader2, FileText, ChevronDown, ChevronRight, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { type ChatMessage as ChatMessageType } from "@/stores/chat-store";
import { marked } from "marked";
import { useMemo } from "react";

interface ChatMessageProps {
  message: ChatMessageType;
}

// Collapsible context display for user messages (single item)
function MessageContextItemDisplay({
  context,
  index,
  total,
}: {
  context: { type: string; text?: string; src?: string; alt?: string };
  index?: number;
  total?: number;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isImage = context.type === "image";
  const Icon = isImage ? ImageIcon : FileText;

  const label = (() => {
    const prefix = total && total > 1 ? `Reference ${(index || 0) + 1}` : "Reference";
    if (isImage) {
      return `${prefix}: Image${context.alt ? ` (${context.alt})` : ""}`;
    }
    return `${prefix} (${context.text?.length || 0} chars)`;
  })();

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-1.5 text-left text-xs opacity-80 transition-opacity hover:opacity-100"
      >
        <Icon className="h-3 w-3 flex-shrink-0" />
        <span className="flex-1 truncate">{label}</span>
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 flex-shrink-0" />
        )}
      </button>
      {isExpanded && (
        <div className="mt-1.5 max-h-[100px] overflow-y-auto rounded bg-black/10 px-2 py-1.5 text-xs opacity-70">
          {isImage ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={context.src}
              alt={context.alt || "Image"}
              className="h-auto max-w-full rounded"
            />
          ) : (
            <div className="whitespace-pre-wrap">{context.text}</div>
          )}
        </div>
      )}
    </div>
  );
}

// Container for multiple contexts
function MessageContextsDisplay({
  contexts,
}: {
  contexts: { type: string; text?: string; src?: string; alt?: string }[];
}) {
  return (
    <div className="mt-2 space-y-1 border-t border-primary-foreground/20 pt-2">
      {contexts.map((ctx, index) => (
        <MessageContextItemDisplay
          key={index}
          context={ctx}
          index={index}
          total={contexts.length}
        />
      ))}
    </div>
  );
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  // Parse markdown and handle special markers for tool usage
  const htmlContent = useMemo(() => {
    if (isUser) return null;

    let content = message.content;

    // Replace tool usage markers with styled versions
    // These are added by use-chat.ts when tools are used
    content = content.replace(
      /🔧 \*Using ([^*]+)\.\.\.\*/g,
      '<div class="flex items-center gap-2 text-blue-500 dark:text-blue-400 py-1"><span class="inline-block animate-pulse">🔧</span> <span class="text-xs">Using $1...</span></div>'
    );

    content = content.replace(
      /📝 \*Editing document: ([^*]+)\*/g,
      '<div class="flex items-center gap-2 text-amber-500 dark:text-amber-400 py-1"><span>📝</span> <span class="text-xs font-medium">Editing: $1</span></div>'
    );

    content = content.replace(
      /✅ \*Applied (\d+) edit\(s\) to document\*/g,
      '<div class="flex items-center gap-2 text-green-500 dark:text-green-400 py-1 font-medium"><span>✅</span> <span class="text-xs">Applied $1 edit(s) to document</span></div>'
    );

    content = content.replace(
      /❌ \*Error: ([^*]+)\*/g,
      '<div class="flex items-center gap-2 text-red-500 dark:text-red-400 py-1"><span>❌</span> <span class="text-xs">Error: $1</span></div>'
    );

    return marked.parse(content, { async: false }) as string;
  }, [message.content, isUser]);

  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      {/* Content */}
      <div className={cn("max-w-[85%] flex-1", isUser ? "text-right" : "text-left")}>
        <div
          className={cn(
            "inline-block rounded-lg px-3 py-2 text-sm",
            isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
          )}
        >
          {isUser ? (
            <>
              <p className="whitespace-pre-wrap text-left">{message.content}</p>
              {message.contexts && message.contexts.length > 0 && (
                <MessageContextsDisplay contexts={message.contexts} />
              )}
            </>
          ) : message.isStreaming && !message.content ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Thinking...</span>
            </div>
          ) : (
            <div
              className="prose prose-sm max-w-none dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
              dangerouslySetInnerHTML={{ __html: htmlContent || "" }}
            />
          )}

          {/* Streaming indicator */}
          {message.isStreaming && message.content && (
            <div className="mt-2 flex items-center gap-1 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="text-xs">Writing...</span>
            </div>
          )}
        </div>

        {/* Timestamp */}
        <p className="mt-1 text-xs text-muted-foreground">
          {new Date(message.createdAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    </div>
  );
}
