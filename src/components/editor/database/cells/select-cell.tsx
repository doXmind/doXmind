"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { Plus, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SelectChoice, SelectColor } from "@/extensions/database/database-types";
import { SELECT_COLOR_CLASSES, SELECT_COLORS } from "@/extensions/database/database-types";

interface SelectCellProps {
  value: string | string[] | null;
  choices: SelectChoice[];
  multiSelect?: boolean;
  onChange: (value: string | string[] | null) => void;
  onChoicesChange?: (choices: SelectChoice[]) => void;
}

interface DropdownPos {
  top: number | undefined;
  bottom: number | undefined;
  left: number;
}

export function SelectCell({
  value,
  choices,
  multiSelect = false,
  onChange,
  onChoicesChange,
}: SelectCellProps) {
  const t = useTranslations("database");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropdownPos, setDropdownPos] = useState<DropdownPos>({
    top: 0,
    bottom: undefined,
    left: 0,
  });
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const calcPosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownHeight = 280;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < dropdownHeight && rect.top > spaceBelow;

    setDropdownPos({
      top: openUp ? undefined : rect.bottom + 4,
      bottom: openUp ? window.innerHeight - rect.top + 4 : undefined,
      left: rect.left,
    });
  }, []);

  const handleOpen = useCallback(() => {
    calcPosition();
    setOpen(true);
  }, [calcPosition]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on scroll (position would be stale)
  useEffect(() => {
    if (!open) return;
    const handler = () => {
      setOpen(false);
      setSearch("");
    };
    // Capture phase to catch scroll on any ancestor
    window.addEventListener("scroll", handler, true);
    return () => window.removeEventListener("scroll", handler, true);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const selectedIds = multiSelect
    ? Array.isArray(value)
      ? value
      : []
    : value
      ? [value as string]
      : [];

  const selectedChoices = selectedIds
    .map((id) => choices.find((c) => c.id === id))
    .filter(Boolean) as SelectChoice[];

  const filteredChoices = choices.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const toggleChoice = useCallback(
    (choiceId: string) => {
      if (multiSelect) {
        const current = Array.isArray(value) ? value : [];
        const next = current.includes(choiceId)
          ? current.filter((id) => id !== choiceId)
          : [...current, choiceId];
        onChange(next.length > 0 ? next : null);
      } else {
        onChange(value === choiceId ? null : choiceId);
        setOpen(false);
        setSearch("");
      }
    },
    [value, multiSelect, onChange]
  );

  const addNewChoice = useCallback(() => {
    if (!search.trim() || !onChoicesChange) return;
    const newChoice: SelectChoice = {
      id: crypto.randomUUID(),
      name: search.trim(),
      color: SELECT_COLORS[choices.length % SELECT_COLORS.length],
    };
    onChoicesChange([...choices, newChoice]);
    toggleChoice(newChoice.id);
    setSearch("");
  }, [search, choices, onChoicesChange, toggleChoice]);

  const getColorClass = (color: string) => {
    return SELECT_COLOR_CLASSES[color as SelectColor] ?? SELECT_COLOR_CLASSES.gray;
  };

  return (
    <div ref={triggerRef} className="relative h-full w-full">
      {/* Display */}
      <div
        className="flex h-full w-full cursor-pointer flex-wrap items-center gap-1 px-2.5 py-1 transition-colors hover:bg-accent/30"
        onClick={handleOpen}
      >
        {selectedChoices.length > 0 ? (
          selectedChoices.map((c) => {
            const colors = getColorClass(c.color);
            return (
              <span
                key={c.id}
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium",
                  colors.bg,
                  colors.text
                )}
              >
                {c.name}
              </span>
            );
          })
        ) : (
          <span className="text-sm">&nbsp;</span>
        )}
      </div>

      {/* Dropdown via portal */}
      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            className="animate-in fade-in-0 zoom-in-95 fixed z-[100] w-64 rounded-lg border border-border bg-popover p-1 shadow-lg duration-100"
            style={{
              top: dropdownPos.top,
              bottom: dropdownPos.bottom,
              left: dropdownPos.left,
            }}
          >
            <input
              ref={inputRef}
              type="text"
              placeholder={t("searchOrCreate")}
              className="w-full rounded-md border-none bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground/50"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && search.trim() && filteredChoices.length === 0) {
                  addNewChoice();
                }
                if (e.key === "Escape") {
                  setOpen(false);
                  setSearch("");
                }
              }}
            />
            <div className="my-1 border-b border-border" />
            <div className="max-h-48 overflow-y-auto">
              {filteredChoices.map((c) => {
                const isSelected = selectedIds.includes(c.id);
                const colors = getColorClass(c.color);
                return (
                  <button
                    key={c.id}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/80",
                      isSelected && "bg-accent/30"
                    )}
                    onClick={() => toggleChoice(c.id)}
                  >
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        colors.bg,
                        colors.text
                      )}
                    >
                      {c.name}
                    </span>
                    {isSelected && <Check className="ml-auto h-3 w-3 text-primary" />}
                  </button>
                );
              })}
              {search.trim() && filteredChoices.length === 0 && (
                <>
                  <div className="my-1 border-b border-border" />
                  <button
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
                    onClick={addNewChoice}
                  >
                    <Plus className="h-3 w-3" />
                    {t("createChoice", { name: search })}
                  </button>
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
