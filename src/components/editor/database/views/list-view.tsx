"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Plus, FileText, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  DatabaseData,
  DatabaseView,
  CellValue,
  SelectChoice,
  SortCondition,
  FilterCondition,
  SelectColor,
} from "@/extensions/database/database-types";
import { SELECT_COLOR_CLASSES } from "@/extensions/database/database-types";
import { applyFilters, applySorts } from "@/extensions/database/filter-utils";
import { useDatabaseStore } from "@/stores/database-store";

interface ListViewProps {
  database: DatabaseData;
  view: DatabaseView;
  onOpenRowPage: (rowId: string) => void;
}

function renderInlinePreview(
  value: CellValue,
  propType: string,
  choices?: SelectChoice[]
): React.ReactNode {
  if (value == null || value === "") return null;

  if ((propType === "select" || propType === "status") && typeof value === "string" && choices) {
    const choice = choices.find((c) => c.id === value);
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

  if (propType === "checkbox") {
    return <span className="text-xs text-muted-foreground">{value ? "✓" : ""}</span>;
  }

  if (propType === "date" && typeof value === "string") {
    return (
      <span className="text-xs text-muted-foreground">
        {new Date(value).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}
      </span>
    );
  }

  return null;
}

export function ListView({ database, view, onOpenRowPage }: ListViewProps) {
  const t = useTranslations("database");
  const { addRow } = useDatabaseStore();

  const config = view.config;
  const sorts = useMemo(() => (config.sorts ?? []) as SortCondition[], [config.sorts]);
  const filters = useMemo(() => (config.filters ?? []) as FilterCondition[], [config.filters]);

  const processedRows = useMemo(() => {
    const filtered = applyFilters(database.rows, filters);
    return applySorts(filtered, sorts);
  }, [database.rows, filters, sorts]);

  const titleProp = database.properties_schema.find((p) => p.type === "text");

  // Show up to 2 inline property previews
  const previewProps = useMemo(() => {
    return database.properties_schema
      .filter(
        (p) =>
          p.id !== titleProp?.id &&
          (p.type === "select" || p.type === "status" || p.type === "date" || p.type === "checkbox")
      )
      .slice(0, 2);
  }, [database.properties_schema, titleProp]);

  const handleAddRow = useCallback(async () => {
    await addRow(database.id);
  }, [database.id, addRow]);

  return (
    <div className="px-4 py-2">
      {processedRows.map((row) => {
        const title = titleProp
          ? (row.properties[titleProp.id] as string) || t("untitledRow")
          : t("untitledRow");

        return (
          <div
            key={row.id}
            className="group flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 transition-colors hover:bg-accent/50"
            onClick={() => onOpenRowPage(row.id)}
          >
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground/40" />
            <span className="flex-1 truncate text-sm">{title}</span>

            {/* Inline property previews */}
            <div className="flex items-center gap-2">
              {previewProps.map((prop) => {
                const preview = renderInlinePreview(
                  row.properties[prop.id],
                  prop.type,
                  prop.options?.choices
                );
                if (!preview) return null;
                return <span key={prop.id}>{preview}</span>;
              })}
            </div>

            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        );
      })}

      {/* Add row */}
      <button
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground/50 transition-colors hover:bg-accent/30 hover:text-muted-foreground"
        onClick={handleAddRow}
      >
        <Plus className="h-3.5 w-3.5" />
        {t("newPage")}
      </button>
    </div>
  );
}
