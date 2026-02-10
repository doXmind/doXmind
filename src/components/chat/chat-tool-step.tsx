"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Check, AlertCircle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { getToolIcon, getToolDisplayName } from "./tool-utils";
import type { ToolStatus } from "@/hooks/use-chat";

interface ChatToolStepProps {
  tool: ToolStatus;
  defaultExpanded?: boolean;
}

/**
 * Minimal tool call pill/chip.
 * Shows icon + name + status indicator. Click to expand details.
 */
export function ChatToolStep({ tool, defaultExpanded = false }: ChatToolStepProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const Icon = getToolIcon(tool.name);
  const displayName = getToolDisplayName(tool.name);
  const hasDetail = !!tool.message && tool.status !== "running";

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
    >
      <button
        type="button"
        onClick={() => hasDetail && setIsExpanded(!isExpanded)}
        className={cn(
          "flex items-center gap-1.5 rounded-md py-1 text-xs transition-colors",
          hasDetail && "cursor-pointer hover:bg-muted/50",
          !hasDetail && "cursor-default",
          tool.status === "running" && "text-foreground",
          tool.status === "completed" && "text-muted-foreground",
          tool.status === "error" && "text-red-600 dark:text-red-400"
        )}
      >
        {/* Status icon */}
        {tool.status === "running" ? (
          <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin" />
        ) : tool.status === "completed" ? (
          <Check className="h-3 w-3 flex-shrink-0 text-green-600 dark:text-green-400" />
        ) : (
          <AlertCircle className="h-3 w-3 flex-shrink-0" />
        )}

        {/* Tool icon */}
        <Icon className="h-3 w-3 flex-shrink-0" />

        {/* Tool name */}
        <span className="truncate">
          {tool.status === "running" ? `${displayName}...` : tool.message || displayName}
        </span>

        {/* Expand chevron if has detail */}
        {hasDetail && (
          <ChevronRight
            className={cn(
              "h-3 w-3 flex-shrink-0 transition-transform duration-150",
              isExpanded && "rotate-90"
            )}
          />
        )}
      </button>

      {/* Expanded detail */}
      {isExpanded && tool.message && (
        <div className="ml-6 mt-1 rounded-md bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
          {tool.message}
        </div>
      )}
    </motion.div>
  );
}
