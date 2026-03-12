"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { DatabaseData, DatabaseView, SelectColor } from "@/extensions/database/database-types";
import { SELECT_COLOR_CLASSES } from "@/extensions/database/database-types";
import { useDatabaseStore } from "@/stores/database-store";

interface ViewSettingsPanelProps {
  database: DatabaseData;
  view: DatabaseView;
  onClose: () => void;
}

export function ViewSettingsPanel({ database, view, onClose: _onClose }: ViewSettingsPanelProps) {
  const t = useTranslations("database");
  const { updateView } = useDatabaseStore();

  const selectProps = database.properties_schema.filter(
    (p) => p.type === "select" || p.type === "status" || p.type === "multi_select"
  );
  const urlProps = database.properties_schema.filter((p) => p.type === "url");

  return (
    <div className="animate-in fade-in-0 zoom-in-95 w-64 rounded-lg border border-border bg-popover p-3 shadow-lg duration-150">
      {/* Board view: Group by */}
      {view.type === "board" && (
        <div className="space-y-2">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("groupBy")}
          </label>
          <div className="space-y-0.5">
            {selectProps.map((prop) => {
              const isActive = view.config.groupByPropertyId === prop.id;
              const firstChoice = prop.options?.choices?.[0];
              const color = firstChoice
                ? (SELECT_COLOR_CLASSES[firstChoice.color as SelectColor] ??
                  SELECT_COLOR_CLASSES.gray)
                : SELECT_COLOR_CLASSES.gray;

              return (
                <button
                  key={prop.id}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                    isActive
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                  onClick={() =>
                    updateView(database.id, view.id, {
                      config: { groupByPropertyId: prop.id },
                    })
                  }
                >
                  <span className={cn("h-2 w-2 rounded-full", color.bg)} />
                  {prop.name}
                </button>
              );
            })}
            {selectProps.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground/60">{t("addSelectFirst")}</p>
            )}
          </div>
        </div>
      )}

      {/* Gallery view: Card size + Cover property */}
      {view.type === "gallery" && (
        <div className="space-y-4">
          {/* Card size */}
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("cardSize")}
            </label>
            <div className="flex gap-1">
              {(["small", "medium", "large"] as const).map((size) => (
                <button
                  key={size}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1.5 text-xs transition-colors",
                    (view.config.cardSize ?? "medium") === size
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent/50"
                  )}
                  onClick={() =>
                    updateView(database.id, view.id, {
                      config: { cardSize: size },
                    })
                  }
                >
                  {
                    {
                      small: t("cardSizeSmall"),
                      medium: t("cardSizeMedium"),
                      large: t("cardSizeLarge"),
                    }[size]
                  }
                </button>
              ))}
            </div>
          </div>

          {/* Cover property */}
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("coverProperty")}
            </label>
            <div className="space-y-0.5">
              <button
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                  !view.config.coverPropertyId
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent/50"
                )}
                onClick={() =>
                  updateView(database.id, view.id, {
                    config: { coverPropertyId: undefined },
                  })
                }
              >
                {t("noCover")}
              </button>
              {urlProps.map((prop) => (
                <button
                  key={prop.id}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                    view.config.coverPropertyId === prop.id
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent/50"
                  )}
                  onClick={() =>
                    updateView(database.id, view.id, {
                      config: { coverPropertyId: prop.id },
                    })
                  }
                >
                  {prop.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
