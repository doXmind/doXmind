"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronUp, Check } from "lucide-react";
import { ChatToolStep } from "./chat-tool-step";
import { cn } from "@/lib/utils";
import type { ToolStatus } from "@/hooks/use-chat";

interface ChatToolStepsProps {
  tools: ToolStatus[];
  /** Number of completed tools to show before collapsing (default: 2) */
  collapseThreshold?: number;
  className?: string;
}

/**
 * Collapsible list of tool steps.
 * Keeps running + recent tools visible, collapses older completed ones.
 */
export function ChatToolSteps({ tools, collapseThreshold = 2, className }: ChatToolStepsProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const { runningTools, completedTools } = useMemo(() => {
    const running: ToolStatus[] = [];
    const completed: ToolStatus[] = [];

    for (const tool of tools) {
      if (tool.status === "running") running.push(tool);
      // Filter out error tools completely - don't show failed tool calls to users
      else if (tool.status === "completed") completed.push(tool);
      // tool.status === "error" is silently ignored
    }

    return { runningTools: running, completedTools: completed };
  }, [tools]);

  const shouldCollapse = completedTools.length > collapseThreshold && !isExpanded;
  const collapsedCount = shouldCollapse ? completedTools.length - collapseThreshold : 0;
  const visibleCompleted = shouldCollapse
    ? completedTools.slice(-collapseThreshold)
    : completedTools;

  if (tools.length === 0) return null;

  return (
    <div className={cn("space-y-0.5", className)}>
      {/* Collapsed summary */}
      {collapsedCount > 0 && (
        <button
          onClick={() => setIsExpanded(true)}
          className="flex items-center gap-1.5 rounded-md py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
          <span>
            {collapsedCount} more step{collapsedCount > 1 ? "s" : ""} completed
          </span>
          <ChevronDown className="h-3 w-3" />
        </button>
      )}

      {/* Expanded older tools */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-0.5 overflow-hidden"
          >
            {completedTools.slice(0, -collapseThreshold).map((tool, index) => (
              <ChatToolStep key={`${tool.name}-old-${index}`} tool={tool} />
            ))}
            <button
              onClick={() => setIsExpanded(false)}
              className="flex items-center gap-1 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronUp className="h-3 w-3" />
              <span>Show less</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Recent completed (includes error tools folded in) */}
      {visibleCompleted.map((tool, index) => (
        <ChatToolStep key={`${tool.name}-visible-${index}`} tool={tool} />
      ))}

      {/* Running */}
      {runningTools.map((tool, index) => (
        <ChatToolStep key={`${tool.name}-running-${index}`} tool={tool} />
      ))}
    </div>
  );
}
