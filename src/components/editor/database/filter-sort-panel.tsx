"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Plus, X, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  PropertyDef,
  FilterCondition,
  FilterOperator,
  SortCondition,
} from "@/extensions/database/database-types";
import {
  getOperatorsForType,
  getDefaultOperator,
  operatorNeedsValue,
} from "@/extensions/database/filter-utils";

interface FilterSortPanelProps {
  properties: PropertyDef[];
  filters: FilterCondition[];
  sorts: SortCondition[];
  onFiltersChange: (filters: FilterCondition[]) => void;
  onSortsChange: (sorts: SortCondition[]) => void;
  onClose: () => void;
  initialTab?: "filter" | "sort";
}

export function FilterSortPanel({
  properties,
  filters,
  sorts,
  onFiltersChange,
  onSortsChange,
  onClose: _onClose,
  initialTab = "filter",
}: FilterSortPanelProps) {
  const t = useTranslations("database");
  const [tab, setTab] = useState<"filter" | "sort">(initialTab);

  const propsById = useMemo(() => new Map(properties.map((p) => [p.id, p])), [properties]);

  const addFilter = () => {
    if (properties.length === 0) return;
    const prop = properties[0];
    onFiltersChange([
      ...filters,
      {
        propertyId: prop.id,
        operator: getDefaultOperator(prop.type),
        value: "",
      },
    ]);
  };

  const updateFilter = (index: number, updates: Partial<FilterCondition>) => {
    const current = filters[index];
    const merged = { ...current, ...updates };

    // When property changes, reset operator + value to match new type
    if (updates.propertyId && updates.propertyId !== current.propertyId) {
      const newProp = propsById.get(updates.propertyId);
      if (newProp) {
        const validOps = getOperatorsForType(newProp.type);
        if (!validOps.includes(merged.operator)) {
          merged.operator = getDefaultOperator(newProp.type);
        }
        merged.value = "";
      }
    }

    // When operator changes to one that doesn't need a value, clear it
    if (updates.operator && !operatorNeedsValue(updates.operator)) {
      merged.value = null;
    }

    const next = filters.map((f, i) => (i === index ? merged : f));
    onFiltersChange(next);
  };

  const removeFilter = (index: number) => {
    onFiltersChange(filters.filter((_, i) => i !== index));
  };

  const addSort = () => {
    if (properties.length === 0) return;
    onSortsChange([...sorts, { propertyId: properties[0].id, direction: "asc" }]);
  };

  const updateSort = (index: number, updates: Partial<SortCondition>) => {
    const next = sorts.map((s, i) => (i === index ? { ...s, ...updates } : s));
    onSortsChange(next);
  };

  const removeSort = (index: number) => {
    onSortsChange(sorts.filter((_, i) => i !== index));
  };

  /** Render a type-appropriate value input for the given filter. */
  const renderValueInput = (filter: FilterCondition, index: number) => {
    if (!operatorNeedsValue(filter.operator)) return null;

    const prop = propsById.get(filter.propertyId);
    if (!prop) return null;

    const inputCls =
      "w-24 rounded-md border border-border bg-transparent px-1.5 py-1 text-xs outline-none focus:ring-1 focus:ring-primary/50";

    // Checkbox → dropdown true/false
    if (prop.type === "checkbox") {
      return (
        <select
          className={inputCls}
          value={String(filter.value ?? "true")}
          onChange={(e) =>
            updateFilter(index, { value: e.target.value === "true" ? "true" : "false" })
          }
        >
          <option value="true">{t("checked")}</option>
          <option value="false">{t("unchecked")}</option>
        </select>
      );
    }

    // Select / Status / Multi-select → dropdown of choices
    if (
      (prop.type === "select" || prop.type === "status" || prop.type === "multi_select") &&
      prop.options?.choices
    ) {
      return (
        <select
          className={inputCls}
          value={String(filter.value ?? "")}
          onChange={(e) => updateFilter(index, { value: e.target.value })}
        >
          <option value="">—</option>
          {prop.options.choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      );
    }

    // Date → native date input
    if (prop.type === "date" || prop.type === "created_time" || prop.type === "updated_time") {
      return (
        <input
          type="date"
          className={cn(inputCls, "w-28")}
          value={String(filter.value ?? "")}
          onChange={(e) => updateFilter(index, { value: e.target.value })}
        />
      );
    }

    // Number → number input
    if (prop.type === "number") {
      return (
        <input
          type="number"
          className={inputCls}
          value={filter.value != null ? String(filter.value) : ""}
          onChange={(e) => {
            const v = e.target.value;
            updateFilter(index, { value: v === "" ? null : Number(v) });
          }}
        />
      );
    }

    // Default: text input (text, url, email, phone)
    return (
      <input
        className={inputCls}
        value={String(filter.value ?? "")}
        onChange={(e) => updateFilter(index, { value: e.target.value })}
        placeholder="..."
      />
    );
  };

  return (
    <div className="animate-in fade-in-0 zoom-in-95 w-80 rounded-lg border border-border bg-popover p-3 shadow-lg duration-150">
      {/* Tabs */}
      <div className="mb-3 flex gap-4 border-b border-border pb-2">
        <button
          className={cn(
            "pb-1 text-xs font-medium transition-colors",
            tab === "filter"
              ? "border-b-2 border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setTab("filter")}
        >
          {t("filter")} {filters.length > 0 && `(${filters.length})`}
        </button>
        <button
          className={cn(
            "pb-1 text-xs font-medium transition-colors",
            tab === "sort"
              ? "border-b-2 border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setTab("sort")}
        >
          {t("sort")} {sorts.length > 0 && `(${sorts.length})`}
        </button>
      </div>

      {tab === "filter" && (
        <div className="space-y-3">
          {filters.map((f, i) => {
            const prop = propsById.get(f.propertyId);
            const operators = prop ? getOperatorsForType(prop.type) : getOperatorsForType("text");

            return (
              <div key={i} className="flex items-center gap-1.5">
                <select
                  className="w-24 rounded-md border border-border bg-transparent px-1.5 py-1 text-xs outline-none focus:ring-1 focus:ring-primary/50"
                  value={f.propertyId}
                  onChange={(e) => updateFilter(i, { propertyId: e.target.value })}
                >
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <select
                  className="w-24 rounded-md border border-border bg-transparent px-1.5 py-1 text-xs outline-none focus:ring-1 focus:ring-primary/50"
                  value={f.operator}
                  onChange={(e) => updateFilter(i, { operator: e.target.value as FilterOperator })}
                >
                  {operators.map((op) => (
                    <option key={op} value={op}>
                      {t(`operators.${op}`)}
                    </option>
                  ))}
                </select>
                {renderValueInput(f, i)}
                <button
                  className="rounded-md p-1 transition-colors hover:bg-red-100 hover:text-red-500 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                  onClick={() => removeFilter(i)}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          <button
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={addFilter}
          >
            <Plus className="h-3 w-3" />
            {t("addFilter")}
          </button>
        </div>
      )}

      {tab === "sort" && (
        <div className="space-y-3">
          {sorts.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <select
                className="w-32 rounded-md border border-border bg-transparent px-1.5 py-1 text-xs outline-none focus:ring-1 focus:ring-primary/50"
                value={s.propertyId}
                onChange={(e) => updateSort(i, { propertyId: e.target.value })}
              >
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-accent"
                onClick={() =>
                  updateSort(i, {
                    direction: s.direction === "asc" ? "desc" : "asc",
                  })
                }
              >
                {s.direction === "asc" ? (
                  <>
                    <ArrowUp className="h-3 w-3" /> {t("asc")}
                  </>
                ) : (
                  <>
                    <ArrowDown className="h-3 w-3" /> {t("desc")}
                  </>
                )}
              </button>
              <button
                className="rounded-md p-1 transition-colors hover:bg-red-100 hover:text-red-500 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                onClick={() => removeSort(i)}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <button
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={addSort}
          >
            <Plus className="h-3 w-3" />
            {t("addSort")}
          </button>
        </div>
      )}
    </div>
  );
}
