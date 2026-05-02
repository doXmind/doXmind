"use client";

/**
 * Pure-renderer half of the Excel editor.
 *
 * Owns the virtualisers, the row/column header strips, the drag-to-select
 * gesture, and the per-cell input. Everything else (state, toolbar,
 * formula bar, context menu, structural ops) stays in
 * `ExcelEditorWorkspace` so this file can stay focused on layout +
 * mouse/keyboard plumbing.
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { EditAdvance, EditingCell, ExcelCellPatch, SelectionRange } from "@/lib/excel/state";
import { rangeBounds, rangeContains } from "@/lib/excel/state";
import type { ExcelCellDto, ExcelSheetDto } from "@/lib/excel/parse-workbook";
import type { ExcelCellStyle } from "@/lib/storage/types";
import { cn } from "@/lib/utils";

const DEFAULT_ROW_HEIGHT_PX = 22;
const DEFAULT_COL_WIDTH_PX = 96;
const ROW_HEADER_WIDTH_PX = 44;
const COL_HEADER_HEIGHT_PX = 24;
const POINT_TO_PX = 96 / 72;
const CHAR_UNIT_TO_PX = 7;

export interface ExcelSheetViewProps {
  ref?: RefObject<HTMLDivElement | null>;
  sheet: ExcelSheetDto;
  zoom: number;
  cellsByCoord: Map<string, ExcelCellDto>;
  editsByCoord: Map<string, ExcelCellPatch>;
  selection: SelectionRange | null;
  editing: EditingCell | null;
  cellInputRef: RefObject<HTMLInputElement | null>;
  onSelectStart(row: number, col: number, options: { extend: boolean }): void;
  onSelectExtend(row: number, col: number): void;
  onSelectEnd(): void;
  onBeginEdit(row: number, col: number): void;
  onUpdateDraft(draft: string): void;
  onCommitEdit(advance?: EditAdvance): void;
  onCancelEdit(): void;
  onContextMenuAt(payload: {
    x: number;
    y: number;
    row: number;
    col: number;
    surface: "cell" | "row-header" | "col-header" | "corner";
  }): void;
  onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void;
}

export function ExcelSheetView({
  ref,
  sheet,
  zoom,
  cellsByCoord,
  editsByCoord,
  selection,
  editing,
  cellInputRef,
  onSelectStart,
  onSelectExtend,
  onSelectEnd,
  onBeginEdit,
  onUpdateDraft,
  onCommitEdit,
  onCancelEdit,
  onContextMenuAt,
  onKeyDown,
}: ExcelSheetViewProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const colWidths = useMemo(
    () =>
      Array.from({ length: sheet.colCount }, (_, i) => {
        const override = sheet.colWidths[String(i)];
        const px = override ? override * CHAR_UNIT_TO_PX : DEFAULT_COL_WIDTH_PX;
        return Math.max(40, Math.round(px * zoom));
      }),
    [sheet.colWidths, sheet.colCount, zoom]
  );

  const rowHeights = useMemo(
    () =>
      Array.from({ length: sheet.rowCount }, (_, i) => {
        const override = sheet.rowHeights[String(i)];
        const px = override ? override * POINT_TO_PX : DEFAULT_ROW_HEIGHT_PX;
        return Math.max(16, Math.round(px * zoom));
      }),
    [sheet.rowHeights, sheet.rowCount, zoom]
  );

  const rowVirtualizer = useVirtualizer({
    count: sheet.rowCount,
    getScrollElement: () => scrollerRef.current,
    estimateSize: (index) => rowHeights[index] ?? DEFAULT_ROW_HEIGHT_PX,
    overscan: 8,
  });

  const colVirtualizer = useVirtualizer({
    horizontal: true,
    count: sheet.colCount,
    getScrollElement: () => scrollerRef.current,
    estimateSize: (index) => colWidths[index] ?? DEFAULT_COL_WIDTH_PX,
    overscan: 4,
  });

  useEffect(() => {
    rowVirtualizer.measure();
    colVirtualizer.measure();
  }, [rowVirtualizer, colVirtualizer, zoom, sheet.id]);

  // Keep the focus end of the selection scrolled into view. We follow the
  // *end* of the range (not the anchor) so shift+arrow keys keep the
  // user's cursor visible as they extend the range.
  useEffect(() => {
    if (!selection) return;
    rowVirtualizer.scrollToIndex(selection.endRow, { align: "auto" });
    colVirtualizer.scrollToIndex(selection.endCol, { align: "auto" });
  }, [selection, rowVirtualizer, colVirtualizer]);

  // Auto-focus the in-cell input when entering cell edit mode.
  useLayoutEffect(() => {
    if (!editing || editing.source !== "cell") return;
    const input = cellInputRef.current;
    if (!input) return;
    input.focus();
    if (editing.freshDraft) {
      const len = input.value.length;
      input.setSelectionRange(len, len);
    } else {
      input.select();
    }
  }, [editing, cellInputRef]);

  // Window-level mouseup ends drag selection regardless of where the user
  // released the mouse (could be off the grid entirely).
  useEffect(() => {
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      onSelectEnd();
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [onSelectEnd]);

  const totalWidth = colVirtualizer.getTotalSize();
  const totalHeight = rowVirtualizer.getTotalSize();
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualCols = colVirtualizer.getVirtualItems();

  const bounds = selection ? rangeBounds(selection) : null;

  return (
    <div
      ref={ref}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative flex h-full w-full flex-1 outline-none"
    >
      <div ref={scrollerRef} className="relative h-full w-full overflow-auto bg-background">
        <div
          className="relative"
          style={{
            width: totalWidth + ROW_HEADER_WIDTH_PX,
            minHeight: totalHeight + COL_HEADER_HEIGHT_PX,
          }}
        >
          {/* Top sticky strip = corner + column headers */}
          <div
            className="bg-sidebar sticky top-0 z-20 flex border-b border-border/60"
            style={{ height: COL_HEADER_HEIGHT_PX }}
          >
            <div
              className="bg-sidebar sticky left-0 z-30 shrink-0 border-r border-border/60"
              style={{ width: ROW_HEADER_WIDTH_PX, height: COL_HEADER_HEIGHT_PX }}
              onContextMenu={(event) => {
                event.preventDefault();
                onContextMenuAt({
                  x: event.clientX,
                  y: event.clientY,
                  row: 0,
                  col: 0,
                  surface: "corner",
                });
              }}
            />
            <div
              className="relative shrink-0"
              style={{ width: totalWidth, height: COL_HEADER_HEIGHT_PX }}
            >
              {virtualCols.map((virtualCol) => {
                const isInRange =
                  bounds !== null &&
                  virtualCol.index >= bounds.left &&
                  virtualCol.index <= bounds.right;
                return (
                  <div
                    key={virtualCol.key}
                    className={cn(
                      "text-ui-xs absolute top-0 flex cursor-pointer select-none items-center justify-center border-r border-border/60 font-medium",
                      isInRange ? "bg-foreground/[0.06] text-foreground" : "text-muted-foreground"
                    )}
                    style={{
                      left: virtualCol.start,
                      width: virtualCol.size,
                      height: COL_HEADER_HEIGHT_PX,
                    }}
                    onMouseDown={(event) => {
                      // Click a column header → select the entire column.
                      onSelectStart(0, virtualCol.index, { extend: event.shiftKey });
                      onSelectExtend(sheet.rowCount - 1, virtualCol.index);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onContextMenuAt({
                        x: event.clientX,
                        y: event.clientY,
                        row: 0,
                        col: virtualCol.index,
                        surface: "col-header",
                      });
                    }}
                  >
                    {columnLabel(virtualCol.index)}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bottom flex row = sticky row headers + virtualised cell grid */}
          <div className="flex">
            <div
              className="bg-sidebar sticky left-0 z-10 shrink-0 border-r border-border/60"
              style={{ width: ROW_HEADER_WIDTH_PX, height: totalHeight }}
            >
              {virtualRows.map((virtualRow) => {
                const isInRange =
                  bounds !== null &&
                  virtualRow.index >= bounds.top &&
                  virtualRow.index <= bounds.bottom;
                return (
                  <div
                    key={virtualRow.key}
                    className={cn(
                      "text-ui-xs absolute left-0 flex cursor-pointer select-none items-center justify-center border-b border-border/60 font-medium",
                      isInRange ? "bg-foreground/[0.06] text-foreground" : "text-muted-foreground"
                    )}
                    style={{
                      top: virtualRow.start,
                      width: ROW_HEADER_WIDTH_PX,
                      height: virtualRow.size,
                    }}
                    onMouseDown={(event) => {
                      // Click a row header → select the entire row.
                      onSelectStart(virtualRow.index, 0, { extend: event.shiftKey });
                      onSelectExtend(virtualRow.index, sheet.colCount - 1);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onContextMenuAt({
                        x: event.clientX,
                        y: event.clientY,
                        row: virtualRow.index,
                        col: 0,
                        surface: "row-header",
                      });
                    }}
                  >
                    {virtualRow.index + 1}
                  </div>
                );
              })}
            </div>

            <div className="relative" style={{ width: totalWidth, height: totalHeight }}>
              {virtualRows.map((virtualRow) =>
                virtualCols.map((virtualCol) => {
                  const row = virtualRow.index;
                  const col = virtualCol.index;
                  const baseCell = cellsByCoord.get(coordKey(row, col));
                  const patch = editsByCoord.get(coordKey(row, col));
                  const inRange = selection ? rangeContains(selection, row, col) : false;
                  const isAnchor =
                    selection?.startRow === row && selection.startCol === col && !editing;
                  const isEnd = selection?.endRow === row && selection.endCol === col && !editing;
                  const isEditing =
                    editing?.row === row && editing.col === col && editing.source === "cell";
                  return (
                    <ExcelGridCell
                      key={`${virtualRow.key}:${virtualCol.key}`}
                      cell={baseCell}
                      patch={patch}
                      left={virtualCol.start}
                      top={virtualRow.start}
                      width={virtualCol.size}
                      height={virtualRow.size}
                      zoom={zoom}
                      inRange={inRange}
                      isAnchor={isAnchor}
                      isEnd={isEnd}
                      editing={isEditing ? editing : null}
                      inputRef={isEditing ? cellInputRef : undefined}
                      onMouseDown={(event) => {
                        draggingRef.current = true;
                        onSelectStart(row, col, { extend: event.shiftKey });
                      }}
                      onMouseEnter={() => {
                        if (draggingRef.current) onSelectExtend(row, col);
                      }}
                      onDoubleClick={() => onBeginEdit(row, col)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        onContextMenuAt({
                          x: event.clientX,
                          y: event.clientY,
                          row,
                          col,
                          surface: "cell",
                        });
                      }}
                      onDraftChange={onUpdateDraft}
                      onCommit={onCommitEdit}
                      onCancel={onCancelEdit}
                    />
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cell
// ---------------------------------------------------------------------------

interface ExcelGridCellProps {
  cell: ExcelCellDto | undefined;
  patch: ExcelCellPatch | undefined;
  left: number;
  top: number;
  width: number;
  height: number;
  zoom: number;
  inRange: boolean;
  isAnchor: boolean;
  isEnd: boolean;
  editing: EditingCell | null;
  inputRef?: RefObject<HTMLInputElement | null>;
  onMouseDown(event: React.MouseEvent<HTMLDivElement>): void;
  onMouseEnter(): void;
  onDoubleClick(): void;
  onContextMenu(event: React.MouseEvent<HTMLDivElement>): void;
  onDraftChange(draft: string): void;
  onCommit(advance?: EditAdvance): void;
  onCancel(): void;
}

function ExcelGridCell({
  cell,
  patch,
  left,
  top,
  width,
  height,
  zoom,
  inRange,
  isAnchor,
  isEnd,
  editing,
  inputRef,
  onMouseDown,
  onMouseEnter,
  onDoubleClick,
  onContextMenu,
  onDraftChange,
  onCommit,
  onCancel,
}: ExcelGridCellProps) {
  const style = mergeStyle(cell?.style, patch?.style);
  const align = style?.textAlign ?? alignFromValue(cell, patch);

  const wrapperStyle: CSSProperties = {
    left,
    top,
    width,
    height,
    background: style?.background,
    color: style?.color,
    fontWeight: style?.bold ? 600 : undefined,
    fontStyle: style?.italic ? "italic" : undefined,
    textDecoration: style?.underline ? "underline" : undefined,
    fontSize: style?.fontSize ? Math.round(style.fontSize * zoom) : Math.round(12 * zoom),
    fontFamily: style?.fontFamily,
    display: "flex",
    alignItems: verticalAlignToFlex(style?.verticalAlign),
    justifyContent: justifyFromAlign(align),
    textAlign: align,
  };

  const showAnchorRing = isAnchor && !editing;
  const showEndRing = isEnd && !isAnchor && !editing;

  return (
    <div
      role="gridcell"
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={cn(
        "absolute overflow-hidden border-b border-r border-border/60 px-1.5 py-0.5",
        inRange && !isAnchor && "bg-primary/[0.08]",
        showAnchorRing && "z-10 ring-2 ring-inset ring-primary/70",
        showEndRing && "z-10 ring-1 ring-inset ring-primary/40"
      )}
      style={wrapperStyle}
    >
      {editing ? (
        <ExcelCellInput
          ref={inputRef}
          align={align}
          value={editing.draft}
          onChange={onDraftChange}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      ) : (
        <ExcelCellLabel cell={cell} patch={patch} />
      )}
    </div>
  );
}

interface ExcelCellInputProps {
  align: "left" | "center" | "right";
  value: string;
  onChange(next: string): void;
  onCommit(advance?: EditAdvance): void;
  onCancel(): void;
}

const ExcelCellInput = ({
  ref,
  align,
  value,
  onChange,
  onCommit,
  onCancel,
}: ExcelCellInputProps & { ref?: RefObject<HTMLInputElement | null> }) => (
  <input
    ref={ref}
    type="text"
    value={value}
    onChange={(event) => onChange(event.target.value)}
    onBlur={() => onCommit()}
    onKeyDown={(event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onCommit({ dRow: event.shiftKey ? -1 : 1, dCol: 0 });
      } else if (event.key === "Tab") {
        event.preventDefault();
        onCommit({ dRow: 0, dCol: event.shiftKey ? -1 : 1 });
      } else if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      } else {
        // Don't let cell-edit keystrokes bubble up to the workspace's
        // global key handler (which would otherwise treat them as
        // navigation / shortcuts).
        event.stopPropagation();
      }
    }}
    className="h-full w-full bg-background text-foreground outline-none"
    style={{ textAlign: align }}
  />
);

function ExcelCellLabel({
  cell,
  patch,
}: {
  cell: ExcelCellDto | undefined;
  patch: ExcelCellPatch | undefined;
}): ReactNode {
  const text = formatCellValue(cell, patch);
  if (!text) return null;
  return <span className="block w-full truncate leading-tight">{text}</span>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function coordKey(row: number, col: number): string {
  return `${row}:${col}`;
}

export function columnLabel(index: number): string {
  let label = "";
  let n = index;
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

export function formatCellValue(
  cell: ExcelCellDto | undefined,
  patch: ExcelCellPatch | undefined
): string {
  if (patch) {
    if (patch.formula) return patch.formula;
    if (patch.value === null || patch.value === undefined) return "";
    return String(patch.value);
  }
  if (!cell) return "";
  if (cell.value === null || cell.value === undefined) return "";
  if (typeof cell.value === "number") {
    return cell.value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  if (typeof cell.value === "boolean") return cell.value ? "TRUE" : "FALSE";
  return String(cell.value);
}

export function formulaOrValueAsString(source: ExcelCellDto | ExcelCellPatch | undefined): string {
  if (!source) return "";
  if ("formula" in source && source.formula) return source.formula;
  const value = "value" in source ? source.value : undefined;
  if (value === null || value === undefined) return "";
  return String(value);
}

function alignFromValue(
  cell: ExcelCellDto | undefined,
  patch: ExcelCellPatch | undefined
): "left" | "center" | "right" {
  const value = patch && "value" in patch ? patch.value : cell?.value;
  if (typeof value === "number") return "right";
  if (typeof value === "boolean") return "center";
  return "left";
}

function justifyFromAlign(align: "left" | "center" | "right"): string {
  if (align === "center") return "center";
  if (align === "right") return "flex-end";
  return "flex-start";
}

function verticalAlignToFlex(va: ExcelCellStyle["verticalAlign"]): string {
  if (va === "top") return "flex-start";
  if (va === "bottom") return "flex-end";
  return "center";
}

function mergeStyle(
  base: ExcelCellStyle | undefined,
  overlay: ExcelCellStyle | undefined
): ExcelCellStyle | undefined {
  if (!base && !overlay) return undefined;
  return { ...(base ?? {}), ...(overlay ?? {}) };
}

export function parseDraft(draft: string): ExcelCellPatch {
  if (draft === "") return { value: null, formula: null };
  if (draft.startsWith("=")) return { formula: draft, value: null };
  if (/^-?\d+(\.\d+)?$/.test(draft)) return { value: Number(draft), formula: null };
  if (draft === "TRUE" || draft === "FALSE") return { value: draft === "TRUE", formula: null };
  return { value: draft, formula: null };
}
