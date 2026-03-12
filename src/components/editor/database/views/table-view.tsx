"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Plus } from "lucide-react";
import type {
  DatabaseData,
  DatabaseView,
  CellValue,
  SelectChoice,
  SortCondition,
  FilterCondition,
} from "@/extensions/database/database-types";
import { applyFilters, applySorts } from "@/extensions/database/filter-utils";
import { TableHeader } from "../table/table-header";
import { TableRowComponent } from "../table/table-row";
import { TableCalculations, type CalcType } from "../table/table-calculations";
import { useDatabaseStore } from "@/stores/database-store";

const ROW_HEIGHT = 33;

interface TableViewProps {
  database: DatabaseData;
  view: DatabaseView;
  onOpenRowPage: (rowId: string) => void;
  onEditProperty?: (propId: string, position?: { top: number; left: number }) => void;
  onAddProperty?: (position?: { top: number; left: number }) => void;
  onOpenFilterPanel?: (propId?: string) => void;
}

export function TableView({
  database,
  view,
  onOpenRowPage,
  onEditProperty,
  onAddProperty,
  onOpenFilterPanel,
}: TableViewProps) {
  const t = useTranslations("database");
  const {
    updateRow,
    deleteRow,
    duplicateRow,
    addRow,
    updateProperty,
    updateView,
    deleteProperty,
    addProperty,
    reorderProperties,
    loadMoreRows,
  } = useDatabaseStore();
  const [focusRowId, setFocusRowId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Clear focusRowId after one render so autoFocus is one-shot
  useEffect(() => {
    if (focusRowId) setFocusRowId(null);
  }, [focusRowId]);

  const config = view.config;
  const widths = useMemo(() => config.propertyWidths ?? {}, [config.propertyWidths]);
  const calculations = useMemo(
    () => (config.calculations ?? {}) as Record<string, CalcType>,
    [config.calculations]
  );
  const sorts = useMemo(() => (config.sorts ?? []) as SortCondition[], [config.sorts]);
  const filters = useMemo(() => (config.filters ?? []) as FilterCondition[], [config.filters]);

  // Filter properties by visibility
  const visibleProperties = useMemo(() => {
    const vp = config.visibleProperties;
    if (!vp || vp.length === 0) return database.properties_schema;
    return vp
      .map((id) => database.properties_schema.find((p) => p.id === id))
      .filter(Boolean) as typeof database.properties_schema;
  }, [config.visibleProperties, database]);

  const processedRows = useMemo(() => {
    const filtered = applyFilters(database.rows, filters, database.properties_schema);
    return applySorts(filtered, sorts);
  }, [database.rows, filters, sorts, database.properties_schema]);

  const handleCellChange = useCallback(
    (rowId: string, propId: string, value: CellValue) => {
      updateRow(database.id, rowId, { [propId]: value });
    },
    [database.id, updateRow]
  );

  const handleChoicesChange = useCallback(
    (propId: string, choices: SelectChoice[]) => {
      updateProperty(database.id, propId, { options: { choices } });
    },
    [database.id, updateProperty]
  );

  const handleWidthChange = useCallback(
    (propId: string, width: number) => {
      updateView(database.id, view.id, {
        config: { propertyWidths: { ...widths, [propId]: width } },
      });
    },
    [database.id, view.id, widths, updateView]
  );

  const handleCalculationsChange = useCallback(
    (calcs: Record<string, string>) => {
      updateView(database.id, view.id, { config: { calculations: calcs } });
    },
    [database.id, view.id, updateView]
  );

  const handleSort = useCallback(
    (propId: string, direction: "asc" | "desc") => {
      const existing = sorts.find((s) => s.propertyId === propId);
      let newSorts: SortCondition[];
      if (existing?.direction === direction) {
        // Toggle off if same direction
        newSorts = [];
      } else {
        newSorts = [{ propertyId: propId, direction }];
      }
      updateView(database.id, view.id, { config: { sorts: newSorts } });
    },
    [database.id, view.id, sorts, updateView]
  );

  const handleAddRow = useCallback(async () => {
    await addRow(database.id);
    const updated = useDatabaseStore.getState().databases[database.id];
    if (updated && updated.rows.length > 0) {
      const newestRow = updated.rows[updated.rows.length - 1];
      setFocusRowId(newestRow.id);
    }
  }, [database.id, addRow]);

  const handleDeleteRow = useCallback(
    (rowId: string) => {
      deleteRow(database.id, rowId);
    },
    [database.id, deleteRow]
  );

  const handleDuplicateRow = useCallback(
    (rowId: string) => {
      duplicateRow(database.id, rowId);
    },
    [database.id, duplicateRow]
  );

  const handleEditProperty = useCallback(
    (propId: string, position?: { top: number; left: number }) => {
      onEditProperty?.(propId, position);
    },
    [onEditProperty]
  );

  const handleAddFilter = useCallback(
    (propId: string) => {
      // Add a filter for this property and open filter panel
      const newFilter: FilterCondition = {
        propertyId: propId,
        operator: "is_not_empty",
        value: null,
      };
      const existingFilters = (config.filters ?? []) as FilterCondition[];
      updateView(database.id, view.id, {
        config: { filters: [...existingFilters, newFilter] },
      });
      onOpenFilterPanel?.(propId);
    },
    [database.id, view.id, config.filters, updateView, onOpenFilterPanel]
  );

  const handleInsertProperty = useCallback(
    async (position: "left" | "right", refPropId: string) => {
      const refIndex = database.properties_schema.findIndex((p) => p.id === refPropId);
      if (refIndex === -1) return;
      const insertIdx = position === "left" ? refIndex : refIndex + 1;

      // Add a new text property
      await addProperty(database.id, {
        name: "New Property",
        type: "text",
      });

      // Get the updated state and reorder
      const updated = useDatabaseStore.getState().databases[database.id];
      if (!updated) return;
      const newProp = updated.properties_schema[updated.properties_schema.length - 1];
      if (!newProp) return;

      // Build new order with the new property at the desired position
      const currentIds = updated.properties_schema
        .filter((p) => p.id !== newProp.id)
        .map((p) => p.id);
      currentIds.splice(insertIdx, 0, newProp.id);
      await reorderProperties(database.id, currentIds);
    },
    [database.id, database.properties_schema, addProperty, reorderProperties]
  );

  const handleHideProperty = useCallback(
    (propId: string) => {
      const currentVisible =
        config.visibleProperties && config.visibleProperties.length > 0
          ? [...config.visibleProperties]
          : database.properties_schema.map((p) => p.id);

      const newVisible = currentVisible.filter((id) => id !== propId);
      updateView(database.id, view.id, {
        config: { visibleProperties: newVisible },
      });
    },
    [database.id, view.id, config.visibleProperties, database.properties_schema, updateView]
  );

  const handleDeleteProperty = useCallback(
    (propId: string) => {
      deleteProperty(database.id, propId);
    },
    [database.id, deleteProperty]
  );

  const handleAddProperty = useCallback(
    (position?: { top: number; left: number }) => {
      onAddProperty?.(position);
    },
    [onAddProperty]
  );

  const handleReorderProperties = useCallback(
    (propertyIds: string[]) => {
      reorderProperties(database.id, propertyIds);
    },
    [database.id, reorderProperties]
  );

  const rowVirtualizer = useVirtualizer({
    count: processedRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  // Scroll to focused row (e.g. after adding a new row)
  useEffect(() => {
    if (focusRowId) {
      const index = processedRows.findIndex((r) => r.id === focusRowId);
      if (index >= 0) {
        rowVirtualizer.scrollToIndex(index, { align: "end" });
      }
    }
  }, [focusRowId, processedRows, rowVirtualizer]);

  // Lazy-load more rows when the user scrolls near the bottom
  const handleScroll = useCallback(() => {
    if (!database.hasMoreRows) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const threshold = ROW_HEIGHT * 5;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
      loadMoreRows(database.id);
    }
  }, [database.id, database.hasMoreRows, loadMoreRows]);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-max">
        <TableHeader
          properties={visibleProperties}
          widths={widths}
          sorts={sorts}
          onWidthChange={handleWidthChange}
          onSort={handleSort}
          onEditProperty={handleEditProperty}
          onAddFilter={handleAddFilter}
          onInsertProperty={handleInsertProperty}
          onHideProperty={handleHideProperty}
          onDeleteProperty={handleDeleteProperty}
          onAddProperty={handleAddProperty}
          onReorderProperties={handleReorderProperties}
        />

        {/* Virtualized row container */}
        <div
          ref={scrollContainerRef}
          className="max-h-[60vh] overflow-y-auto"
          onScroll={handleScroll}
        >
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = processedRows[virtualRow.index];
              return (
                <div
                  key={row.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <TableRowComponent
                    row={row}
                    properties={visibleProperties}
                    widths={widths}
                    rowIndex={virtualRow.index}
                    onCellChange={handleCellChange}
                    onChoicesChange={handleChoicesChange}
                    onOpenPage={onOpenRowPage}
                    onDeleteRow={handleDeleteRow}
                    onDuplicateRow={handleDuplicateRow}
                    autoFocusFirstCell={row.id === focusRowId}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Calculations row */}
        <div className="group/table">
          <TableCalculations
            properties={visibleProperties}
            rows={processedRows}
            widths={widths}
            calculations={calculations}
            onCalculationsChange={handleCalculationsChange}
          />
        </div>

        {/* Add row button */}
        <button
          className="flex w-full items-center gap-1.5 border-b border-border px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/30"
          onClick={handleAddRow}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("new")}
        </button>
      </div>
    </div>
  );
}
