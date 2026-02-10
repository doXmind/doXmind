"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Loader2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ThinkingStatus } from "@/hooks/use-chat";

interface ChatThinkingProps {
  thinking: ThinkingStatus;
  className?: string;
}

/**
 * Neutral pill-shaped thinking indicator.
 * Shows "Thinking..." while active, expandable content when done.
 */
export function ChatThinking({ thinking, className }: ChatThinkingProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!thinking.content && !thinking.isThinking) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      className={className}
    >
      <button
        type="button"
        onClick={() => thinking.content && setIsExpanded(!isExpanded)}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors",
          thinking.isThinking
            ? "bg-muted/60 text-muted-foreground"
            : "bg-muted/40 text-muted-foreground/70 hover:bg-muted/60",
          thinking.content && "cursor-pointer"
        )}
      >
        {thinking.isThinking ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Brain className="h-3 w-3" />
        )}
        <span className="font-medium">
          {thinking.isThinking ? "Thinking..." : "Thought process"}
        </span>
        {thinking.content && (
          <ChevronRight
            className={cn("h-3 w-3 transition-transform duration-150", isExpanded && "rotate-90")}
          />
        )}
      </button>

      <AnimatePresence>
        {isExpanded && thinking.content && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-1.5 max-h-[200px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {thinking.content}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
