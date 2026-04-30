"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Filter, ArrowUpDown, SlidersHorizontal, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  DatabaseData,
  DatabaseView,
  FilterCondition,
  SortCondition,
} from "@/extensions/database/database-types";
import { FilterSortPanel } from "./filter-sort-panel";
import { PropertiesPanel } from "./properties-panel";
import { ViewSettingsPanel } from "./view-settings-panel";
import { useDatabaseStore } from "@/stores/database-store";

interface DatabaseToolbarProps {
  database: DatabaseData;
  view: DatabaseView;
  showFilterPanel?: boolean;
  onShowFilterPanel?: (show: boolean) => void;
}

export function DatabaseToolbar({
  database,
  view,
  showFilterPanel,
  onShowFilterPanel,
}: DatabaseToolbarProps) {
  const t = useTranslations("database");
  const { updateView } = useDatabaseStore();
  const [showFilterSort, setShowFilterSort] = useState(false);
  const [filterSortTab, setFilterSortTab] = useState<"filter" | "sort">("filter");
  const [showProperties, setShowProperties] = useState(false);
  const [showViewSettings, setShowViewSettings] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  const filters = (view.config.filters ?? []) as FilterCondition[];
  const sorts = (view.config.sorts ?? []) as SortCondition[];

  // Show settings button for board and gallery views
  const hasViewSettings = view.type === "board" || view.type === "gallery";

  // Sync with external showFilterPanel prop
  useEffect(() => {
    if (showFilterPanel) {
      setFilterSortTab("filter");
      setShowFilterSort(true);
      onShowFilterPanel?.(false);
    }
  }, [showFilterPanel, onShowFilterPanel]);

  const visiblePropertyIds = view.config.visibleProperties ?? null;
  const hiddenCount = visiblePropertyIds
    ? database.properties_schema.length - visiblePropertyIds.length
    : 0;

  const handleToggleVisibility = (propId: string, visible: boolean) => {
    const currentVisible =
      visiblePropertyIds && visiblePropertyIds.length > 0
        ? [...visiblePropertyIds]
        : database.properties_schema.map((p) => p.id);

    const newVisible = visible
      ? [...currentVisible, propId]
      : currentVisible.filter((id) => id !== propId);

    updateView(database.id, view.id, {
      config: { visibleProperties: newVisible },
    });
  };

  const openFilterTab = () => {
    setFilterSortTab("filter");
    setShowFilterSort(!showFilterSort || filterSortTab !== "filter");
  };

  const openSortTab = () => {
    if (showFilterSort && filterSortTab === "sort") {
      setShowFilterSort(false);
    } else {
      setFilterSortTab("sort");
      setShowFilterSort(true);
    }
  };

  // Close popups on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilterSort(false);
      }
      if (propsRef.current && !propsRef.current.contains(e.target as Node)) {
        setShowProperties(false);
      }
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowViewSettings(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="flex items-center gap-1 px-4 py-1.5">
      {/* Filter button */}
      <div className="relative flex items-center" ref={filterRef}>
        <button
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors duration-150",
            filters.length > 0
              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200"
              : "text-muted-foreground hover:bg-accent"
          )}
          onClick={openFilterTab}
        >
          <Filter className="h-3 w-3" />
          {t("filter")}
          {filters.length > 0 && (
            <span className="text-ui-xs rounded-full bg-blue-600 px-1.5 font-medium text-white dark:bg-blue-400 dark:text-blue-950">
              {filters.length}
            </span>
          )}
        </button>

        {/* Sort button – always visible, acts as separate entry point */}
        <button
          className={cn(
            "ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors duration-150",
            sorts.length > 0
              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200"
              : "text-muted-foreground hover:bg-accent"
          )}
          onClick={openSortTab}
        >
          <ArrowUpDown className="h-3 w-3" />
          {t("sort")}
          {sorts.length > 0 && (
            <span className="text-ui-xs rounded-full bg-blue-600 px-1.5 font-medium text-white dark:bg-blue-400 dark:text-blue-950">
              {sorts.length}
            </span>
          )}
        </button>

        {showFilterSort && (
          <div className="absolute left-0 top-full z-50 mt-1">
            <FilterSortPanel
              properties={database.properties_schema}
              filters={filters}
              sorts={sorts}
              initialTab={filterSortTab}
              onFiltersChange={(f) => updateView(database.id, view.id, { config: { filters: f } })}
              onSortsChange={(s) => updateView(database.id, view.id, { config: { sorts: s } })}
              onClose={() => setShowFilterSort(false)}
            />
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* View settings button (board / gallery only) */}
      {hasViewSettings && (
        <div className="relative" ref={settingsRef}>
          <button
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors duration-150",
              "text-muted-foreground hover:bg-accent"
            )}
            onClick={() => setShowViewSettings(!showViewSettings)}
            title={t("viewSettings")}
          >
            <Settings2 className="h-3 w-3" />
          </button>
          {showViewSettings && (
            <div className="absolute right-0 top-full z-50 mt-1">
              <ViewSettingsPanel
                database={database}
                view={view}
                onClose={() => setShowViewSettings(false)}
              />
            </div>
          )}
        </div>
      )}

      {/* Properties button */}
      <div className="relative" ref={propsRef}>
        <button
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors duration-150",
            hiddenCount > 0
              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200"
              : "text-muted-foreground hover:bg-accent"
          )}
          onClick={() => setShowProperties(!showProperties)}
        >
          <SlidersHorizontal className="h-3 w-3" />
          {t("properties")}
          {hiddenCount > 0 && (
            <span className="text-ui-xs rounded-full bg-blue-600 px-1.5 font-medium text-white dark:bg-blue-400 dark:text-blue-950">
              {hiddenCount}
            </span>
          )}
        </button>
        {showProperties && (
          <div className="absolute right-0 top-full z-50 mt-1">
            <PropertiesPanel
              properties={database.properties_schema}
              visiblePropertyIds={visiblePropertyIds}
              onToggleVisibility={handleToggleVisibility}
              onClose={() => setShowProperties(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
