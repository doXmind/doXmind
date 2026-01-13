"use client";

import { List, GitBranch, X, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MindlinesMode } from "./use-mindlines-state";

interface MindlinesHeaderProps {
  mode: MindlinesMode;
  onToggle: () => void;
  onClose: () => void;
  headingsCount: number;
}

/**
 * Header component for Mindlines
 * Shows title, expand/collapse toggle, and close button (in expanded mode)
 */
export function MindlinesHeader({
  mode,
  onToggle,
  onClose,
  headingsCount,
}: MindlinesHeaderProps) {
  const isExpanded = mode === "expanded";
  const title = isExpanded ? "Mindmap" : "Outline";
  const Icon = isExpanded ? GitBranch : List;

  return (
    <div
      className={cn(
        "flex items-center justify-between px-3 py-2 border-b border-border/50 shrink-0",
        isExpanded && "px-4 py-3"
      )}
    >
      {/* Title with icon */}
      <div className="flex items-center gap-2">
        <Icon
          className={cn(
            "text-muted-foreground",
            isExpanded ? "w-5 h-5" : "w-4 h-4"
          )}
        />
        <span
          className={cn(
            "font-medium text-muted-foreground uppercase tracking-wide",
            isExpanded ? "text-sm" : "text-xs"
          )}
        >
          {title}
        </span>
        {headingsCount > 0 && (
          <span className="text-xs text-muted-foreground/60">
            ({headingsCount})
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1">
        {/* Expand/Collapse toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className="h-7 w-7"
          title={isExpanded ? "Collapse to outline" : "Expand to mindmap"}
        >
          {isExpanded ? (
            <Minimize2 className="w-4 h-4" />
          ) : (
            <Maximize2 className="w-4 h-4" />
          )}
        </Button>

        {/* Close button (only in expanded mode) */}
        {isExpanded && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-7 w-7"
            title="Close"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
