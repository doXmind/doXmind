"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Loader2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ThinkingStatus } from "@/hooks/use-chat";

interface ThinkingIndicatorProps {
  thinking: ThinkingStatus;
}

/**
 * Thinking indicator component that shows AI reasoning process.
 * Displays an expandable panel showing the AI's thought process.
 */
export function ThinkingIndicator({ thinking }: ThinkingIndicatorProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!thinking.content && !thinking.isThinking) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="ml-11 mb-2"
    >
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-colors duration-200 w-full text-left",
          thinking.isThinking
            ? "bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-purple-400"
            : "bg-purple-500/5 border-purple-500/15 text-purple-600/70 dark:text-purple-400/70"
        )}
      >
        <div className="relative flex-shrink-0">
          <Brain className="h-4 w-4" />
          {thinking.isThinking && (
            <motion.span
              className="absolute -top-1 -right-1 h-2 w-2 bg-purple-500 rounded-full"
              animate={{
                scale: [1, 1.3, 1],
                boxShadow: [
                  '0 0 0 0 rgba(168, 85, 247, 0.4)',
                  '0 0 0 6px rgba(168, 85, 247, 0)',
                  '0 0 0 0 rgba(168, 85, 247, 0.4)'
                ]
              }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
        </div>
        <span className="font-medium truncate flex-1">
          {thinking.isThinking ? "Thinking..." : "Thought process"}
        </span>
        {thinking.isThinking && <Loader2 className="h-3 w-3 animate-spin" />}
        <motion.span
          animate={{ rotate: isExpanded ? 90 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronRight className="h-4 w-4 flex-shrink-0" />
        </motion.span>
      </button>
      <AnimatePresence>
        {isExpanded && thinking.content && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-1 px-3 py-2 text-xs text-muted-foreground bg-muted/50 rounded-lg border border-border/50 max-h-[200px] overflow-y-auto whitespace-pre-wrap">
              {thinking.content}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
