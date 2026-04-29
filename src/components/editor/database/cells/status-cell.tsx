"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { Plus, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  SelectChoice,
  SelectColor,
  StatusCategory,
} from "@/extensions/database/database-types";
import {
  SELECT_COLOR_CLASSES,
  SELECT_COLOR_DOT_CLASSES,
  SELECT_COLORS,
  DEFAULT_STATUS_CATEGORIES,
} from "@/extensions/database/database-types";

interface StatusCellProps {
  value: string | null;
  choices: SelectChoice[];
  categories?: StatusCategory[];
  onChange: (value: string | null) => void;
  onChoicesChange?: (choices: SelectChoice[]) => void;
}

interface DropdownPos {
  top: number | undefined;
  bottom: number | undefined;
  left: number;
}

export function StatusCell({
  value,
  choices,
  categories,
  onChange,
  onChoicesChange,
}: StatusCellProps) {
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

  const statusCategories = categories ?? DEFAULT_STATUS_CATEGORIES;

  const calcPosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownHeight = 320;
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

  useEffect(() => {
    if (!open) return;
    const handler = () => {
      setOpen(false);
      setSearch("");
    };
    window.addEventListener("scroll", handler, true);
    return () => window.removeEventListener("scroll", handler, true);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const selectedChoice = value ? choices.find((c) => c.id === value) : undefined;

  const filteredChoices = choices.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  // Group choices by category
  const getChoicesByCategory = (catId: string) => {
    const cat = statusCategories.find((c) => c.id === catId);
    if (!cat) return [];
    return filteredChoices.filter((c) => cat.optionIds.includes(c.id));
  };

  const getUncategorizedChoices = () => {
    const allCategorized = statusCategories.flatMap((c) => c.optionIds);
    return filteredChoices.filter((c) => !allCategorized.includes(c.id));
  };

  const toggleChoice = useCallback(
    (choiceId: string) => {
      onChange(value === choiceId ? null : choiceId);
      setOpen(false);
      setSearch("");
    },
    [value, onChange]
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

  // Determine dot color from selected choice or category
  const getDotColor = () => {
    if (!selectedChoice) return "bg-gray-400 dark:bg-zinc-300";
    return (
      SELECT_COLOR_DOT_CLASSES[selectedChoice.color as SelectColor] ?? SELECT_COLOR_DOT_CLASSES.gray
    );
  };

  return (
    <div ref={triggerRef} className="relative h-full w-full">
      {/* Display */}
      <div
        className="flex h-full w-full cursor-pointer items-center gap-1.5 px-2.5 py-1.5 transition-colors hover:bg-accent/30"
        onClick={handleOpen}
      >
        {selectedChoice ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
              getColorClass(selectedChoice.color).bg,
              getColorClass(selectedChoice.color).text
            )}
          >
            <span className={cn("h-2 w-2 shrink-0 rounded-full", getDotColor())} />
            {selectedChoice.name}
          </span>
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
              placeholder={t("search")}
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
            <div className="max-h-56 overflow-y-auto">
              {statusCategories.map((cat) => {
                const catChoices = getChoicesByCategory(cat.id);
                if (catChoices.length === 0 && search.trim()) return null;
                return (
                  <div key={cat.id}>
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                      {cat.name}
                    </div>
                    {catChoices.map((c) => {
                      const isSelected = value === c.id;
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
                              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                              colors.bg,
                              colors.text
                            )}
                          >
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                SELECT_COLOR_DOT_CLASSES[c.color as SelectColor] ??
                                  SELECT_COLOR_DOT_CLASSES.gray
                              )}
                            />
                            {c.name}
                          </span>
                          {isSelected && <Check className="ml-auto h-3 w-3 text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                );
              })}

              {/* Uncategorized choices */}
              {getUncategorizedChoices().length > 0 && (
                <div>
                  {statusCategories.length > 0 && <div className="my-1 border-b border-border" />}
                  {getUncategorizedChoices().map((c) => {
                    const isSelected = value === c.id;
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
                            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
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
                </div>
              )}

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
