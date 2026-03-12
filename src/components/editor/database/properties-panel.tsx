"use client";

import { useTranslations } from "next-intl";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PropertyDef } from "@/extensions/database/database-types";
import { PROPERTY_ICONS } from "./table/table-header";

interface PropertiesPanelProps {
  properties: PropertyDef[];
  visiblePropertyIds: string[] | null;
  onToggleVisibility: (propId: string, visible: boolean) => void;
  onClose: () => void;
}

export function PropertiesPanel({
  properties,
  visiblePropertyIds,
  onToggleVisibility,
  onClose: _onClose,
}: PropertiesPanelProps) {
  const t = useTranslations("database");
  const isVisible = (propId: string) => {
    if (!visiblePropertyIds || visiblePropertyIds.length === 0) return true;
    return visiblePropertyIds.includes(propId);
  };

  const hiddenCount = visiblePropertyIds ? properties.length - visiblePropertyIds.length : 0;

  return (
    <div className="animate-in fade-in-0 zoom-in-95 w-56 rounded-lg border border-border bg-popover p-2 shadow-lg duration-150">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-xs font-medium text-muted-foreground">{t("properties")}</span>
        {hiddenCount > 0 && (
          <span className="text-[10px] text-muted-foreground/60">
            {t("hiddenCount", { count: hiddenCount })}
          </span>
        )}
      </div>

      <div className="space-y-0.5">
        {properties.map((prop) => {
          const visible = isVisible(prop.id);
          return (
            <div
              key={prop.id}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50"
            >
              <span className="shrink-0 text-muted-foreground/60">{PROPERTY_ICONS[prop.type]}</span>
              <span className="flex-1 truncate text-xs">{prop.name}</span>
              <button
                className={cn(
                  "shrink-0 transition-colors",
                  visible
                    ? "text-primary hover:text-primary/70"
                    : "text-muted-foreground/40 hover:text-muted-foreground"
                )}
                onClick={() => onToggleVisibility(prop.id, !visible)}
              >
                {visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
