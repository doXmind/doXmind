"use client";

import { List, GitBranch, Maximize2, X, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MindlinesMode } from "./use-mindlines-state";

interface MindlinesHeaderProps {
  mode: MindlinesMode;
  isCollapsed: boolean;
  onToggle: () => void;
  onToggleCollapse: () => void;
  onClose: () => void;
  headingsCount: number;
}

/**
 * Header component for Mindlines
 *
 * Interaction design:
 * - Collapsed mode: Entire header is clickable to expand (shows List icon)
 * - Expanded outline mode: Entire header is clickable to collapse (buttons use stopPropagation)
 * - Mindmap mode: Controls are in the mindmap panel itself
 */
export function MindlinesHeader({
  mode,
  isCollapsed,
  onToggle,
  onToggleCollapse,
  onClose,
  headingsCount,
}: MindlinesHeaderProps) {
  const isExpanded = mode === "expanded";
  const title = isExpanded ? "Mindmap" : "Outline";
  const Icon = isExpanded ? GitBranch : List;

  // Collapsed mode: toggle button to expand
  if (isCollapsed && !isExpanded) {
    return (
      <div className="flex items-center justify-center border-b border-border/50 px-2 py-2">
        <button
          onClick={onToggleCollapse}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Expand outline"
          aria-expanded={false}
          aria-label="Expand outline"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // Expanded outline or mindmap mode
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between border-b border-border/50 px-3 py-2 transition-colors",
        isExpanded && "px-4 py-3"
      )}
    >
      {/* Left: title with icon */}
      <div className="flex items-center gap-2">
        <Icon className={cn("text-muted-foreground", isExpanded ? "h-5 w-5" : "h-4 w-4")} />
        <span
          className={cn(
            "font-medium uppercase tracking-wide text-muted-foreground",
            isExpanded ? "text-sm" : "text-xs"
          )}
        >
          {title}
        </span>
        {headingsCount > 0 && (
          <span className="text-xs text-muted-foreground/60">({headingsCount})</span>
        )}
      </div>

      {/* Right: action buttons */}
      {!isExpanded ? (
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleCollapse}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Collapse outline"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className="h-7 w-7"
            title="Expand to mindmap"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-7 w-7"
            title="Close outline"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
