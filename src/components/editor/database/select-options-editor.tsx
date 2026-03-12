"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SelectChoice, SelectColor } from "@/extensions/database/database-types";
import { SELECT_COLOR_CLASSES, SELECT_COLORS } from "@/extensions/database/database-types";

interface SelectOptionsEditorProps {
  choices: SelectChoice[];
  onChange: (choices: SelectChoice[]) => void;
}

export function SelectOptionsEditor({ choices, onChange }: SelectOptionsEditorProps) {
  const t = useTranslations("database.propertyEditor");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [colorPickerId, setColorPickerId] = useState<string | null>(null);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) editRef.current?.focus();
  }, [editingId]);

  const handleAdd = () => {
    const newChoice: SelectChoice = {
      id: crypto.randomUUID(),
      name: `${t("options")} ${choices.length + 1}`,
      color: SELECT_COLORS[choices.length % SELECT_COLORS.length],
    };
    onChange([...choices, newChoice]);
    setEditingId(newChoice.id);
    setEditDraft(newChoice.name);
  };

  const handleRename = (choiceId: string) => {
    if (!editDraft.trim()) {
      setEditingId(null);
      return;
    }
    onChange(choices.map((c) => (c.id === choiceId ? { ...c, name: editDraft.trim() } : c)));
    setEditingId(null);
  };

  const handleDelete = (choiceId: string) => {
    onChange(choices.filter((c) => c.id !== choiceId));
  };

  const handleColorChange = (choiceId: string, color: string) => {
    onChange(choices.map((c) => (c.id === choiceId ? { ...c, color } : c)));
    setColorPickerId(null);
  };

  return (
    <div className="space-y-1">
      <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
        {t("options")}
      </div>
      <div className="space-y-0.5">
        {choices.map((choice) => {
          const colors =
            SELECT_COLOR_CLASSES[choice.color as SelectColor] ?? SELECT_COLOR_CLASSES.gray;
          return (
            <div key={choice.id} className="group flex items-center gap-1.5 rounded-md px-1 py-0.5">
              {/* Color dot */}
              <div className="relative">
                <button
                  className={cn(
                    "h-3.5 w-3.5 rounded-full border border-border/50 transition-transform hover:scale-110",
                    colors.bg
                  )}
                  onClick={() => setColorPickerId(colorPickerId === choice.id ? null : choice.id)}
                />
                {colorPickerId === choice.id && (
                  <div className="absolute left-0 top-full z-50 mt-1 grid grid-cols-5 gap-1 rounded-lg border border-border bg-popover p-2 shadow-lg">
                    {SELECT_COLORS.map((c) => {
                      const cc = SELECT_COLOR_CLASSES[c] ?? SELECT_COLOR_CLASSES.gray;
                      return (
                        <button
                          key={c}
                          className={cn(
                            "h-5 w-5 rounded-full border border-border/30 transition-transform hover:scale-110",
                            cc.bg,
                            choice.color === c && "ring-2 ring-primary ring-offset-1"
                          )}
                          onClick={() => handleColorChange(choice.id, c)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Name */}
              {editingId === choice.id ? (
                <input
                  ref={editRef}
                  className="flex-1 rounded border-none bg-transparent px-1 py-0.5 text-xs outline-none focus:ring-1 focus:ring-primary"
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onBlur={() => handleRename(choice.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename(choice.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <span
                  className="flex-1 cursor-text truncate text-xs"
                  onClick={() => {
                    setEditingId(choice.id);
                    setEditDraft(choice.name);
                  }}
                >
                  {choice.name}
                </span>
              )}

              {/* Delete */}
              <button
                className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                onClick={() => handleDelete(choice.id)}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
      <button
        className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
        onClick={handleAdd}
      >
        <Plus className="h-3 w-3" />
        {t("addOption")}
      </button>
    </div>
  );
}
