"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown, Copy, Check, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { telemetry } from "@/lib/telemetry";

interface ChatFeedbackToolbarProps {
  messageId: string;
  conversationId: string;
  content: string;
  userPrompt?: string;
  aiResponse?: string;
  fileId?: string;
  model?: string;
  hadToolCalls?: boolean;
  /** Event type for telemetry (e.g., "chat_feedback" or "kb_feedback") */
  eventType?: "chat_feedback" | "chat_regenerate" | "kb_feedback";
  /** KB-specific turn index */
  turnIndex?: number;
  /** Always show (mobile) vs hover-only (desktop) */
  alwaysVisible?: boolean;
  /** Callback to regenerate this AI response */
  onRegenerate?: () => void;
  /** Whether this is the last assistant message (show regenerate button) */
  isLastMessage?: boolean;
  /** Whether a stream is currently active (disable regenerate) */
  isStreaming?: boolean;
  className?: string;
}

/**
 * Horizontal feedback toolbar below AI messages.
 * Copy + ThumbsUp + ThumbsDown. Shows on hover by default.
 */
export function ChatFeedbackToolbar({
  messageId,
  conversationId,
  content,
  userPrompt = "",
  aiResponse = "",
  fileId,
  model,
  hadToolCalls,
  eventType = "chat_feedback",
  turnIndex,
  alwaysVisible = false,
  onRegenerate,
  isLastMessage = false,
  isStreaming = false,
  className,
}: ChatFeedbackToolbarProps) {
  const t = useTranslations("chat");
  const [feedback, setFeedback] = useState<"positive" | "negative" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleFeedback = async (rating: "positive" | "negative") => {
    if (feedback === rating || isSubmitting) return;
    setIsSubmitting(true);

    try {
      telemetry.trackChatFeedback({
        event_type: eventType,
        message_id: messageId,
        conversation_id: conversationId,
        user_prompt: userPrompt,
        ai_response: aiResponse || content,
        rating,
        file_id: fileId,
        model,
        had_tool_calls: hadToolCalls,
        turn_index: turnIndex,
      });
      await telemetry.flush();
      setFeedback(rating);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-secure contexts
    }
  };

  return (
    <div
      className={cn(
        "mt-2 flex items-center gap-0.5 transition-opacity duration-200",
        !alwaysVisible && "opacity-0 group-hover:opacity-100",
        alwaysVisible && "opacity-100",
        className
      )}
    >
      {/* Copy */}
      <button
        type="button"
        onClick={handleCopy}
        className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground dark:text-muted-foreground/70"
        title={t("copyResponse")}
        aria-label={t("copyResponse")}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>

      {/* Regenerate */}
      {isLastMessage && onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          disabled={isStreaming}
          className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 dark:text-muted-foreground/70"
          title={t("regenerate")}
          aria-label={t("regenerate")}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Thumbs up */}
      <button
        type="button"
        onClick={() => handleFeedback("positive")}
        disabled={isSubmitting}
        className={cn(
          "rounded-md p-1.5 transition-colors",
          "hover:bg-muted",
          feedback === "positive"
            ? "text-green-500 dark:text-green-400"
            : "text-muted-foreground/50 hover:text-foreground dark:text-muted-foreground/70"
        )}
        title={t("goodResponse")}
        aria-label={t("markGoodResponse")}
      >
        <ThumbsUp className={cn("h-3.5 w-3.5", feedback === "positive" && "fill-current")} />
      </button>

      {/* Thumbs down */}
      <button
        type="button"
        onClick={() => handleFeedback("negative")}
        disabled={isSubmitting}
        className={cn(
          "rounded-md p-1.5 transition-colors",
          "hover:bg-muted",
          feedback === "negative"
            ? "text-red-500 dark:text-red-400"
            : "text-muted-foreground/50 hover:text-foreground dark:text-muted-foreground/70"
        )}
        title={t("poorResponse")}
        aria-label={t("markPoorResponse")}
      >
        <ThumbsDown className={cn("h-3.5 w-3.5", feedback === "negative" && "fill-current")} />
      </button>
    </div>
  );
}
