"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { DatabaseData, DatabaseView } from "@/extensions/database/database-types";
import { BoardColumn } from "../board/board-column";
import { useDatabaseStore } from "@/stores/database-store";

interface BoardViewProps {
  database: DatabaseData;
  view: DatabaseView;
  onOpenRowPage: (rowId: string) => void;
}

export function BoardView({ database, view, onOpenRowPage }: BoardViewProps) {
  const t = useTranslations("database");
  const { updateRow, addRow, duplicateRow, deleteRow } = useDatabaseStore();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const groupByPropId = view.config.groupByPropertyId;
  const groupByProp = database.properties_schema.find(
    (p) => p.id === groupByPropId && (p.type === "select" || p.type === "multi_select")
  );

  // Find the first text property for card titles
  const titlePropId = useMemo(() => {
    const textProp = database.properties_schema.find((p) => p.type === "text");
    return textProp?.id ?? null;
  }, [database.properties_schema]);

  // Build columns from the select choices
  const columns = useMemo(() => {
    if (!groupByProp) return [];
    const choices = groupByProp.options?.choices ?? [];
    type RowType = typeof database.rows;
    return [
      { id: "__no_status__", name: t("noStatus"), color: "gray", rows: [] as RowType },
      ...choices.map((c) => ({ ...c, rows: [] as RowType })),
    ];
  }, [groupByProp, database, t]);

  // Group rows into columns
  const groupedColumns = useMemo(() => {
    if (!groupByPropId) return columns;
    type RowType = typeof database.rows;
    const colMap = new Map(columns.map((c) => [c.id, { ...c, rows: [] as RowType }]));

    for (const row of database.rows) {
      const val = row.properties[groupByPropId] as string | null;
      const col = val ? colMap.get(val) : colMap.get("__no_status__");
      if (col) {
        col.rows.push(row);
      } else {
        colMap.get("__no_status__")?.rows.push(row);
      }
    }
    return Array.from(colMap.values());
  }, [database, groupByPropId, columns]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || !groupByPropId) return;

      const rowId = active.id as string;
      const targetColumnId = over.id as string;

      // Determine the target column
      // over.id could be either a column droppable or another card's sortable
      const targetCol = groupedColumns.find(
        (c) => c.id === targetColumnId || c.rows.some((r) => r.id === targetColumnId)
      );
      if (!targetCol) return;

      const newStatus = targetCol.id === "__no_status__" ? null : targetCol.id;
      const currentRow = database.rows.find((r) => r.id === rowId);
      if (!currentRow) return;

      const currentStatus = currentRow.properties[groupByPropId] as string | null;
      if (currentStatus === newStatus) return;

      updateRow(database.id, rowId, { [groupByPropId]: newStatus });
    },
    [database, groupByPropId, groupedColumns, updateRow]
  );

  const handleAddRow = useCallback(
    (columnId: string) => {
      const props: Record<string, string | null> = {};
      if (groupByPropId && columnId !== "__no_status__") {
        props[groupByPropId] = columnId;
      }
      addRow(database.id, { properties: props });
    },
    [database.id, groupByPropId, addRow]
  );

  const handleDuplicateRow = useCallback(
    (rowId: string) => {
      duplicateRow(database.id, rowId);
    },
    [database.id, duplicateRow]
  );

  const handleDeleteRow = useCallback(
    (rowId: string) => {
      deleteRow(database.id, rowId);
    },
    [database.id, deleteRow]
  );

  if (!groupByProp) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        {t("boardRequiresSelect")}
        <br />
        {t("addSelectFirst")}
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto p-2">
        {groupedColumns.map((col) => (
          <BoardColumn
            key={col.id}
            columnId={col.id}
            title={col.name}
            color={col.color}
            rows={col.rows}
            properties={database.properties_schema}
            titlePropId={titlePropId}
            groupByPropId={groupByPropId}
            onAddRow={handleAddRow}
            onOpenPage={onOpenRowPage}
            onDuplicateRow={handleDuplicateRow}
            onDeleteRow={handleDeleteRow}
          />
        ))}
      </div>
    </DndContext>
  );
}
