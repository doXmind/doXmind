"use client";

/**
 * Borders picker — opens a popover with the nine high-frequency Sheets/Excel
 * patterns. Style is hardcoded to "thin" for the spike; line-style and
 * border-color customization come later.
 *
 * Each pattern is delivered as a flag set the workspace interprets when
 * computing the *full desired* border config per cell. The workspace owns
 * the per-cell math (which sides to set / clear given the selection bounds)
 * because that's where it has access to the parsed cells underneath.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type BorderPattern =
  | "all"
  | "inner"
  | "horizontal"
  | "vertical"
  | "outer"
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "none";

interface PatternEntry {
  id: BorderPattern;
  label: string;
  /** Inline SVG used for the picker tile. Strokes use `currentColor`. */
  icon: () => ReactElement;
}

// 14×14 pattern tiles. Solid lines = applied border, dashed grey lines =
// unaffected gridline so the user reads the pattern as a delta.
const TILE = "M 1 1 H 13 V 13 H 1 Z";

function frame(active: { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean }) {
  const lines: ReactElement[] = [];
  // Inactive frame as a faint dotted square — gives the grid context.
  lines.push(
    <path
      key="frame"
      d={TILE}
      stroke="currentColor"
      strokeOpacity={0.25}
      strokeDasharray="1.5 1.5"
      strokeWidth={1}
      fill="none"
    />
  );
  if (active.top)
    lines.push(
      <line key="t" x1={1} y1={1} x2={13} y2={1} stroke="currentColor" strokeWidth={1.5} />
    );
  if (active.right)
    lines.push(
      <line key="r" x1={13} y1={1} x2={13} y2={13} stroke="currentColor" strokeWidth={1.5} />
    );
  if (active.bottom)
    lines.push(
      <line key="b" x1={1} y1={13} x2={13} y2={13} stroke="currentColor" strokeWidth={1.5} />
    );
  if (active.left)
    lines.push(
      <line key="l" x1={1} y1={1} x2={1} y2={13} stroke="currentColor" strokeWidth={1.5} />
    );
  return lines;
}

const PATTERNS: PatternEntry[] = [
  {
    id: "all",
    label: "All borders",
    icon: () => (
      <svg viewBox="0 0 14 14" className="h-3.5 w-3.5">
        {frame({ top: true, right: true, bottom: true, left: true })}
        <line x1={7} y1={1} x2={7} y2={13} stroke="currentColor" strokeWidth={1.5} />
        <line x1={1} y1={7} x2={13} y2={7} stroke="currentColor" strokeWidth={1.5} />
      </svg>
    ),
  },
  {
    id: "inner",
    label: "Inner borders",
    icon: () => (
      <svg viewBox="0 0 14 14" className="h-3.5 w-3.5">
        {frame({})}
        <line x1={7} y1={1} x2={7} y2={13} stroke="currentColor" strokeWidth={1.5} />
        <line x1={1} y1={7} x2={13} y2={7} stroke="currentColor" strokeWidth={1.5} />
      </svg>
    ),
  },
  {
    id: "horizontal",
    label: "Horizontal lines",
    icon: () => (
      <svg viewBox="0 0 14 14" className="h-3.5 w-3.5">
        {frame({})}
        <line x1={1} y1={7} x2={13} y2={7} stroke="currentColor" strokeWidth={1.5} />
      </svg>
    ),
  },
  {
    id: "vertical",
    label: "Vertical lines",
    icon: () => (
      <svg viewBox="0 0 14 14" className="h-3.5 w-3.5">
        {frame({})}
        <line x1={7} y1={1} x2={7} y2={13} stroke="currentColor" strokeWidth={1.5} />
      </svg>
    ),
  },
  {
    id: "outer",
    label: "Outer borders",
    icon: () => (
      <svg viewBox="0 0 14 14" className="h-3.5 w-3.5">
        {frame({ top: true, right: true, bottom: true, left: true })}
      </svg>
    ),
  },
  {
    id: "top",
    label: "Top border",
    icon: () => (
      <svg viewBox="0 0 14 14" className="h-3.5 w-3.5">
        {frame({ top: true })}
      </svg>
    ),
  },
  {
    id: "bottom",
    label: "Bottom border",
    icon: () => (
      <svg viewBox="0 0 14 14" className="h-3.5 w-3.5">
        {frame({ bottom: true })}
      </svg>
    ),
  },
  {
    id: "left",
    label: "Left border",
    icon: () => (
      <svg viewBox="0 0 14 14" className="h-3.5 w-3.5">
        {frame({ left: true })}
      </svg>
    ),
  },
  {
    id: "right",
    label: "Right border",
    icon: () => (
      <svg viewBox="0 0 14 14" className="h-3.5 w-3.5">
        {frame({ right: true })}
      </svg>
    ),
  },
  {
    id: "none",
    label: "Clear borders",
    icon: () => (
      <svg viewBox="0 0 14 14" className="h-3.5 w-3.5">
        {frame({})}
      </svg>
    ),
  },
];

interface ExcelBordersButtonProps {
  disabled?: boolean;
  onPattern(pattern: BorderPattern): void;
}

export function ExcelBordersButton({ disabled, onPattern }: ExcelBordersButtonProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const tid = window.setTimeout(() => {
      document.addEventListener("mousedown", onMouseDown, true);
      document.addEventListener("keydown", onKey, true);
    }, 0);
    return () => {
      window.clearTimeout(tid);
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const margin = 8;
    const width = 200;
    let left = rect.left;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin);
    }
    setPos({ left, top: rect.bottom + 6 });
  }, [open]);

  return (
    <>
      <Tooltip content="Borders" side="bottom">
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-md"
          disabled={disabled}
          aria-haspopup="true"
          aria-expanded={open}
          aria-label="Borders"
          onClick={() => setOpen((v) => !v)}
        >
          <svg viewBox="0 0 14 14" className="h-3.5 w-3.5">
            {frame({ top: true, right: true, bottom: true, left: true })}
          </svg>
        </Button>
      </Tooltip>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popoverRef}
            role="menu"
            className="animate-in fade-in-0 zoom-in-95 fixed z-50 min-w-[200px] rounded-md border border-border/60 bg-popover p-2 text-popover-foreground shadow-lg"
            style={{ left: pos.left, top: pos.top }}
          >
            <div className="grid grid-cols-5 gap-1">
              {PATTERNS.map((p) => (
                <Tooltip key={p.id} content={p.label} side="bottom">
                  <button
                    type="button"
                    role="menuitem"
                    aria-label={p.label}
                    onClick={() => {
                      onPattern(p.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-sm transition-colors",
                      "text-foreground/80 hover:bg-foreground/[0.06]"
                    )}
                  >
                    {p.icon()}
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
