"use client";

import { useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Search, BookOpen, X, Square, FileText, Send } from "lucide-react";
import { marked } from "marked";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import type { KBSource } from "@/hooks/use-kb-agent";

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
}: KBAnswerCardProps) {
  const router = useRouter();
  const [followUp, setFollowUp] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const htmlContent = useMemo(() => {
    if (!answer) return "";
    return marked.parse(answer, { async: false }) as string;
  }, [answer]);

  const toolLabel = useMemo(() => {
    if (!activeTool) return null;
    if (activeTool === "search_files") return "Searching documents...";
    if (activeTool === "read_file_sections") return "Reading document...";
    return "Working...";
  }, [activeTool]);

  const handleSourceClick = (fileId: string) => {
    router.push(`/editor?id=${fileId}`);
  };

  const handleSubmit = () => {
    const q = followUp.trim();
    if (!q || isAnswering) return;
    onAsk(q);
    setFollowUp("");
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
            <Bot className="h-4 w-4 text-violet-500" />
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

        {/* Question */}
        <div className="border-b border-border/30 bg-accent/20 px-4 py-2">
          <p className="text-sm text-muted-foreground">{question}</p>
        </div>

        {/* Tool activity indicator */}
        <AnimatePresence>
          {toolLabel && (
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
        <div className="max-h-[55vh] overflow-y-auto px-4 py-3">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : answer ? (
            <div
              className="prose prose-sm max-w-none dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
              dangerouslySetInnerHTML={{ __html: htmlContent }}
            />
          ) : isAnswering ? (
            <div className="flex items-center gap-2 py-1">
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/40" />
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/40 [animation-delay:150ms]" />
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/40 [animation-delay:300ms]" />
            </div>
          ) : null}

          {/* Streaming cursor */}
          {isAnswering && answer && (
            <span className="inline-block h-4 w-0.5 animate-pulse bg-foreground/60" />
          )}
        </div>

        {/* Sources */}
        {sources.length > 0 && (
          <div className="border-t border-border/40 px-4 py-2.5">
            <div className="flex flex-wrap gap-1.5">
              {sources.map((source) => (
                <button
                  key={source.file_id}
                  onClick={() => handleSourceClick(source.file_id)}
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

        {/* Follow-up input */}
        <div className="border-t border-border/40 px-3 py-2">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
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
      </div>
    </motion.div>
  );
}
