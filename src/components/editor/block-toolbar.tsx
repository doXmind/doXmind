"use client";

import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

export interface BlockToolbarAction {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  isActive?: boolean;
  isDestructive?: boolean;
}

interface BlockToolbarProps {
  actions: BlockToolbarAction[];
  /** Indices after which to render a vertical divider */
  separatorAfter?: number[];
  className?: string;
}

/**
 * Reusable inline toolbar for non-text blocks (Image, Math, Chart).
 * Renders above the block content when the block is in "selected" phase.
 */
export function BlockToolbar({ actions, separatorAfter = [], className }: BlockToolbarProps) {
  const separatorSet = new Set(separatorAfter);

  return (
    <div
      className={cn(
        "block-toolbar-enter mb-1.5 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-sm",
        className
      )}
      // Prevent clicks on toolbar from propagating to the block's click handler
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {actions.map((action, idx) => (
        <span key={action.label} className="contents">
          <Tooltip content={action.label} side="top">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                action.onClick();
              }}
              className={cn(
                "h-7 w-7",
                action.isActive && "bg-accent",
                action.isDestructive && "text-destructive hover:text-destructive"
              )}
            >
              {action.icon}
            </Button>
          </Tooltip>
          {separatorSet.has(idx) && <div className="mx-0.5 h-5 w-px bg-border" />}
        </span>
      ))}
    </div>
  );
}
