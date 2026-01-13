"use client";

import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import type { Heading } from "./types";

interface OutlineViewProps {
  headings: Heading[];
  activeId: string | null;
  onNavigate: (heading: Heading) => void;
  isPreview?: boolean; // When true, show full text without truncation
}

/**
 * Traditional outline view - hierarchical indented text list
 * In collapsed mode: truncates long titles with tooltip
 * In preview mode: shows full titles (wider container)
 */
export function OutlineView({
  headings,
  activeId,
  onNavigate,
  isPreview = false,
}: OutlineViewProps) {
  if (headings.length === 0) {
    return (
      <div className="py-4 px-3 text-sm text-muted-foreground">
        Add headings to see outline
      </div>
    );
  }

  return (
    <div className="py-2 px-1 flex flex-col min-w-0">
      <nav className="flex flex-col" role="list">
        {headings.map((heading) => {
          const isActive = heading.id === activeId;
          const indent = (heading.level - 1) * 12;
          const indicator =
            heading.level === 1 ? "●" : heading.level === 2 ? "○" : "◦";

          const button = (
            <button
              onClick={() => onNavigate(heading)}
              className={cn(
                "w-full text-left py-1.5 px-2 rounded text-sm transition-colors",
                "hover:bg-accent/50 flex items-center gap-2 min-w-0",
                isActive && "bg-accent/30 border-l-2 border-primary"
              )}
              style={{ paddingLeft: `${indent + 8}px` }}
              role="listitem"
            >
              <span
                className={cn(
                  "shrink-0 text-xs",
                  heading.level === 1 && "text-primary",
                  heading.level === 2 && "text-muted-foreground",
                  heading.level === 3 && "text-muted-foreground/70"
                )}
              >
                {indicator}
              </span>
              <span
                className={cn(
                  "min-w-0",
                  // In preview mode, allow text to wrap; in collapsed mode, truncate
                  isPreview ? "line-clamp-2" : "truncate",
                  heading.level === 1 && "font-semibold",
                  heading.level === 2 && "font-medium"
                )}
              >
                {heading.text || "Untitled"}
              </span>
            </button>
          );

          // Only show tooltip in collapsed mode (when text is truncated)
          if (isPreview) {
            return <div key={heading.id}>{button}</div>;
          }

          return (
            <Tooltip key={heading.id} content={heading.text} side="right">
              {button}
            </Tooltip>
          );
        })}
      </nav>
    </div>
  );
}
