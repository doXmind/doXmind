"use client";

/**
 * Font family dropdown — wider trigger than `ExcelMenuButton` so the
 * current font name is visible inline (matching Sheets / Excel). Each
 * option is rendered in its own family for a quick preview.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const FONT_FAMILY_OPTIONS = [
  { id: "default", label: "Default", value: null, css: undefined },
  { id: "arial", label: "Arial", value: "Arial", css: "Arial, sans-serif" },
  { id: "calibri", label: "Calibri", value: "Calibri", css: "Calibri, sans-serif" },
  { id: "helvetica", label: "Helvetica", value: "Helvetica", css: "Helvetica, sans-serif" },
  {
    id: "times",
    label: "Times New Roman",
    value: "Times New Roman",
    css: "'Times New Roman', serif",
  },
  { id: "courier", label: "Courier New", value: "Courier New", css: "'Courier New', monospace" },
  { id: "georgia", label: "Georgia", value: "Georgia", css: "Georgia, serif" },
  { id: "verdana", label: "Verdana", value: "Verdana", css: "Verdana, sans-serif" },
] as const;

interface ExcelFontFamilyButtonProps {
  value: string | undefined;
  disabled?: boolean;
  onChange(family: string | null): void;
}

export function ExcelFontFamilyButton({ value, disabled, onChange }: ExcelFontFamilyButtonProps) {
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
    const width = 220;
    let left = rect.left;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin);
    }
    setPos({ left, top: rect.bottom + 6 });
  }, [open]);

  const currentLabel =
    FONT_FAMILY_OPTIONS.find((opt) => opt.value && value && opt.value === value)?.label ??
    (value && value.length ? value : "Default");

  return (
    <>
      <Tooltip content="Font" side="bottom">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "text-ui-xs flex h-7 min-w-[112px] max-w-[160px] shrink-0 items-center justify-between gap-1.5",
            "rounded-md border border-border/70 bg-background px-2 font-medium text-foreground/90",
            "transition-colors hover:bg-foreground/[0.04]",
            "disabled:pointer-events-none disabled:opacity-50"
          )}
        >
          <span className="truncate">{currentLabel}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </Tooltip>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popoverRef}
            role="menu"
            className="animate-in fade-in-0 zoom-in-95 fixed z-50 max-h-80 min-w-[220px] overflow-y-auto rounded-md border border-border/60 bg-popover p-1 text-popover-foreground shadow-lg"
            style={{ left: pos.left, top: pos.top }}
          >
            {FONT_FAMILY_OPTIONS.map((opt) => {
              const isActive =
                opt.value === null ? !value : opt.value && value && opt.value === value;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "text-ui-sm flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none transition-colors",
                    "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent",
                    isActive && "bg-foreground/[0.06] text-foreground"
                  )}
                  style={{ fontFamily: opt.css }}
                >
                  <span className="flex h-3.5 w-3.5 items-center justify-center">
                    {isActive ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span className="flex-1 text-left">{opt.label}</span>
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
