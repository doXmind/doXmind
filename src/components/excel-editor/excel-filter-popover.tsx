"use client";

/**
 * Column-filter popover — opens from the ▾ button on the column header
 * when filter mode is on. Lists every distinct display value in the
 * column with a checkbox; "Select all" / "Clear" handle bulk toggles.
 *
 * The list of unique values is computed by the workspace and passed in
 * — keeping the popover dumb so the workspace can dedupe + format
 * consistently with the rest of the editor.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ExcelFilterPopoverProps {
  anchor: { x: number; y: number };
  /** All distinct display values in the column. Order is preserved. */
  uniqueValues: string[];
  /** Currently visible values (subset of `uniqueValues`). */
  visibleValues: string[];
  onApply(visible: string[]): void;
  onClear(): void;
  onClose(): void;
}

export function ExcelFilterPopover({
  anchor,
  uniqueValues,
  visibleValues,
  onApply,
  onClear,
  onClose,
}: ExcelFilterPopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Set<string>>(() => new Set(visibleValues));
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchor.x, top: anchor.y });

  // Outside-click + Escape close. Same pattern as the rest of the
  // portal-based popovers in the editor.
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && containerRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const tid = window.setTimeout(() => {
      document.addEventListener("mousedown", onDown, true);
      document.addEventListener("keydown", onKey, true);
    }, 0);
    return () => {
      window.clearTimeout(tid);
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  // Clamp into the viewport once we've measured the popover.
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

  const filtered = useMemo(() => {
    if (!search) return uniqueValues;
    const needle = search.toLowerCase();
    return uniqueValues.filter((v) => v.toLowerCase().includes(needle));
  }, [uniqueValues, search]);

  const allSelected = filtered.every((v) => draft.has(v));
  const noneSelected = filtered.every((v) => !draft.has(v));

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Column filter"
      className="animate-in fade-in-0 zoom-in-95 fixed z-50 flex w-64 flex-col rounded-md border border-border/60 bg-popover text-popover-foreground shadow-lg"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1.5">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="text"
          value={search}
          placeholder="Search values"
          spellCheck={false}
          onChange={(event) => setSearch(event.target.value)}
          className="text-ui-xs h-6 flex-1 bg-transparent text-foreground outline-none"
        />
      </div>

      <div className="flex items-center justify-between border-b border-border/60 px-2 py-1">
        <button
          type="button"
          className="text-ui-xs text-primary hover:underline"
          onClick={() => setDraft(new Set([...draft, ...filtered]))}
          disabled={allSelected}
        >
          Select all
        </button>
        <button
          type="button"
          className="text-ui-xs text-primary hover:underline"
          onClick={() =>
            setDraft((prev) => {
              const next = new Set(prev);
              for (const v of filtered) next.delete(v);
              return next;
            })
          }
          disabled={noneSelected}
        >
          Clear
        </button>
      </div>

      <div className="max-h-60 overflow-y-auto p-1">
        {filtered.length === 0 ? (
          <div className="text-ui-xs px-2 py-2 text-muted-foreground">No values</div>
        ) : (
          filtered.map((value) => {
            const checked = draft.has(value);
            return (
              <label
                key={value}
                className={cn(
                  "text-ui-xs flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1",
                  "hover:bg-foreground/[0.04]"
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) =>
                    setDraft((prev) => {
                      const next = new Set(prev);
                      if (event.target.checked) next.add(value);
                      else next.delete(value);
                      return next;
                    })
                  }
                  className="h-3 w-3 cursor-pointer"
                />
                <span className="flex-1 truncate text-foreground/90">
                  {value === "" ? (
                    <span className="italic text-muted-foreground">(empty)</span>
                  ) : (
                    value
                  )}
                </span>
              </label>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-end gap-1 border-t border-border/60 p-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={() => {
            onClear();
            onClose();
          }}
        >
          Clear filter
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 px-2"
          onClick={() => {
            onApply(Array.from(draft));
            onClose();
          }}
        >
          OK
        </Button>
      </div>
    </div>,
    document.body
  );
}
