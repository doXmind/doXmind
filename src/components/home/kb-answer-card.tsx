"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Search,
  BookOpen,
  X,
  Square,
  FileText,
  Send,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { marked } from "marked";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { telemetry } from "@/lib/telemetry";
import type { KBSource, KBTurn } from "@/hooks/use-kb-agent";

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
}

export function KBAnswerCard({
  question,
  answer,
  sources,
  activeTool,
  isAnswering,
  error,
  onClose,
  onStop,
  onAsk,
  history = [],
  conversationId,
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
    // Auto-scroll tab bar to end
    if (tabsRef.current) {
      tabsRef.current.scrollLeft = tabsRef.current.scrollWidth;
    }
  }, [totalTurns]);

  // Dynamically compute max-height for the answer content area
  const updateContentMaxHeight = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    // Reserve space below: feedback + sources + follow-up input + page bottom padding
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

  const htmlContent = useMemo(() => {
    if (!displayedAnswer) return "";
    return marked.parse(displayedAnswer, { async: false }) as string;
  }, [displayedAnswer]);

  const toolLabel = useMemo(() => {
    if (!activeTool) return null;
    if (activeTool === "search_files") return "Searching documents...";
    if (activeTool === "read_file_sections") return "Reading document...";
    return "Working...";
  }, [activeTool]);

  // Feedback state per turn
  const [feedbackMap, setFeedbackMap] = useState<Record<number, "positive" | "negative">>({});
  const displayedTurnIndex = isViewingCurrent ? totalTurns - 1 : activeTurnIndex;

  // Track when answer streaming completes for read-time measurement
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
  const currentFeedback = feedbackMap[displayedTurnIndex] ?? null;
  const showFeedback = displayedAnswer && !(isViewingCurrent && isAnswering);

  const handleFeedback = async (rating: "positive" | "negative") => {
    if (currentFeedback === rating) return;
    setFeedbackMap((prev) => ({ ...prev, [displayedTurnIndex]: rating }));

    const feedbackLatencyMs = answerCompleteTimeRef.current
      ? Date.now() - answerCompleteTimeRef.current
      : undefined;

    telemetry.trackChatFeedback({
      event_type: "kb_feedback",
      message_id: `${conversationId || "unknown"}_turn_${displayedTurnIndex}`,
      conversation_id: conversationId || "",
      user_prompt: displayedQuestion,
      ai_response: displayedAnswer,
      rating,
    });

    if (feedbackLatencyMs !== undefined) {
      telemetry.trackFeature("kb_search", "completed", undefined, {
        event: "feedback_timing",
        feedback_latency_ms: feedbackLatencyMs,
        rating,
        turn_index: displayedTurnIndex,
      });
    }

    await telemetry.flush();
  };

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
    router.push(`/editor/${fileId}`);
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
            <span className="text-xs font-medium text-muted-foreground">KB Assistant</span>
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

        {/* Turn tabs - only show when there's history */}
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
            {/* Current turn tab */}
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

        {/* Question */}
        <div className="border-b border-border/30 bg-accent/20 px-4 py-2">
          <p className="text-sm text-muted-foreground">{displayedQuestion}</p>
        </div>

        {/* Tool activity indicator - only for current turn */}
        <AnimatePresence>
          {isViewingCurrent && toolLabel && (
            <motion.div
              className="flex items-center gap-2 border-b border-border/30 bg-accent/30 px-4 py-1.5"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              {activeTool === "search_files" ? (
                <Search className="h-3 w-3 animate-pulse text-muted-foreground" />
              ) : (
                <BookOpen className="h-3 w-3 animate-pulse text-muted-foreground" />
              )}
              <span className="text-xs text-muted-foreground">{toolLabel}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Answer content */}
        <div ref={contentRef} className="overflow-y-auto px-4 py-3">
          {isViewingCurrent && error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : displayedAnswer ? (
            <div
              className="prose prose-sm max-w-none dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
              dangerouslySetInnerHTML={{ __html: htmlContent }}
            />
          ) : isViewingCurrent && isAnswering ? (
            <div className="flex items-center gap-2 py-1">
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/40" />
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/40 [animation-delay:150ms]" />
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/40 [animation-delay:300ms]" />
            </div>
          ) : null}

          {/* Streaming cursor - only for current turn */}
          {isViewingCurrent && isAnswering && displayedAnswer && (
            <span className="inline-block h-4 w-0.5 animate-pulse bg-foreground/60" />
          )}
        </div>

        {/* Feedback */}
        {showFeedback && (
          <div className="flex items-center justify-end gap-1 border-t border-border/30 px-4 py-1">
            <button
              type="button"
              onClick={() => handleFeedback("positive")}
              className={cn(
                "rounded p-1 transition-colors",
                "hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/20",
                currentFeedback === "positive"
                  ? "text-green-500 dark:text-green-400"
                  : "text-muted-foreground/40 hover:text-foreground"
              )}
              title="Good response"
              aria-label="Good response"
            >
              <ThumbsUp
                className={cn("h-3 w-3", currentFeedback === "positive" && "fill-current")}
              />
            </button>
            <button
              type="button"
              onClick={() => handleFeedback("negative")}
              className={cn(
                "rounded p-1 transition-colors",
                "hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/20",
                currentFeedback === "negative"
                  ? "text-red-500 dark:text-red-400"
                  : "text-muted-foreground/40 hover:text-foreground"
              )}
              title="Poor response"
              aria-label="Poor response"
            >
              <ThumbsDown
                className={cn("h-3 w-3", currentFeedback === "negative" && "fill-current")}
              />
            </button>
          </div>
        )}

        {/* Sources */}
        {displayedSources.length > 0 && (
          <div className="border-t border-border/40 px-4 py-2.5">
            <div className="flex flex-wrap gap-1.5">
              {displayedSources.map((source, i) => (
                <button
                  key={source.file_id}
                  onClick={() => handleSourceClick(source.file_id, i)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors hover:bg-accent",
                    source.score >= 0.7
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400"
                      : source.score >= 0.4
                        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400"
                        : "border-border bg-accent/50 text-muted-foreground"
                  )}
                >
                  <FileText className="h-3 w-3" />
                  <span className="max-w-[120px] truncate">{source.file_name}</span>
                  <span className="text-[10px] opacity-60">{Math.round(source.score * 100)}%</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Follow-up input — separate so glow isn't clipped */}
      <div className="relative mt-3">
        <div
          className={cn(
            "absolute -inset-0.5 rounded-xl opacity-0 blur-md transition-opacity duration-500",
            followUpFocused && "opacity-100"
          )}
          style={{
            background: "linear-gradient(135deg, #00f2ea20, #ff005020, #00f2ea20)",
          }}
        />
        <div
          className={cn(
            "relative flex items-center gap-2 rounded-xl border px-3 py-2 transition-all duration-300",
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
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
            aria-label="Send follow-up"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
