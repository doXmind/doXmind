"use client";

/**
 * Formula autocomplete popover. Anchored under the editing cell, lists
 * function names matching the current prefix. The workspace owns the
 * `items` + `selectedIndex` state and feeds it down so the same data
 * drives both arrow-key navigation (handled inside the cell input) and
 * the visual highlight here.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

interface ExcelFormulaSuggestProps {
  anchor: { x: number; y: number };
  items: string[];
  selectedIndex: number;
  onPick(name: string): void;
}

export function ExcelFormulaSuggest({
  anchor,
  items,
  selectedIndex,
  onPick,
}: ExcelFormulaSuggestProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchor.x, top: anchor.y });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let left = anchor.x;
    let top = anchor.y;
    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    setPos({ left, top });
  }, [anchor.x, anchor.y]);

  // Keep the highlighted item scrolled into view — long lists (HF ships
  // ~400 functions) need this when arrow-keys walk past the visible
  // window.
  useEffect(() => {
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-suggest-index="${selectedIndex}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (items.length === 0) return null;

  return createPortal(
    <div
      ref={containerRef}
      role="listbox"
      aria-label="Formula suggestions"
      className="animate-in fade-in-0 fixed z-50 max-h-60 w-56 overflow-y-auto rounded-md border border-border/60 bg-popover p-1 text-popover-foreground shadow-lg"
      style={{ left: pos.left, top: pos.top }}
      // Mousedown inside the popover would blur the cell input and
      // commit the draft. preventDefault on mousedown keeps focus.
      onMouseDown={(event) => event.preventDefault()}
    >
      {items.map((name, idx) => (
        <button
          key={name}
          type="button"
          role="option"
          aria-selected={idx === selectedIndex}
          data-suggest-index={idx}
          onClick={() => onPick(name)}
          className={cn(
            "text-ui-sm flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1 font-mono",
            idx === selectedIndex
              ? "bg-primary text-primary-foreground"
              : "hover:bg-foreground/[0.06]"
          )}
        >
          <span className="flex-1 text-left">{name}</span>
        </button>
      ))}
    </div>,
    document.body
  );
}
