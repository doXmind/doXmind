"use client";

import { useState, useCallback, memo } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface TableSizePickerProps {
  onSelect: (rows: number, cols: number) => void;
  maxRows?: number;
  maxCols?: number;
}

export const TableSizePicker = memo(function TableSizePicker({
  onSelect,
  maxRows = 8,
  maxCols = 8,
}: TableSizePickerProps) {
  const [hoverRow, setHoverRow] = useState(0);
  const [hoverCol, setHoverCol] = useState(0);
  const t = useTranslations("editor");

  const handleCellHover = useCallback((row: number, col: number) => {
    setHoverRow(row);
    setHoverCol(col);
  }, []);

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      onSelect(row, col);
    },
    [onSelect]
  );

  return (
    <div className="p-2">
      <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${maxCols}, 1fr)` }}>
        {Array.from({ length: maxRows }, (_, rowIdx) =>
          Array.from({ length: maxCols }, (_, colIdx) => {
            const row = rowIdx + 1;
            const col = colIdx + 1;
            const isHighlighted = row <= hoverRow && col <= hoverCol;

            return (
              <button
                key={`${row}-${col}`}
                onMouseEnter={() => handleCellHover(row, col)}
                onClick={() => handleCellClick(row, col)}
                className={cn(
                  "h-4 w-4 rounded-[2px] border transition-colors",
                  isHighlighted
                    ? "border-primary bg-primary/20"
                    : "border-border bg-background hover:border-muted-foreground/30"
                )}
                aria-label={t("tableSizeAria", { rows: row, cols: col })}
              />
            );
          })
        )}
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        {hoverRow > 0 && hoverCol > 0
          ? t("tableSize", { rows: hoverRow, cols: hoverCol })
          : t("selectSize")}
      </p>
    </div>
  );
});
