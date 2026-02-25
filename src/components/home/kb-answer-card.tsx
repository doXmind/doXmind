"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Bot, X, Square, Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { telemetry } from "@/lib/telemetry";
import {
  ChatMessage,
  ChatFeedbackToolbar,
  ChatSources,
  ChatThinking,
  ChatToolSteps,
} from "@/components/chat";
import type { KBSource, KBTurn } from "@/hooks/use-kb-agent";
import type { ToolStatus, ThinkingStatus } from "@/stores/streaming-store";

interface KBAnswerCardProps {
  question: string;
  answer: string;
  sources: KBSource[];
  activeTool: string | null;
  isAnswering: boolean;
  error: string | null;
  onClose: () => void;
  onStop: () => void;
  onAsk: (question: string) => void;
  history?: KBTurn[];
  conversationId?: string | null;
  thinking?: ThinkingStatus;
  toolHistory?: ToolStatus[];
}

export function KBAnswerCard({
  question,
  answer,
  sources,
  activeTool: _activeTool,
  isAnswering,
  error,
  onClose,
  onStop,
  onAsk,
  history = [],
  conversationId,
  thinking = { isThinking: false, content: "" },
  toolHistory = [],
}: KBAnswerCardProps) {
  const router = useRouter();
  const [followUp, setFollowUp] = useState("");
  const [followUpFocused, setFollowUpFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const answerCompleteTimeRef = useRef<number | null>(null);

  // All turns: history + current
  const totalTurns = history.length + 1;
  const [activeTurnIndex, setActiveTurnIndex] = useState(totalTurns - 1);
  const isViewingCurrent = activeTurnIndex === totalTurns - 1;

  // Auto-select latest turn when a new one appears
  useEffect(() => {
    setActiveTurnIndex(totalTurns - 1);
    if (tabsRef.current) {
      tabsRef.current.scrollLeft = tabsRef.current.scrollWidth;
    }
  }, [totalTurns]);

  // Dynamically compute max-height for the answer content area
  const updateContentMaxHeight = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const reserve = 200;
    el.style.maxHeight = `${Math.max(120, window.innerHeight - top - reserve)}px`;
  }, []);

  useEffect(() => {
    updateContentMaxHeight();
    window.addEventListener("resize", updateContentMaxHeight);
    return () => window.removeEventListener("resize", updateContentMaxHeight);
  }, [updateContentMaxHeight, totalTurns]);

  // Auto-scroll content during streaming
  useEffect(() => {
    if (isViewingCurrent && isAnswering && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [answer, isViewingCurrent, isAnswering]);

  // Get the displayed turn's data
  const displayedQuestion = isViewingCurrent ? question : history[activeTurnIndex]?.question || "";
  const displayedAnswer = isViewingCurrent ? answer : history[activeTurnIndex]?.answer || "";
  const displayedSources = isViewingCurrent ? sources : history[activeTurnIndex]?.sources || [];
  const displayedThinking = isViewingCurrent
    ? thinking
    : history[activeTurnIndex]?.thinking || { isThinking: false, content: "" };
  const displayedToolHistory = isViewingCurrent
    ? toolHistory
    : history[activeTurnIndex]?.toolHistory || [];

  const displayedTurnIndex = isViewingCurrent ? totalTurns - 1 : activeTurnIndex;

  // Track when answer streaming completes
  useEffect(() => {
    if (!isAnswering && displayedAnswer && isViewingCurrent) {
      answerCompleteTimeRef.current = Date.now();
    }
  }, [isAnswering, displayedAnswer, isViewingCurrent]);

  const emitReadTime = () => {
    if (answerCompleteTimeRef.current) {
      telemetry.trackFeature("kb_search", "completed", undefined, {
        event: "answer_read",
        read_time_ms: Date.now() - answerCompleteTimeRef.current,
        turn_index: displayedTurnIndex,
        answer_length: displayedAnswer.length,
      });
      answerCompleteTimeRef.current = null;
    }
  };

  const showFeedback = displayedAnswer && !(isViewingCurrent && isAnswering);

  const handleSourceClick = (fileId: string, index: number) => {
    emitReadTime();
    telemetry.trackFeature("kb_search", "completed", undefined, {
      event: "source_clicked",
      file_id: fileId,
      file_name: displayedSources[index]?.file_name,
      score: displayedSources[index]?.score,
      position_index: index,
      total_sources: displayedSources.length,
      turn_index: displayedTurnIndex,
    });
    router.push(`/editor?id=${fileId}`);
  };

  const handleSubmit = () => {
    const q = followUp.trim();
    if (!q || isAnswering) return;
    emitReadTime();
    telemetry.trackFeature("kb_search", "completed", undefined, {
      event: "follow_up_submitted",
      turn_index: totalTurns,
      time_since_last_answer_ms: answerCompleteTimeRef.current
        ? Date.now() - answerCompleteTimeRef.current
        : undefined,
      query_length: q.length,
    });
    onAsk(q);
    setFollowUp("");
  };

  const handleTabSwitch = (newIndex: number) => {
    if (newIndex === activeTurnIndex) return;
    telemetry.trackFeature("kb_search", "completed", undefined, {
      event: "turn_tab_switched",
      from_turn: activeTurnIndex,
      to_turn: newIndex,
      total_turns: totalTurns,
    });
    setActiveTurnIndex(newIndex);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <motion.div
      className="sticky top-4"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/90 shadow-sm backdrop-blur-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/40 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">KB Assistant</span>
          </div>
          <div className="flex items-center gap-1">
            {isAnswering && (
              <button
                onClick={onStop}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Stop"
              >
                <Square className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Turn tabs */}
        {history.length > 0 && (
          <div
            ref={tabsRef}
            className="scrollbar-none flex gap-1 overflow-x-auto border-b border-border/30 bg-accent/10 px-3 py-1.5"
          >
            {history.map((turn, i) => (
              <button
                key={i}
                onClick={() => handleTabSwitch(i)}
                className={cn(
                  "flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs transition-colors",
                  activeTurnIndex === i
                    ? "border border-border/50 bg-background text-foreground shadow-sm"
                    : "text-muted-foreground/60 hover:text-muted-foreground"
                )}
              >
                <span className="inline-block max-w-[100px] truncate align-middle">
                  {turn.question.length > 20 ? turn.question.slice(0, 20) + "..." : turn.question}
                </span>
              </button>
            ))}
            <button
              onClick={() => handleTabSwitch(totalTurns - 1)}
              className={cn(
                "flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs transition-colors",
                isViewingCurrent
                  ? "border border-border/50 bg-background text-foreground shadow-sm"
                  : "text-muted-foreground/60 hover:text-muted-foreground"
              )}
            >
              <span className="inline-block max-w-[100px] truncate align-middle">
                {question.length > 20 ? question.slice(0, 20) + "..." : question}
              </span>
              {isAnswering && (
                <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/40" />
              )}
            </button>
          </div>
        )}

        {/* Question — shared ChatMessage */}
        <div className="border-b border-border/30 px-2 py-1">
          <ChatMessage role="user" content={displayedQuestion} className="py-2" />
        </div>

        {/* Thinking indicator — only visible during streaming */}
        {isViewingCurrent &&
          isAnswering &&
          (displayedThinking.isThinking || displayedThinking.content) && (
            <div className="border-b border-border/30 px-4 py-1.5">
              <ChatThinking thinking={displayedThinking} />
            </div>
          )}

        {/* Tool steps — only visible during streaming */}
        {isViewingCurrent && isAnswering && displayedToolHistory.length > 0 && (
          <div className="border-b border-border/30 px-4 py-1.5">
            <ChatToolSteps tools={displayedToolHistory} collapseThreshold={2} />
          </div>
        )}

        {/* Answer — shared ChatMessage */}
        <div ref={contentRef} className="overflow-y-auto px-2 py-1">
          {isViewingCurrent && error ? (
            <div className="px-4 py-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          ) : displayedAnswer ? (
            <ChatMessage
              role="assistant"
              content={displayedAnswer}
              isStreaming={isViewingCurrent && isAnswering}
              className="py-2"
            >
              {showFeedback && (
                <ChatFeedbackToolbar
                  messageId={`${conversationId || "unknown"}_turn_${displayedTurnIndex}`}
                  conversationId={conversationId || ""}
                  content={displayedAnswer}
                  userPrompt={displayedQuestion}
                  aiResponse={displayedAnswer}
                  eventType="kb_feedback"
                  turnIndex={displayedTurnIndex}
                  alwaysVisible
                />
              )}
            </ChatMessage>
          ) : isViewingCurrent &&
            isAnswering &&
            !displayedThinking.isThinking &&
            displayedToolHistory.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Thinking...</span>
            </div>
          ) : null}
        </div>

        {/* Sources — shared ChatSources */}
        {displayedSources.length > 0 && (
          <div className="border-t border-border/40 px-4 py-2.5">
            <ChatSources sources={displayedSources} onSourceClick={handleSourceClick} />
          </div>
        )}
      </div>

      {/* Follow-up input */}
      <div className="relative mt-3">
        <div
          className={cn(
            "absolute -inset-0.5 rounded-2xl opacity-0 blur-md transition-opacity duration-500",
            followUpFocused && "opacity-100"
          )}
          style={{
            background: "linear-gradient(135deg, #00f2ea20, #ff005020, #00f2ea20)",
          }}
        />
        <div
          className={cn(
            "relative flex items-center gap-2 rounded-2xl border px-3 py-2 transition-all duration-300",
            followUpFocused
              ? "border-foreground/15 bg-card shadow-lg"
              : "border-border/60 bg-card/80 shadow-sm"
          )}
        >
          <input
            ref={inputRef}
            type="text"
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
            onFocus={() => setFollowUpFocused(true)}
            onBlur={() => setFollowUpFocused(false)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a follow-up..."
            disabled={isAnswering}
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground/40 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={handleSubmit}
            disabled={!followUp.trim() || isAnswering}
            className={cn(
              "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-colors",
              followUp.trim()
                ? "bg-foreground text-background hover:bg-foreground/90"
                : "text-muted-foreground/60"
            )}
            aria-label="Send follow-up"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
