"use client";

import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import type { Heading } from "./types";

interface OutlineViewProps {
  headings: Heading[];
  activeId: string | null;
  onNavigate: (heading: Heading) => void;
}

/**
 * Traditional outline view - hierarchical indented text list
 * Truncates long titles with tooltip on hover
 */
export function OutlineView({
  headings,
  activeId,
  onNavigate,
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
                  "min-w-0 truncate",
                  heading.level === 1 && "font-semibold",
                  heading.level === 2 && "font-medium"
                )}
              >
                {heading.text || "Untitled"}
              </span>
            </button>
          );

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
