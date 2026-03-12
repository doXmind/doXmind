"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { PropertyDef, DatabaseRow } from "@/extensions/database/database-types";
import { DEFAULT_COLUMN_WIDTH } from "@/extensions/database/database-types";

export type CalcType =
  | "none"
  | "count"
  | "count_values"
  | "count_empty"
  | "sum"
  | "average"
  | "min"
  | "max";

const NUMBER_CALCS: CalcType[] = [
  "none",
  "count",
  "count_values",
  "count_empty",
  "sum",
  "average",
  "min",
  "max",
];

const DEFAULT_CALCS: CalcType[] = ["none", "count", "count_values", "count_empty"];

interface TableCalculationsProps {
  properties: PropertyDef[];
  rows: DatabaseRow[];
  widths: Record<string, number>;
  calculations: Record<string, CalcType>;
  onCalculationsChange: (calcs: Record<string, CalcType>) => void;
}

function computeCalc(rows: DatabaseRow[], propId: string, calcType: CalcType): string {
  if (calcType === "none") return "";

  const values = rows.map((r) => r.properties[propId]);

  switch (calcType) {
    case "count":
      return String(rows.length);

    case "count_values":
      return String(
        values.filter((v) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0)).length
      );

    case "count_empty":
      return String(
        values.filter((v) => v == null || v === "" || (Array.isArray(v) && v.length === 0)).length
      );

    case "sum": {
      const nums = values.filter((v): v is number => typeof v === "number");
      return nums.length > 0 ? String(nums.reduce((a, b) => a + b, 0)) : "—";
    }

    case "average": {
      const nums = values.filter((v): v is number => typeof v === "number");
      return nums.length > 0 ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : "—";
    }

    case "min": {
      const nums = values.filter((v): v is number => typeof v === "number");
      return nums.length > 0 ? String(Math.min(...nums)) : "—";
    }

    case "max": {
      const nums = values.filter((v): v is number => typeof v === "number");
      return nums.length > 0 ? String(Math.max(...nums)) : "—";
    }

    default:
      return "";
  }
}

export function TableCalculations({
  properties,
  rows,
  widths,
  calculations,
  onCalculationsChange,
}: TableCalculationsProps) {
  const t = useTranslations("database");
  const [openMenuPropId, setOpenMenuPropId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; left: number }>({
    left: 0,
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const openMenu = useCallback(
    (propId: string) => {
      if (openMenuPropId === propId) {
        setOpenMenuPropId(null);
        return;
      }
      const trigger = triggerRefs.current[propId];
      if (trigger) {
        const rect = trigger.getBoundingClientRect();
        const menuHeight = 200;
        const spaceBelow = window.innerHeight - rect.bottom;
        const openUp = spaceBelow < menuHeight && rect.top > spaceBelow;

        setMenuPos({
          top: openUp ? undefined : rect.bottom + 2,
          bottom: openUp ? window.innerHeight - rect.top + 2 : undefined,
          left: rect.left,
        });
      }
      setOpenMenuPropId(propId);
    },
    [openMenuPropId]
  );

  useEffect(() => {
    if (!openMenuPropId) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuPropId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenuPropId]);

  const calcLabels: Record<CalcType, string> = {
    none: t("calcNone"),
    count: t("calcCount"),
    count_values: t("calcCountValues"),
    count_empty: t("calcCountEmpty"),
    sum: t("calcSum"),
    average: t("calcAverage"),
    min: t("calcMin"),
    max: t("calcMax"),
  };

  return (
    <div className="flex border-b border-border/50">
      {/* Empty row-number column */}
      <div className="w-10 shrink-0 border-r border-border/50" />

      {properties.map((prop) => {
        const width = widths[prop.id] ?? DEFAULT_COLUMN_WIDTH;
        const calc = calculations[prop.id] ?? "none";
        const result = computeCalc(rows, prop.id, calc);
        const availableCalcs = prop.type === "number" ? NUMBER_CALCS : DEFAULT_CALCS;

        return (
          <div key={prop.id} className="shrink-0 border-r border-border/50" style={{ width }}>
            <button
              ref={(el) => {
                triggerRefs.current[prop.id] = el;
              }}
              className="flex h-full w-full items-center px-2 py-1 text-xs text-muted-foreground/60 transition-colors hover:bg-accent/30 hover:text-muted-foreground"
              onClick={() => openMenu(prop.id)}
            >
              {calc !== "none" ? (
                <span>
                  <span className="text-muted-foreground/40">{calcLabels[calc]}: </span>
                  <span className="font-medium text-foreground/80">{result}</span>
                </span>
              ) : (
                <span className="opacity-0 transition-opacity group-hover/table:opacity-100">
                  {t("calculations")}
                </span>
              )}
            </button>

            {openMenuPropId === prop.id &&
              createPortal(
                <div
                  ref={menuRef}
                  className="animate-in fade-in-0 zoom-in-95 fixed z-[100] w-36 rounded-lg border border-border bg-popover p-1 shadow-lg duration-150"
                  style={{
                    top: menuPos.top,
                    bottom: menuPos.bottom,
                    left: menuPos.left,
                  }}
                >
                  {availableCalcs.map((c) => (
                    <button
                      key={c}
                      className={cn(
                        "flex w-full items-center rounded-md px-2.5 py-1.5 text-xs transition-colors",
                        calc === c
                          ? "bg-accent font-medium text-foreground"
                          : "text-muted-foreground hover:bg-accent/50"
                      )}
                      onClick={() => {
                        onCalculationsChange({ ...calculations, [prop.id]: c });
                        setOpenMenuPropId(null);
                      }}
                    >
                      {calcLabels[c]}
                    </button>
                  ))}
                </div>,
                document.body
              )}
          </div>
        );
      })}

      {/* Empty trailing column */}
      <div className="w-10 shrink-0" />
    </div>
  );
}
