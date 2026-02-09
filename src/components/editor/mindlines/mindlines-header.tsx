"use client";

import { List, GitBranch, Maximize2, X } from "lucide-react";
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

  // Collapsed mode: entire header clickable to expand
  if (isCollapsed && !isExpanded) {
    return (
      <div
        className="flex cursor-pointer items-center justify-center border-b border-border/50 px-2 py-2 transition-colors hover:bg-accent/50"
        onClick={onToggleCollapse}
        title="Click to expand outline"
        role="button"
        aria-expanded={false}
        aria-label="Expand outline"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleCollapse();
          }
        }}
      >
        <List className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }

  // Expanded outline mode: header clickable to collapse, buttons use stopPropagation
  // Mindmap mode: no click handler on header
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between border-b border-border/50 px-3 py-2 transition-colors",
        // Expanded outline: clickable header with hover effect
        !isExpanded && "cursor-pointer hover:bg-accent/30",
        // Mindmap: normal header
        isExpanded && "px-4 py-3"
      )}
      onClick={!isExpanded ? onToggleCollapse : undefined}
      role={!isExpanded ? "button" : undefined}
      aria-expanded={!isExpanded ? true : undefined}
      aria-label={!isExpanded ? "Collapse outline" : undefined}
      tabIndex={!isExpanded ? 0 : undefined}
      onKeyDown={
        !isExpanded
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggleCollapse();
              }
            }
          : undefined
      }
    >
      {/* Title with icon - pointer-events-none so clicks pass through to header */}
      <div className="pointer-events-none flex items-center gap-2">
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

      {/* Action buttons - only show in expanded outline mode, use stopPropagation */}
      {!isExpanded && (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
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
      )}
    </div>
  );
}
