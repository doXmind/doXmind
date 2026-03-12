"use client";

import { useDroppable } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DatabaseRow, PropertyDef } from "@/extensions/database/database-types";
import { SELECT_COLOR_CLASSES, type SelectColor } from "@/extensions/database/database-types";
import { BoardCard } from "./board-card";

interface BoardColumnProps {
  columnId: string;
  title: string;
  color: string;
  rows: DatabaseRow[];
  properties: PropertyDef[];
  titlePropId: string | null;
  groupByPropId?: string;
  onAddRow: (columnId: string) => void;
  onOpenPage: (rowId: string) => void;
  onDuplicateRow?: (rowId: string) => void;
  onDeleteRow?: (rowId: string) => void;
}

export function BoardColumn({
  columnId,
  title,
  color,
  rows,
  properties,
  titlePropId,
  groupByPropId,
  onAddRow,
  onOpenPage,
  onDuplicateRow,
  onDeleteRow,
}: BoardColumnProps) {
  const t = useTranslations("database");
  const { setNodeRef, isOver } = useDroppable({ id: columnId });

  const colorClasses = SELECT_COLOR_CLASSES[color as SelectColor] ?? SELECT_COLOR_CLASSES.gray;

  return (
    <div className="flex w-72 shrink-0 flex-col">
      {/* Column header */}
      <div className="mb-2 flex items-center gap-2 px-1.5">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            colorClasses.bg,
            colorClasses.text
          )}
        >
          {title}
        </span>
        <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
          {rows.length}
        </span>
      </div>

      {/* Cards area */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-[80px] flex-1 flex-col gap-1.5 rounded-lg bg-muted/30 p-1.5 transition-colors",
          isOver && "bg-accent/50"
        )}
      >
        <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          {rows.map((row) => (
            <BoardCard
              key={row.id}
              row={row}
              properties={properties}
              titlePropId={titlePropId}
              groupByPropId={groupByPropId}
              onOpenPage={onOpenPage}
              onDuplicateRow={onDuplicateRow}
              onDeleteRow={onDeleteRow}
            />
          ))}
        </SortableContext>

        {/* Add card button */}
        <button
          className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border/60 px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:border-border hover:bg-accent/30"
          onClick={() => onAddRow(columnId)}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("new")}
        </button>
      </div>
    </div>
  );
}
