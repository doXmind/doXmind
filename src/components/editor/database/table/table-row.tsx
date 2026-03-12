"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Expand, Copy, Trash2 } from "lucide-react";
import type {
  PropertyDef,
  DatabaseRow,
  CellValue,
  SelectChoice,
} from "@/extensions/database/database-types";
import { DEFAULT_COLUMN_WIDTH } from "@/extensions/database/database-types";
import { TableCell } from "./table-cell";
import { ConfirmDialog } from "../confirm-dialog";

interface TableRowProps {
  row: DatabaseRow;
  properties: PropertyDef[];
  widths: Record<string, number>;
  rowIndex: number;
  onCellChange: (rowId: string, propId: string, value: CellValue) => void;
  onChoicesChange: (propId: string, choices: SelectChoice[]) => void;
  onOpenPage: (rowId: string) => void;
  onDeleteRow: (rowId: string) => void;
  onDuplicateRow?: (rowId: string) => void;
  autoFocusFirstCell?: boolean;
}

export function TableRowComponent({
  row,
  properties,
  widths,
  rowIndex,
  onCellChange,
  onChoicesChange,
  onOpenPage,
  onDeleteRow,
  onDuplicateRow,
  autoFocusFirstCell,
}: TableRowProps) {
  const t = useTranslations("database");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <>
      <div className="group flex border-b border-border/50 transition-colors hover:bg-accent/50">
        {/* Row number + actions */}
        <div className="flex w-10 shrink-0 items-center justify-center border-r border-border/50 text-xs text-muted-foreground/60">
          <span className="group-hover:hidden">{rowIndex + 1}</span>
          <div className="hidden gap-0.5 group-hover:flex">
            <button
              className="rounded p-0.5 transition-colors hover:bg-accent"
              onClick={() => onOpenPage(row.id)}
              title={t("openAsPage")}
            >
              <Expand className="h-2.5 w-2.5" />
            </button>
            {onDuplicateRow && (
              <button
                className="rounded p-0.5 transition-colors hover:bg-accent"
                onClick={() => onDuplicateRow(row.id)}
                title={t("duplicateRow")}
              >
                <Copy className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        </div>

        {properties.map((prop, idx) => {
          const width = widths[prop.id] ?? DEFAULT_COLUMN_WIDTH;
          const isFirstText =
            autoFocusFirstCell &&
            prop.type === "text" &&
            properties.findIndex((p) => p.type === "text") === idx;
          return (
            <div key={prop.id} className="shrink-0 border-r border-border/50" style={{ width }}>
              <TableCell
                property={prop}
                value={row.properties[prop.id] ?? null}
                onChange={(val) => onCellChange(row.id, prop.id, val)}
                onChoicesChange={
                  prop.type === "select" || prop.type === "multi_select" || prop.type === "status"
                    ? (choices) => onChoicesChange(prop.id, choices)
                    : undefined
                }
                autoFocus={isFirstText}
                row={row}
              />
            </div>
          );
        })}

        {/* Delete button */}
        <div className="flex w-10 shrink-0 items-center justify-center">
          <button
            className="hidden rounded p-1 text-muted-foreground/40 transition-colors hover:bg-red-100 hover:text-red-600 group-hover:block dark:hover:bg-red-900/30 dark:hover:text-red-400"
            onClick={() => setShowDeleteConfirm(true)}
            title={t("deleteRow")}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {showDeleteConfirm && (
        <ConfirmDialog
          message={t("confirmDeleteRow")}
          confirmLabel={t("delete")}
          cancelLabel={t("cancel")}
          onConfirm={() => {
            setShowDeleteConfirm(false);
            onDeleteRow(row.id);
          }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </>
  );
}
