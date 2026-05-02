"use client";

/**
 * Compact color picker — used for both text-color and fill-color toolbar
 * buttons. Mirrors the `ContextMenuPortal` pattern from the workspace:
 * portalled to body, anchored at the trigger's bounding rect, owns its
 * own outside-click + Escape dismissal so we don't have to thread state
 * through the workspace.
 *
 * The swatch palette is intentionally tight (10 colors + reset) — Google
 * Sheets exposes more, but for the spike a Material-ish line is enough.
 * Custom colors land later behind a "Custom…" entry once we plumb a
 * native `<input type="color">`.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const TEXT_COLOR_SWATCHES = [
  "#111827",
  "#374151",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0891b2",
  "#2563eb",
  "#7c3aed",
  "#db2777",
] as const;

export const FILL_COLOR_SWATCHES = [
  "#ffffff",
  "#f3f4f6",
  "#fee2e2",
  "#fed7aa",
  "#fef3c7",
  "#dcfce7",
  "#cffafe",
  "#dbeafe",
  "#ede9fe",
  "#fce7f3",
] as const;

interface ExcelColorPickerProps {
  tooltip: string;
  value?: string;
  fallbackBar: string;
  swatches: readonly string[];
  resetLabel: string;
  disabled?: boolean;
  onChange(color: string | null): void;
  children: ReactNode;
}

export function ExcelColorPicker({
  tooltip,
  value,
  fallbackBar,
  swatches,
  resetLabel,
  disabled,
  onChange,
  children,
}: ExcelColorPickerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Close on outside click + Escape, attached after a tick so the click
  // that opened the picker doesn't immediately close it.
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

  // Anchor the popover under the trigger; clamp into the viewport.
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const margin = 8;
    const width = 192; // matches the popover's min-width below
    let left = rect.left;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin);
    }
    setPos({ left, top: rect.bottom + 6 });
  }, [open]);

  return (
    <>
      <Tooltip content={tooltip} side="bottom">
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="icon"
          className="relative h-7 w-7 rounded-md"
          disabled={disabled}
          aria-label={tooltip}
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {children}
          <span
            className="pointer-events-none absolute inset-x-1.5 bottom-1 h-[3px] rounded-sm"
            style={{ background: value ?? fallbackBar }}
          />
        </Button>
      </Tooltip>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popoverRef}
            role="menu"
            className="animate-in fade-in-0 zoom-in-95 fixed z-50 min-w-[192px] rounded-md border border-border/60 bg-popover p-2 text-popover-foreground shadow-lg"
            style={{ left: pos.left, top: pos.top }}
          >
            <button
              type="button"
              className="text-ui-xs flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-foreground/[0.06]"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              <span className="grid h-4 w-4 place-items-center rounded-sm border border-border/60">
                <span className="block h-3 w-3 rotate-45 border-t border-red-500" />
              </span>
              {resetLabel}
            </button>
            <div className="mt-1 grid grid-cols-5 gap-1">
              {swatches.map((color) => {
                const isActive = value?.toLowerCase() === color.toLowerCase();
                return (
                  <button
                    key={color}
                    type="button"
                    aria-label={color}
                    className={cn(
                      "h-6 w-6 rounded-sm border border-border/60 transition-transform",
                      "hover:scale-110",
                      isActive && "ring-2 ring-primary/60 ring-offset-1 ring-offset-popover"
                    )}
                    style={{ background: color }}
                    onClick={() => {
                      onChange(color);
                      setOpen(false);
                    }}
                  />
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
