"use client";

import { useState, useMemo, useRef, useEffect, memo } from "react";
import {
  User,
  ChevronDown,
  ChevronRight,
  ImageIcon,
  FileText,
  Sparkles,
  BarChart3,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { AiLogoIcon } from "@/components/ui/ai-logo-icon";
import { QUICK_EDIT_LABELS } from "@/lib/quick-edit-prompts";
import { marked } from "marked";
import katex from "katex";
import { AtSign } from "lucide-react";

/**
 * Render LaTeX math in markdown text.
 * Extracts math before marked.parse() to prevent _ in LaTeX being treated as emphasis,
 * then restores with KaTeX-rendered HTML after markdown processing.
 */
function parseMarkdownWithMath(text: string): string {
  const placeholders: { key: string; rendered: string }[] = [];
  let idx = 0;

  // Extract block math $$...$$ first
  let processed = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, latex) => {
    try {
      const rendered = katex.renderToString(latex.trim(), {
        displayMode: true,
        throwOnError: false,
      });
      // Use a format that marked won't interpret as markdown syntax
      // (double underscores __X__ get converted to <strong> by marked)
      const key = `MATHBLOCK${idx++}ENDMATH`;
      placeholders.push({ key, rendered });
      return key;
    } catch {
      return `$$${latex}$$`;
    }
  });

  // Extract inline math $...$
  processed = processed.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, (_, latex) => {
    try {
      const rendered = katex.renderToString(latex.trim(), {
        displayMode: false,
        throwOnError: false,
      });
      const key = `MATHINLINE${idx++}ENDMATH`;
      placeholders.push({ key, rendered });
      return key;
    } catch {
      return `$${latex}$`;
    }
  });

  // Run markdown parser on text with placeholders (safe from _ interference)
  let html = marked.parse(processed, { async: false }) as string;

  // Restore placeholders with KaTeX HTML
  for (const { key, rendered } of placeholders) {
    html = html.replace(key, rendered);
  }

  return html;
}

/** Regex to match @[displayName](fileid:uuid) mention tokens */
const MENTION_REGEX = /@\[([^\]]+)\]\(fileid:[a-f0-9-]+\)/g;

/** Replace mention tokens with styled HTML for assistant messages (dangerouslySetInnerHTML) */
function replaceMentionsWithHtml(text: string): string {
  return text.replace(
    MENTION_REGEX,
    '<span class="mention-tag"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-1px;margin-right:2px"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></svg>$1</span>'
  );
}

/** Render user message content with styled mention tags (React nodes) */
function renderUserContentWithMentions(content: string): React.ReactNode {
  const regex = /@\[([^\]]+)\]\(fileid:[a-f0-9-]+\)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    parts.push(
      <span key={match.index} className="mention-tag">
        <AtSign className="inline h-3 w-3" style={{ verticalAlign: "-1px", marginRight: "2px" }} />
        {match[1]}
      </span>
    );
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts.length > 1 ? parts : content;
}

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
  /** Quick edit metadata for messages originated from quick edit menu */
  quickEdit?: { action: string; originalText: string } | null;
  /** Slot for feedback toolbar, sources, etc. below the message */
  children?: React.ReactNode;
  /** Whether this user message can be edited */
  isEditable?: boolean;
  /** Callback when user saves an edited message */
  onEdit?: (newContent: string) => void;
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
  const t = useTranslations("chat");
  const [isExpanded, setIsExpanded] = useState(false);
  const isImage = context.type === "image";
  const isChart = !isImage && context.text?.startsWith("```mermaid\n");
  const Icon = isImage ? ImageIcon : isChart ? BarChart3 : FileText;
  const prefix = total > 1 ? t("referenceN", { n: index + 1 }) : t("reference");
  const displayText = isChart
    ? context.text?.replace(/^```mermaid\n/, "").replace(/\n```$/, "") || ""
    : context.text || "";
  const label = isImage
    ? `${prefix}: ${t("imageLabel")}${context.alt ? ` (${context.alt})` : ""}`
    : isChart
      ? `${prefix}: ${t("chartLabel")}`
      : `${prefix}: "${displayText.slice(0, 40).replace(/\n/g, " ")}${displayText.length > 40 ? "..." : ""}"`;

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
      >
        <Icon className="h-3 w-3 flex-shrink-0" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
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
              alt={context.alt || t("imageLabel")}
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
 *
 * Wrapped in React.memo to prevent re-renders of historical messages during streaming.
 * Custom comparator ignores `onEdit` (callback identity) and `children` (derived from
 * the same props we already compare: content, isStreaming).
 */
export const ChatMessage = memo(
  function ChatMessage({
    role,
    content,
    isStreaming,
    contexts,
    quickEdit,
    children,
    isEditable,
    onEdit,
    className,
  }: ChatMessageProps) {
    const t = useTranslations("chat");
    const isUser = role === "user";
    const [isEditing, setIsEditing] = useState(false);
    const [editContent, setEditContent] = useState(content);
    const editTextareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-focus and resize textarea when entering edit mode
    useEffect(() => {
      if (isEditing && editTextareaRef.current) {
        editTextareaRef.current.focus();
        editTextareaRef.current.style.height = "auto";
        editTextareaRef.current.style.height = editTextareaRef.current.scrollHeight + "px";
      }
    }, [isEditing]);

    const handleStartEdit = () => {
      setEditContent(content);
      setIsEditing(true);
    };

    const handleSaveEdit = () => {
      const trimmed = editContent.trim();
      if (trimmed && onEdit) {
        onEdit(trimmed);
      }
      setIsEditing(false);
    };

    const handleCancelEdit = () => {
      setIsEditing(false);
      setEditContent(content);
    };

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

      // Replace @[name](fileid:id) with styled mention tags
      text = replaceMentionsWithHtml(text);

      return parseMarkdownWithMath(text);
    }, [content, isUser]);

    return (
      <div className={cn("group relative py-3", className)}>
        {/* Role header with avatar */}
        <div className="mb-1.5 flex items-center gap-2">
          <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-muted">
            {isUser ? (
              <User className="h-3 w-3 text-muted-foreground" />
            ) : (
              <AiLogoIcon size={12} className="text-muted-foreground" />
            )}
          </div>
          <span className="text-xs font-semibold text-foreground">
            {isUser ? t("you") : t("aiName")}
          </span>
        </div>

        {/* Content area — indented past avatar */}
        <div className="pl-7">
          {/* Quick edit badge */}
          {isUser && quickEdit && (
            <div className="mb-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                <Sparkles className="h-3 w-3" />
                {QUICK_EDIT_LABELS[quickEdit.action] || "Quick Edit"}
              </span>
            </div>
          )}

          {/* Contexts above user message (file_mentions shown inline as @tags) */}
          {isUser && contexts && contexts.filter((c) => c.type !== "file_mention").length > 0 && (
            <div className="mb-2 space-y-0.5">
              {contexts
                .filter((c) => c.type !== "file_mention")
                .map((ctx, i, arr) => (
                  <ContextReference key={i} context={ctx} index={i} total={arr.length} />
                ))}
            </div>
          )}

          {isUser ? (
            <div className="group/user-msg relative rounded-xl bg-accent/40 px-4 py-3">
              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    ref={editTextareaRef}
                    value={editContent}
                    onChange={(e) => {
                      setEditContent(e.target.value);
                      e.target.style.height = "auto";
                      e.target.style.height = e.target.scrollHeight + "px";
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSaveEdit();
                      }
                      if (e.key === "Escape") {
                        handleCancelEdit();
                      }
                    }}
                    className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    rows={1}
                  />
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={handleSaveEdit}
                      disabled={!editContent.trim()}
                      className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                    >
                      <Check className="h-3 w-3" />
                      {t("sendMessage")}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap text-sm">
                    {renderUserContentWithMentions(content)}
                  </p>
                  {isEditable && onEdit && (
                    <button
                      type="button"
                      onClick={handleStartEdit}
                      className="absolute -right-1 -top-1 rounded-md border border-border bg-background p-1 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover/user-msg:opacity-100"
                      title={t("editMessage")}
                      aria-label={t("editMessage")}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                </>
              )}
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
  },
  (prev, next) => {
    // Custom comparator: skip onEdit (inline fn) and children (derived from compared props)
    return (
      prev.role === next.role &&
      prev.content === next.content &&
      prev.isStreaming === next.isStreaming &&
      prev.isEditable === next.isEditable &&
      prev.className === next.className &&
      prev.quickEdit === next.quickEdit &&
      prev.contexts === next.contexts
    );
  }
);
