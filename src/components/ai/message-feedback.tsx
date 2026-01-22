"use client";

/**
 * Message Feedback Component
 *
 * Provides thumbs up/down feedback buttons for AI messages.
 * Collects explicit user feedback for RLHF training.
 */

import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { telemetry } from "@/lib/telemetry";

interface MessageFeedbackProps {
  messageId: string;
  conversationId: string;
  userPrompt: string;
  aiResponse: string;
  fileId?: string;
  model?: string;
  hadToolCalls?: boolean;
  className?: string;
}

export function MessageFeedback({
  messageId,
  conversationId,
  userPrompt,
  aiResponse,
  fileId,
  model,
  hadToolCalls,
  className,
}: MessageFeedbackProps) {
  const [feedback, setFeedback] = useState<"positive" | "negative" | null>(
    null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFeedback = async (rating: "positive" | "negative") => {
    if (feedback === rating || isSubmitting) return;

    setIsSubmitting(true);

    try {
      // Track feedback for RLHF training
      telemetry.trackChatFeedback({
        event_type: "chat_feedback",
        message_id: messageId,
        conversation_id: conversationId,
        user_prompt: userPrompt,
        ai_response: aiResponse,
        rating,
        file_id: fileId,
        model,
        had_tool_calls: hadToolCalls,
      });

      // Immediately flush to send feedback to backend
      await telemetry.flush();

      setFeedback(rating);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <button
        type="button"
        onClick={() => handleFeedback("positive")}
        disabled={isSubmitting}
        className={cn(
          "rounded p-1 transition-colors",
          "hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/20",
          feedback === "positive"
            ? "text-green-500 dark:text-green-400"
            : "text-muted-foreground hover:text-foreground"
        )}
        title="Good response"
        aria-label="Mark as good response"
      >
        <ThumbsUp
          className={cn("h-3.5 w-3.5", feedback === "positive" && "fill-current")}
        />
      </button>
      <button
        type="button"
        onClick={() => handleFeedback("negative")}
        disabled={isSubmitting}
        className={cn(
          "rounded p-1 transition-colors",
          "hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/20",
          feedback === "negative"
            ? "text-red-500 dark:text-red-400"
            : "text-muted-foreground hover:text-foreground"
        )}
        title="Poor response"
        aria-label="Mark as poor response"
      >
        <ThumbsDown
          className={cn("h-3.5 w-3.5", feedback === "negative" && "fill-current")}
        />
      </button>
    </div>
  );
}
