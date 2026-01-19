"use client";

import { useCallback } from "react";
import { cn } from "@/lib/utils";
import type { Heading } from "./types";

interface OutlineCollapsedProps {
  headings: Heading[];
  activeId: string | null;
  onNavigate: (heading: Heading) => void;
  onExpand: () => void;
}

/**
 * Collapsed outline view - shows minimal line indicators for document structure
 * Each heading is represented by a short horizontal line, indented by level
 * Click heading to navigate AND expand the outline
 * Click empty space to expand
 */
export function OutlineCollapsed({
  headings,
  activeId,
  onNavigate,
  onExpand,
}: OutlineCollapsedProps) {
  const handleHeadingClick = useCallback(
    (e: React.MouseEvent, heading: Heading) => {
      e.stopPropagation(); // Prevent bubbling to container onClick
      onNavigate(heading); // Navigate to heading
      onExpand(); // Expand the outline
    },
    [onNavigate, onExpand]
  );

  if (headings.length === 0) {
    return (
      <div className="flex items-center justify-center py-4">
        <div className="h-3 w-3 rounded-full bg-muted-foreground/20" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 py-2">
      {headings.map((heading) => (
        <button
          key={heading.id}
          className={cn(
            "flex h-5 cursor-pointer items-center rounded transition-colors",
            "hover:bg-accent/50",
            heading.id === activeId && "bg-accent"
          )}
          style={{ paddingLeft: `${(heading.level - 1) * 8 + 8}px` }}
          onClick={(e) => handleHeadingClick(e, heading)}
          title={`${heading.text || "Untitled"} - Click to navigate and expand`}
          aria-label={`Navigate to: ${heading.text || "Untitled"}`}
        >
          <div
            className={cn(
              "outline-line-indicator",
              heading.id === activeId && "active"
            )}
          />
        </button>
      ))}
    </div>
  );
}
