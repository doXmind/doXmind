"use client";

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import type { Heading } from "./types";

interface OutlineCollapsedProps {
  headings: Heading[];
  activeId: string | null;
  onNavigate: (heading: Heading) => void;
  onExpand: () => void;
}

// Notion-style minimap: each heading is a tiny horizontal line whose width
// encodes the heading level and whose indent communicates depth. Active
// heading is full ink; rest are dimmed with opacity.
const LEVEL_WIDTH_PX: Record<number, number> = {
  1: 18,
  2: 14,
  3: 10,
  4: 8,
  5: 7,
  6: 6,
};

const LEVEL_INDENT_PX = 4;

function widthForLevel(level: number) {
  return LEVEL_WIDTH_PX[level] ?? 6;
}

function indentForLevel(level: number) {
  return Math.max(0, level - 1) * LEVEL_INDENT_PX;
}

/**
 * Collapsed outline rail (Notion-style minimap).
 *
 * - One short horizontal line per heading
 * - Width encodes level (H1 longest → H6 shortest)
 * - Indent encodes level
 * - Active = full ink (opacity 1), hover = 78%, rest = 32%
 * - Hover the strip → soft container background lifts
 * - Click a line → navigate AND expand the panel
 * - Click empty space → expand the panel
 *
 * Tooltip floats LEFT (toward the document) since the rail sits on the
 * right edge of the editor.
 */
export function OutlineCollapsed({
  headings,
  activeId,
  onNavigate,
  onExpand,
}: OutlineCollapsedProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [stripHover, setStripHover] = useState(false);

  const handleHeadingClick = useCallback(
    (e: React.MouseEvent, heading: Heading) => {
      e.stopPropagation();
      onNavigate(heading);
      onExpand();
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
    <div
      className="relative flex w-full justify-end px-2.5 py-2"
      onMouseEnter={() => setStripHover(true)}
      onMouseLeave={() => {
        setStripHover(false);
        setHoveredId(null);
      }}
    >
      <div
        className={cn(
          "flex w-full flex-col items-start gap-[5px] rounded-md px-2 py-2.5 transition-colors duration-150",
          stripHover && "bg-foreground/[0.04]"
        )}
        title="Show outline"
        aria-label="Show outline"
      >
        {headings.map((heading) => {
          const isActive = heading.id === activeId;
          const isHover = hoveredId === heading.id;
          const w = widthForLevel(heading.level);
          const indent = indentForLevel(heading.level);
          const opacity = isActive ? 1 : isHover ? 0.78 : 0.32;

          return (
            <button
              key={heading.id}
              type="button"
              onClick={(e) => handleHeadingClick(e, heading)}
              onMouseEnter={() => setHoveredId(heading.id)}
              onFocus={() => setHoveredId(heading.id)}
              onBlur={() => setHoveredId(null)}
              className="relative flex h-3 cursor-pointer items-center bg-transparent p-0 outline-none focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:ring-offset-0"
              style={{ marginLeft: indent }}
              aria-label={`Navigate to: ${heading.text || "Untitled"}`}
              aria-current={isActive ? "location" : undefined}
            >
              <span
                aria-hidden="true"
                className="block rounded-[1px] bg-foreground transition-[opacity,width] duration-150"
                style={{ width: w, height: 2, opacity }}
              />
              {isHover && heading.text && (
                <span className="font-brand-sans pointer-events-none absolute right-[100%] top-1/2 z-10 -translate-x-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border/60 bg-popover px-2.5 py-1 text-[12px] font-medium text-popover-foreground shadow-[0_1px_2px_rgba(15,15,15,0.04),0_4px_12px_rgba(15,15,15,0.06)]">
                  {heading.text}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
