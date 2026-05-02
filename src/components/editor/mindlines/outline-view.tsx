"use client";

import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { Heading } from "./types";

interface OutlineViewProps {
  headings: Heading[];
  activeId: string | null;
  onNavigate: (heading: Heading) => void;
}

interface OutlineItemProps {
  heading: Heading;
  activeId: string | null;
  onNavigate: (heading: Heading) => void;
}

const LEVEL_PADDING: Record<number, string> = {
  1: "pl-3",
  2: "pl-6",
  3: "pl-9",
  4: "pl-12",
  5: "pl-14",
  6: "pl-16",
};

function OutlineItem({ heading, activeId, onNavigate }: OutlineItemProps) {
  const isActive = heading.id === activeId;
  const itemRef = useRef<HTMLButtonElement>(null);

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

  const handleClick = useCallback(() => {
    onNavigate(heading);
  }, [heading, onNavigate]);

  return (
    <button
      ref={itemRef}
      type="button"
      onClick={handleClick}
      className={cn(
        "group relative flex w-full min-w-0 rounded-sm py-1.5 pr-2 text-left transition-colors",
        LEVEL_PADDING[heading.level] ?? "pl-16",
        "text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        isActive && "text-foreground"
      )}
      aria-current={isActive ? "location" : undefined}
      title={heading.text || "Untitled"}
    >
      <span
        className={cn(
          "absolute bottom-1.5 left-0 top-1.5 w-px rounded-full bg-border transition-colors",
          isActive ? "bg-foreground" : "group-hover:bg-muted-foreground/50"
        )}
        aria-hidden="true"
      />
      <span
        className={cn(
          "line-clamp-2 min-w-0 text-[13px] leading-snug",
          heading.level === 1 && "font-medium",
          heading.level >= 4 && "text-[12px]",
          isActive && "font-medium"
        )}
      >
        {heading.text || "Untitled"}
      </span>
    </button>
  );
}

export function OutlineView({ headings, activeId, onNavigate }: OutlineViewProps) {
  if (headings.length === 0) {
    return (
      <div className="px-3 py-4 text-sm text-muted-foreground">Add headings to see outline</div>
    );
  }

  return (
    <nav className="flex min-w-0 flex-col gap-0.5 px-2 py-1" aria-label="Document outline">
      {headings.map((heading) => (
        <OutlineItem
          key={heading.id}
          heading={heading}
          activeId={activeId}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}
