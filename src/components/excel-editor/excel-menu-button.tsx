"use client";

/**
 * Toolbar dropdown — anchored to a Button, portalled to body, owns its own
 * outside-click + Escape handling. Used for the "More formats" menu and any
 * other compact toolbar dropdown that the existing project-wide
 * `DropdownMenu` doesn't quite fit (its anchorPoint code path didn't reliably
 * dismiss for our usage).
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface ExcelMenuItem {
  id: string;
  label: ReactNode;
  /** Optional small example / shortcut text shown to the right. */
  example?: string;
  active?: boolean;
  disabled?: boolean;
  onSelect(): void;
}

interface ExcelMenuButtonProps {
  tooltip: string;
  trigger: ReactNode;
  items: ExcelMenuItem[];
  /** Pixel width of the popover. */
  width?: number;
  disabled?: boolean;
  className?: string;
}

export function ExcelMenuButton({
  tooltip,
  trigger,
  items,
  width = 220,
  disabled,
  className,
}: ExcelMenuButtonProps) {
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
    let left = rect.left;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin);
    }
    setPos({ left, top: rect.bottom + 6 });
  }, [open, width]);

  return (
    <>
      <Tooltip content={tooltip} side="bottom">
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="icon"
          className={cn("h-7 w-7 rounded-md", className)}
          disabled={disabled}
          aria-label={tooltip}
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {trigger}
        </Button>
      </Tooltip>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popoverRef}
            role="menu"
            className="animate-in fade-in-0 zoom-in-95 fixed z-50 overflow-hidden rounded-md border border-border/60 bg-popover p-1 text-popover-foreground shadow-lg"
            style={{ left: pos.left, top: pos.top, width }}
          >
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) return;
                  item.onSelect();
                  setOpen(false);
                }}
                className={cn(
                  "text-ui-sm flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none transition-colors",
                  "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent",
                  item.active && "bg-foreground/[0.06] text-foreground",
                  item.disabled && "pointer-events-none opacity-50"
                )}
              >
                <span className="flex-1 text-left">{item.label}</span>
                {item.example && (
                  <span className="font-mono text-xs text-muted-foreground">{item.example}</span>
                )}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
