"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Heading } from "./types";

interface OutlineViewProps {
  headings: Heading[];
  activeId: string | null;
  onNavigate: (heading: Heading) => void;
}

interface OutlineItemProps {
  heading: Heading;
  isActive: boolean;
  hoveredId: string | null;
  onHoverChange: (id: string | null) => void;
  onNavigate: (heading: Heading) => void;
}

const BASE_INDENT_PX = 16;
const PER_LEVEL_INDENT_PX = 16;

function levelWeightClass(level: number, isActive: boolean) {
  if (isActive) return "font-semibold";
  if (level <= 1) return "font-semibold";
  if (level === 2) return "font-medium";
  return "font-normal";
}

function levelOpacityClass(level: number, isActive: boolean, isHover: boolean) {
  if (isActive || isHover) return "text-foreground";
  if (level <= 1) return "text-foreground";
  if (level === 2) return "text-foreground/[0.78]";
  return "text-foreground/[0.55]";
}

function OutlineItem({
  heading,
  isActive,
  hoveredId,
  onHoverChange,
  onNavigate,
}: OutlineItemProps) {
  const itemRef = useRef<HTMLButtonElement>(null);
  const isHover = hoveredId === heading.id;

  // The list lives on the right edge of the editor — when text overflows,
  // the pill tooltip floats LEFT into the doc area so it never escapes
  // the window. (Matches the design's intent — interior side of the panel.)
  const indentPx = BASE_INDENT_PX + (heading.level - 1) * PER_LEVEL_INDENT_PX;
  const fontSize = heading.level === 1 ? 13.5 : 13;

  useEffect(() => {
    if (!isActive || !itemRef.current) return;

    const el = itemRef.current;
    let scrollParent: HTMLElement | null = el.parentElement;
    while (scrollParent) {
      const { overflowY } = getComputedStyle(scrollParent);
      if (overflowY === "auto" || overflowY === "scroll") break;
      scrollParent = scrollParent.parentElement;
    }
    if (!scrollParent) return;

    const elRect = el.getBoundingClientRect();
    const parentRect = scrollParent.getBoundingClientRect();
    if (elRect.top < parentRect.top + 12) {
      scrollParent.scrollTop += elRect.top - parentRect.top - 12;
    } else if (elRect.bottom > parentRect.bottom - 12) {
      scrollParent.scrollTop += elRect.bottom - parentRect.bottom + 12;
    }
  }, [isActive]);

  const handleClick = useCallback(() => onNavigate(heading), [heading, onNavigate]);

  return (
    <button
      ref={itemRef}
      type="button"
      onClick={handleClick}
      onMouseEnter={() => onHoverChange(heading.id)}
      onMouseLeave={() => onHoverChange(null)}
      onFocus={() => onHoverChange(heading.id)}
      onBlur={() => onHoverChange(null)}
      className="group relative flex w-full min-w-0 cursor-pointer items-center py-[5px] pr-3 text-left transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
      style={{ paddingLeft: indentPx, minHeight: 26 }}
      aria-current={isActive ? "location" : undefined}
      title={undefined}
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate leading-[1.4] tracking-[-0.005em] transition-colors duration-150",
          levelWeightClass(heading.level, isActive),
          levelOpacityClass(heading.level, isActive, isHover)
        )}
        style={{ fontSize }}
      >
        {heading.text || "Untitled"}
      </span>

      {isHover && heading.text && (
        <span className="font-brand-sans pointer-events-none absolute right-[100%] top-1/2 z-10 -translate-x-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border/60 bg-popover px-2.5 py-1 text-[12px] font-medium text-popover-foreground shadow-[0_1px_2px_rgba(15,15,15,0.04),0_4px_12px_rgba(15,15,15,0.06)]">
          {heading.text}
        </span>
      )}
    </button>
  );
}

export function OutlineView({ headings, activeId, onNavigate }: OutlineViewProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (headings.length === 0) {
    return (
      <div className="px-4 py-4 text-[12px] text-muted-foreground">Add headings to see outline</div>
    );
  }

  return (
    <nav className="font-brand-sans flex min-w-0 flex-col py-2.5" aria-label="Document outline">
      {headings.map((heading) => (
        <OutlineItem
          key={heading.id}
          heading={heading}
          isActive={heading.id === activeId}
          hoveredId={hoveredId}
          onHoverChange={setHoveredId}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}
