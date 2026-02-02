"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronUp, Check } from "lucide-react";
import { ToolIndicator } from "./tool-indicator";
import type { ToolStatus } from "@/hooks/use-chat";
import { cn } from "@/lib/utils";

interface ToolHistoryListProps {
  tools: ToolStatus[];
  /** Number of completed tools to show before collapsing (default: 2) */
  collapseThreshold?: number;
}

/**
 * A collapsible list of tool indicators.
 * When there are many completed tools, it collapses them into a summary
 * while keeping the running tool and recent completed tools visible.
 */
export function ToolHistoryList({ tools, collapseThreshold = 2 }: ToolHistoryListProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Separate running and completed tools
  const { runningTools, completedTools, errorTools } = useMemo(() => {
    const running: ToolStatus[] = [];
    const completed: ToolStatus[] = [];
    const errors: ToolStatus[] = [];

    for (const tool of tools) {
      if (tool.status === "running") {
        running.push(tool);
      } else if (tool.status === "error") {
        errors.push(tool);
      } else {
        completed.push(tool);
      }
    }

    return { runningTools: running, completedTools: completed, errorTools: errors };
  }, [tools]);

  // Determine if we should show collapsed view
  const shouldCollapse = completedTools.length > collapseThreshold && !isExpanded;
  const collapsedCount = shouldCollapse ? completedTools.length - collapseThreshold : 0;
  const visibleCompletedTools = shouldCollapse
    ? completedTools.slice(-collapseThreshold)
    : completedTools;

  // If no tools, render nothing
  if (tools.length === 0) return null;

  return (
    <div className="space-y-1">
      {/* Collapsed summary for many completed tools */}
      {collapsedCount > 0 && (
        <motion.button
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => setIsExpanded(true)}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs",
            "bg-muted/50 transition-colors hover:bg-muted",
            "text-muted-foreground hover:text-foreground"
          )}
        >
          <Check className="h-3 w-3 text-green-500" />
          <span>
            {collapsedCount} more tool{collapsedCount > 1 ? "s" : ""} executed
          </span>
          <ChevronDown className="ml-auto h-3 w-3" />
        </motion.button>
      )}

      {/* Expanded view of all completed tools */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-1 overflow-hidden"
          >
            {completedTools.slice(0, -collapseThreshold).map((tool, index) => (
              <ToolIndicator key={`${tool.name}-completed-${index}`} tool={tool} />
            ))}
            {/* Collapse button */}
            <button
              onClick={() => setIsExpanded(false)}
              className={cn(
                "flex w-full items-center justify-center gap-1 rounded-lg px-3 py-1 text-xs",
                "text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              )}
            >
              <ChevronUp className="h-3 w-3" />
              <span>Show less</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Always visible: recent completed tools */}
      {visibleCompletedTools.map((tool, index) => (
        <ToolIndicator key={`${tool.name}-visible-${index}`} tool={tool} />
      ))}

      {/* Always visible: error tools */}
      {errorTools.map((tool, index) => (
        <ToolIndicator key={`${tool.name}-error-${index}`} tool={tool} />
      ))}

      {/* Always visible: running tools (at the bottom) */}
      {runningTools.map((tool, index) => (
        <ToolIndicator key={`${tool.name}-running-${index}`} tool={tool} />
      ))}
    </div>
  );
}
