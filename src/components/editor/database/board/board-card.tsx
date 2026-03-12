"use client";

import { useState, useRef, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslations } from "next-intl";
import { MoreHorizontal, Expand, Copy, Trash2 } from "lucide-react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import type {
  DatabaseRow,
  PropertyDef,
  SelectColor,
  CellValue,
} from "@/extensions/database/database-types";
import { SELECT_COLOR_CLASSES } from "@/extensions/database/database-types";

interface BoardCardProps {
  row: DatabaseRow;
  properties: PropertyDef[];
  titlePropId: string | null;
  groupByPropId?: string;
  onOpenPage: (rowId: string) => void;
  onDuplicateRow?: (rowId: string) => void;
  onDeleteRow?: (rowId: string) => void;
}

function renderCardValue(value: CellValue, prop: PropertyDef): React.ReactNode {
  if (value == null || value === "") return null;

  // Select / Status → colored pill
  if (
    (prop.type === "select" || prop.type === "status") &&
    typeof value === "string" &&
    prop.options?.choices
  ) {
    const choice = prop.options.choices.find((c) => c.id === value);
    if (!choice) return null;
    const colors = SELECT_COLOR_CLASSES[choice.color as SelectColor] ?? SELECT_COLOR_CLASSES.gray;
    return (
      <span
        className={cn(
          "inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium",
          colors.bg,
          colors.text
        )}
      >
        {choice.name}
      </span>
    );
  }

  // Multi-select → pills
  if (prop.type === "multi_select" && Array.isArray(value) && prop.options?.choices) {
    return (
      <div className="flex flex-wrap gap-0.5">
        {(value as string[]).slice(0, 2).map((id) => {
          const choice = prop.options!.choices!.find((c) => c.id === id);
          if (!choice) return null;
          const colors =
            SELECT_COLOR_CLASSES[choice.color as SelectColor] ?? SELECT_COLOR_CLASSES.gray;
          return (
            <span
              key={id}
              className={cn(
                "inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                colors.bg,
                colors.text
              )}
            >
              {choice.name}
            </span>
          );
        })}
      </div>
    );
  }

  // Checkbox
  if (prop.type === "checkbox") {
    return <span className="text-xs text-muted-foreground">{value ? "✓" : ""}</span>;
  }

  // Date
  if (prop.type === "date" && typeof value === "string") {
    return (
      <span className="text-xs text-muted-foreground">
        {new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </span>
    );
  }

  // Default: plain text
  return <span className="truncate text-xs text-muted-foreground">{String(value)}</span>;
}

export function BoardCard({
  row,
  properties,
  titlePropId,
  groupByPropId,
  onOpenPage,
  onDuplicateRow,
  onDeleteRow,
}: BoardCardProps) {
  const t = useTranslations("database");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
  });
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  useEffect(() => {
    if (!menuPos) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuPos(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuPos]);

  const title = titlePropId ? (row.properties[titlePropId] as string) : "";

  // Show up to 3 visible properties (excluding title and groupBy property)
  const visibleProps = properties
    .filter((p) => p.id !== titlePropId && p.id !== groupByPropId)
    .slice(0, 3);

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className={cn(
          "group cursor-grab rounded-lg border border-border/80 bg-background p-3 shadow-sm transition-all duration-150 hover:border-border hover:shadow-md",
          isDragging && "z-50 rotate-[1deg] scale-[1.02] opacity-90 shadow-xl"
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-medium leading-tight">
            {title || <span className="text-muted-foreground">{t("untitledRow")}</span>}
          </span>
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              className="rounded p-0.5 hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation();
                onOpenPage(row.id);
              }}
            >
              <Expand className="h-3 w-3 text-muted-foreground" />
            </button>
            <button
              className="rounded p-0.5 hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setMenuPos({ x: rect.left, y: rect.bottom + 4 });
              }}
            >
              <MoreHorizontal className="h-3 w-3 text-muted-foreground" />
            </button>
          </div>
        </div>

        {visibleProps.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {visibleProps.map((prop) => {
              const val = row.properties[prop.id];
              const rendered = renderCardValue(val, prop);
              if (!rendered) return null;
              return (
                <div key={prop.id} className="flex items-center gap-1">
                  {rendered}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Context menu */}
      {menuPos &&
        createPortal(
          <div
            ref={menuRef}
            className="animate-in fade-in-0 zoom-in-95 fixed z-[100] w-40 rounded-lg border border-border bg-popover p-1 shadow-lg duration-100"
            style={{
              top: Math.min(menuPos.y, window.innerHeight - 120),
              left: Math.min(menuPos.x, window.innerWidth - 170),
            }}
          >
            <button
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors hover:bg-accent"
              onClick={() => {
                setMenuPos(null);
                onOpenPage(row.id);
              }}
            >
              <Expand className="h-3.5 w-3.5 text-muted-foreground" />
              {t("openAsPage")}
            </button>
            {onDuplicateRow && (
              <button
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors hover:bg-accent"
                onClick={() => {
                  setMenuPos(null);
                  onDuplicateRow(row.id);
                }}
              >
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                {t("duplicateRow")}
              </button>
            )}
            {onDeleteRow && (
              <>
                <div className="my-1 border-b border-border" />
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                  onClick={() => {
                    setMenuPos(null);
                    onDeleteRow(row.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("deleteRow")}
                </button>
              </>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
