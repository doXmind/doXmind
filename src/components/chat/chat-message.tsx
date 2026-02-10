"use client";

import { useState, useMemo } from "react";
import { User, Bot, ChevronDown, ChevronRight, ImageIcon, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { marked } from "marked";

interface MessageContextItem {
  type: string;
  text?: string;
  src?: string;
  alt?: string;
}

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  contexts?: MessageContextItem[];
  /** Slot for feedback toolbar, sources, etc. below the message */
  children?: React.ReactNode;
  className?: string;
}

/** Collapsible context reference for user messages */
function ContextReference({
  context,
  index,
  total,
}: {
  context: MessageContextItem;
  index: number;
  total: number;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isImage = context.type === "image";
  const Icon = isImage ? ImageIcon : FileText;
  const prefix = total > 1 ? `Reference ${index + 1}` : "Reference";
  const label = isImage
    ? `${prefix}: Image${context.alt ? ` (${context.alt})` : ""}`
    : `${prefix}: "${context.text?.slice(0, 40)?.replace(/\n/g, " ") || ""}${(context.text?.length || 0) > 40 ? "..." : ""}"`;

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
      >
        <Icon className="h-3 w-3 flex-shrink-0" />
        <span className="truncate">{label}</span>
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 flex-shrink-0" />
        )}
      </button>
      {isExpanded && (
        <div className="mt-1 max-h-[150px] overflow-y-auto rounded-md bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground">
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

/**
 * Shared full-width chat message component.
 * ChatGPT-inspired layout: small avatar + role label header, full-width content below.
 */
export function ChatMessage({
  role,
  content,
  isStreaming,
  contexts,
  children,
  className,
}: ChatMessageProps) {
  const isUser = role === "user";

  // Parse markdown for AI messages
  const htmlContent = useMemo(() => {
    if (isUser) return null;

    let text = content;

    // Replace tool usage markers with styled versions
    text = text.replace(
      /🔧 \*Using ([^*]+)\.\.\.\*/g,
      '<div class="flex items-center gap-2 text-muted-foreground py-1"><span class="text-xs">Using $1...</span></div>'
    );
    text = text.replace(
      /📝 \*Editing document: ([^*]+)\*/g,
      '<div class="flex items-center gap-2 text-muted-foreground py-1"><span class="text-xs">Editing: $1</span></div>'
    );
    text = text.replace(
      /✅ \*Applied (\d+) edit\(s\) to document\*/g,
      '<div class="flex items-center gap-2 text-green-600 dark:text-green-400 py-1"><span class="text-xs">Applied $1 edit(s)</span></div>'
    );
    text = text.replace(
      /❌ \*Error: ([^*]+)\*/g,
      '<div class="flex items-center gap-2 text-red-600 dark:text-red-400 py-1"><span class="text-xs">Error: $1</span></div>'
    );

    return marked.parse(text, { async: false }) as string;
  }, [content, isUser]);

  return (
    <div className={cn("group relative py-3", className)}>
      {/* Role header with avatar */}
      <div className="mb-1.5 flex items-center gap-2">
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-muted">
          {isUser ? (
            <User className="h-3 w-3 text-muted-foreground" />
          ) : (
            <Bot className="h-3 w-3 text-muted-foreground" />
          )}
        </div>
        <span className="text-xs font-semibold text-foreground">{isUser ? "You" : "doXmind"}</span>
      </div>

      {/* Content area — indented past avatar */}
      <div className="pl-7">
        {/* Contexts above user message */}
        {isUser && contexts && contexts.length > 0 && (
          <div className="mb-2 space-y-0.5">
            {contexts.map((ctx, i) => (
              <ContextReference key={i} context={ctx} index={i} total={contexts.length} />
            ))}
          </div>
        )}

        {isUser ? (
          <div className="rounded-xl bg-accent/40 px-4 py-3">
            <p className="whitespace-pre-wrap text-sm">{content}</p>
          </div>
        ) : isStreaming && !content ? (
          <div className="flex items-center gap-2 py-1">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/40" />
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/40 [animation-delay:150ms]" />
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/40 [animation-delay:300ms]" />
          </div>
        ) : (
          <>
            <div
              className="prose prose-sm max-w-none dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
              dangerouslySetInnerHTML={{ __html: htmlContent || "" }}
            />
            {/* Streaming cursor */}
            {isStreaming && content && <span className="chat-streaming-cursor" />}
          </>
        )}

        {/* Slot for feedback toolbar, etc. */}
        {children}
      </div>
    </div>
  );
}
