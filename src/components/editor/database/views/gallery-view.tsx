"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { Plus, FileText } from "lucide-react";
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

interface GalleryViewProps {
  database: DatabaseData;
  view: DatabaseView;
  onOpenRowPage: (rowId: string) => void;
}

function isImageUrl(url: string): boolean {
  if (!url) return false;
  try {
    const lower = url.toLowerCase();
    return (
      lower.match(/\.(jpg|jpeg|png|gif|webp|svg|avif|bmp)(\?|$)/) !== null ||
      lower.includes("unsplash.com") ||
      lower.includes("images.")
    );
  } catch {
    return false;
  }
}

function renderCellPreview(
  value: CellValue,
  propType: string,
  choices?: SelectChoice[]
): React.ReactNode {
  if (value == null || value === "") return null;

  if (propType === "checkbox") {
    return <span className="text-xs text-muted-foreground">{value ? "✓" : "✗"}</span>;
  }

  if ((propType === "select" || propType === "status") && typeof value === "string" && choices) {
    const choice = choices.find((c) => c.id === value);
    if (!choice) return null;
    const colors = SELECT_COLOR_CLASSES[choice.color as SelectColor] ?? SELECT_COLOR_CLASSES.gray;
    return (
      <span
        className={cn(
          "text-ui-xs inline-flex rounded-full px-1.5 py-0.5 font-medium",
          colors.bg,
          colors.text
        )}
      >
        {choice.name}
      </span>
    );
  }

  if (propType === "multi_select" && Array.isArray(value) && choices) {
    return (
      <div className="flex flex-wrap gap-0.5">
        {(value as string[]).slice(0, 2).map((id) => {
          const choice = choices.find((c) => c.id === id);
          if (!choice) return null;
          const colors =
            SELECT_COLOR_CLASSES[choice.color as SelectColor] ?? SELECT_COLOR_CLASSES.gray;
          return (
            <span
              key={id}
              className={cn(
                "text-ui-xs inline-flex rounded-full px-1.5 py-0.5 font-medium",
                colors.bg,
                colors.text
              )}
            >
              {choice.name}
            </span>
          );
        })}
        {(value as string[]).length > 2 && (
          <span className="text-ui-xs text-muted-foreground">
            +{(value as string[]).length - 2}
          </span>
        )}
      </div>
    );
  }

  return <span className="truncate text-xs text-muted-foreground">{String(value)}</span>;
}

export function GalleryView({ database, view, onOpenRowPage }: GalleryViewProps) {
  const t = useTranslations("database");
  const { addRow } = useDatabaseStore();

  const config = view.config;
  const sorts = useMemo(() => (config.sorts ?? []) as SortCondition[], [config.sorts]);
  const filters = useMemo(() => (config.filters ?? []) as FilterCondition[], [config.filters]);

  const processedRows = useMemo(() => {
    const filtered = applyFilters(database.rows, filters);
    return applySorts(filtered, sorts);
  }, [database.rows, filters, sorts]);

  // Find the title property (first text property)
  const titleProp = database.properties_schema.find((p) => p.type === "text");

  // Find cover image property (first URL property with image content, or specified)
  const coverProp = config.coverPropertyId
    ? database.properties_schema.find((p) => p.id === config.coverPropertyId)
    : database.properties_schema.find((p) => p.type === "url");

  // Visible properties for card body (excluding title and cover)
  const cardProperties = useMemo(() => {
    const vp = config.visibleProperties;
    const schema =
      vp && vp.length > 0
        ? (vp
            .map((id) => database.properties_schema.find((p) => p.id === id))
            .filter(Boolean) as typeof database.properties_schema)
        : database.properties_schema;

    return schema
      .filter(
        (p) =>
          p.id !== titleProp?.id &&
          p.id !== coverProp?.id &&
          p.type !== "created_time" &&
          p.type !== "updated_time"
      )
      .slice(0, 3);
  }, [config.visibleProperties, database, titleProp, coverProp]);

  const cardSize = config.cardSize ?? "medium";
  const gridCols = {
    small: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4",
    medium: "grid-cols-1 sm:grid-cols-2 md:grid-cols-3",
    large: "grid-cols-1 sm:grid-cols-2",
  };

  const handleAddRow = useCallback(async () => {
    await addRow(database.id);
  }, [database.id, addRow]);

  return (
    <div className={cn("grid gap-3 p-4", gridCols[cardSize])}>
      {processedRows.map((row) => {
        const title = titleProp
          ? (row.properties[titleProp.id] as string) || t("untitledRow")
          : t("untitledRow");
        const coverUrl = coverProp ? (row.properties[coverProp.id] as string) : null;
        const hasCover = coverUrl && isImageUrl(coverUrl);

        return (
          <div
            key={row.id}
            className="group cursor-pointer overflow-hidden rounded-lg border border-border bg-card transition-all hover:border-border/80 hover:shadow-md"
            onClick={() => onOpenRowPage(row.id)}
          >
            {/* Cover image */}
            {hasCover ? (
              <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
                <Image
                  src={coverUrl}
                  alt=""
                  fill
                  className="object-cover transition-transform duration-200 group-hover:scale-105"
                  unoptimized
                />
              </div>
            ) : (
              <div className="flex aspect-[16/9] w-full items-center justify-center bg-gradient-to-br from-muted to-muted/50">
                <FileText className="h-8 w-8 text-muted-foreground/30" />
              </div>
            )}

            {/* Card body */}
            <div className="space-y-1.5 p-3">
              <h4 className="truncate text-sm font-medium">{title}</h4>
              {cardProperties.map((prop) => {
                const val = row.properties[prop.id];
                const preview = renderCellPreview(val, prop.type, prop.options?.choices);
                if (!preview) return null;
                return (
                  <div key={prop.id} className="flex items-center gap-1.5">
                    <span className="text-ui-xs shrink-0 text-muted-foreground/50">
                      {prop.name}
                    </span>
                    {preview}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Add new card */}
      <button
        className="flex min-h-[120px] cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-border/50 text-muted-foreground/40 transition-colors hover:border-border hover:text-muted-foreground"
        onClick={handleAddRow}
      >
        <Plus className="h-6 w-6" />
      </button>
    </div>
  );
}
