"use client";

import { List, GitBranch, Maximize2, PanelLeftClose } from "lucide-react";
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
 * Shows title, expand toggle, and close button (only in non-expanded mode)
 * In expanded mode, controls are in the mindmap panel itself
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

      {/* Action buttons - only show in non-expanded mode */}
      {!isExpanded && (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className="h-7 w-7"
            title="Expand to mindmap"
          >
            <Maximize2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-7 w-7"
            title="Close outline"
          >
            <PanelLeftClose className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
