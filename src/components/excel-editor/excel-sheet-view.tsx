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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { EditAdvance, EditingCell, ExcelCellPatch, SelectionRange } from "@/lib/excel/state";
import { rangeBounds, rangeContains } from "@/lib/excel/state";
import { applyNumberFormat } from "@/lib/excel/format";
import type { ExcelCellDto, ExcelSheetDto } from "@/lib/excel/parse-workbook";
import type { ExcelBorderLineStyle, ExcelBorderSide, ExcelCellStyle } from "@/lib/storage/types";
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
  /** Anchors of merged regions keyed by `coordKey(row, col)`. */
  mergeAnchors: Map<string, { bottom: number; right: number }>;
  /** Cells covered by a merge that aren't the anchor — skipped at render. */
  mergeMembers: Set<string>;
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
  /** Persist a column's new width. `charUnits` matches openpyxl's domain. */
  onResizeColumn(col: number, charUnits: number): void;
  /** Persist a row's new height. `points` matches openpyxl's domain. */
  onResizeRow(row: number, points: number): void;
  /** AutoFill preview rectangle while the user drags the fill handle. */
  fillRange: SelectionRange | null;
  /** Mousedown on the bottom-right handle starts an AutoFill drag. */
  onAutoFillStart(): void;
  /** Mouseenter on a cell while AutoFill is active extends the rectangle. */
  onAutoFillExtend(row: number, col: number): void;
  /** Window-level mouseup commits the in-progress fill. */
  onAutoFillEnd(): void;
  /**
   * Engine-computed value lookup. The renderer asks for the live value
   * of every cell; cells with formulas surface the recalc result so the
   * user sees current values, not openpyxl's parse-time cache.
   */
  computedValueAt(row: number, col: number): string | number | boolean | null;
  /**
   * Frozen panes — `row` rows / `col` cols pinned to the top-left of
   * the viewport. The renderer paints them in a sticky strip on top of
   * the scrolling cell grid so they stay visible regardless of scroll.
   */
  frozenRow: number;
  frozenCol: number;
  /** Rows hidden by any active column filter. */
  hiddenRows: Set<number>;
  /** Show the filter ▾ button in column headers. */
  filterMode: boolean;
  /** Columns that currently have a non-trivial filter active. */
  activeColumnFilters: Set<number>;
  /** Open the filter popover anchored at the click. */
  onOpenColumnFilter(col: number, anchor: { x: number; y: number }): void;
  /** Cells that have a list-validation; renders a ▾ picker on the cell. */
  validationsByCoord: Map<string, { type: "list"; values: string[] }>;
  /** Mousedown on the validation ▾ — surfaces the picker. */
  onOpenValidationPicker(row: number, col: number, anchor: { x: number; y: number }): void;
  /**
   * Hook for the formula autocomplete popover. Returns `true` when the
   * key was consumed (cell input should skip its own handling).
   */
  onSuggestKey(key: string): boolean;
}

export function ExcelSheetView({
  ref,
  sheet,
  zoom,
  cellsByCoord,
  editsByCoord,
  mergeAnchors,
  mergeMembers,
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
  onResizeColumn,
  onResizeRow,
  fillRange,
  onAutoFillStart,
  onAutoFillExtend,
  onAutoFillEnd,
  computedValueAt,
  frozenRow,
  frozenCol,
  hiddenRows,
  filterMode,
  activeColumnFilters,
  onOpenColumnFilter,
  validationsByCoord,
  onOpenValidationPicker,
  onSuggestKey,
}: ExcelSheetViewProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  // True between AutoFill mousedown and the next window mouseup. Mouseup
  // must always be observed at the window level since the cursor can
  // leave the grid mid-drag.
  const fillingRef = useRef(false);

  // In-progress drag-resize state. `index` identifies the col/row being
  // pulled; `sizePx` is the live cursor-driven pixel size. We override
  // the corresponding entry in colWidths / rowHeights so the renderer
  // (and virtualizer) sees the new size *during* the drag without
  // pushing a frame onto the undo stack — that only happens on commit.
  const [draftResize, setDraftResize] = useState<{
    axis: "col" | "row";
    index: number;
    sizePx: number;
  } | null>(null);

  /** Real (untrucated) cell sizes — used by the frozen-pane strips that
   *  render outside the virtualizer. */
  const realColWidth = (i: number): number => {
    if (draftResize?.axis === "col" && draftResize.index === i) {
      return Math.max(20, Math.round(draftResize.sizePx));
    }
    const override = sheet.colWidths[String(i)];
    const px = override ? override * CHAR_UNIT_TO_PX : DEFAULT_COL_WIDTH_PX;
    return Math.max(40, Math.round(px * zoom));
  };
  const realRowHeight = (i: number): number => {
    if (hiddenRows.has(i)) return 0;
    if (draftResize?.axis === "row" && draftResize.index === i) {
      return Math.max(8, Math.round(draftResize.sizePx));
    }
    const override = sheet.rowHeights[String(i)];
    const px = override ? override * POINT_TO_PX : DEFAULT_ROW_HEIGHT_PX;
    return Math.max(16, Math.round(px * zoom));
  };

  // The virtualizers see size=0 for frozen indices so their cumulative
  // offsets reflect *only* the scrollable region. The frozen indices are
  // re-rendered in dedicated sticky strips alongside.
  const colWidths = useMemo(
    () => Array.from({ length: sheet.colCount }, (_, i) => (i < frozenCol ? 0 : realColWidth(i))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheet.colWidths, sheet.colCount, zoom, draftResize, frozenCol]
  );

  const rowHeights = useMemo(
    () => Array.from({ length: sheet.rowCount }, (_, i) => (i < frozenRow ? 0 : realRowHeight(i))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheet.rowHeights, sheet.rowCount, zoom, draftResize, hiddenRows, frozenRow]
  );

  // Cumulative real sizes for the frozen segments — used to absolutely
  // place the frozen header / cell entries inside their sticky strips.
  const frozenColOffsets = useMemo(() => {
    const out = new Array(frozenCol + 1);
    out[0] = 0;
    for (let i = 0; i < frozenCol; i++) out[i + 1] = out[i] + realColWidth(i);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.colWidths, frozenCol, zoom, draftResize]);

  const frozenRowOffsets = useMemo(() => {
    const out = new Array(frozenRow + 1);
    out[0] = 0;
    for (let i = 0; i < frozenRow; i++) out[i + 1] = out[i] + realRowHeight(i);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.rowHeights, frozenRow, zoom, draftResize, hiddenRows]);

  const frozenColsWidth = frozenColOffsets[frozenCol] ?? 0;
  const frozenRowsHeight = frozenRowOffsets[frozenRow] ?? 0;

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
  }, [rowVirtualizer, colVirtualizer, zoom, sheet.id, hiddenRows]);

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

  // Window-level mouseup ends drag selection / autofill regardless of
  // where the user released the mouse (could be off the grid entirely).
  useEffect(() => {
    const onUp = () => {
      if (fillingRef.current) {
        fillingRef.current = false;
        onAutoFillEnd();
      }
      if (!draggingRef.current) return;
      draggingRef.current = false;
      onSelectEnd();
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [onSelectEnd, onAutoFillEnd]);

  // Drag-resize on column / row header edges. We track the gesture with
  // window-level listeners so the cursor can leave the header strip
  // mid-drag without losing the operation. The transient size lives in
  // `draftResize` (renderer reads it directly); commit happens once on
  // mouseup so undo gets a single tidy entry.
  const beginColumnResize = (col: number, startEvent: React.MouseEvent) => {
    startEvent.preventDefault();
    startEvent.stopPropagation();
    const startX = startEvent.clientX;
    const startSize = colWidths[col] ?? DEFAULT_COL_WIDTH_PX;
    let lastSize = startSize;
    document.body.style.cursor = "col-resize";
    const onMove = (event: MouseEvent) => {
      lastSize = Math.max(20, startSize + (event.clientX - startX));
      setDraftResize({ axis: "col", index: col, sizePx: lastSize });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      // Convert px → Excel character units (the openpyxl-native domain).
      const charUnits = lastSize / Math.max(0.1, zoom) / CHAR_UNIT_TO_PX;
      setDraftResize(null);
      onResizeColumn(col, charUnits);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const beginRowResize = (row: number, startEvent: React.MouseEvent) => {
    startEvent.preventDefault();
    startEvent.stopPropagation();
    const startY = startEvent.clientY;
    const startSize = rowHeights[row] ?? DEFAULT_ROW_HEIGHT_PX;
    let lastSize = startSize;
    document.body.style.cursor = "row-resize";
    const onMove = (event: MouseEvent) => {
      lastSize = Math.max(8, startSize + (event.clientY - startY));
      setDraftResize({ axis: "row", index: row, sizePx: lastSize });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      const points = lastSize / Math.max(0.1, zoom) / POINT_TO_PX;
      setDraftResize(null);
      onResizeRow(row, points);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const totalWidth = colVirtualizer.getTotalSize();
  const totalHeight = rowVirtualizer.getTotalSize();
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualCols = colVirtualizer.getVirtualItems();

  const bounds = selection ? rangeBounds(selection) : null;

  /** Render a single cell at the given pixel rect. Used by all four
   *  quadrants (frozen × frozen, frozen × scroll, scroll × frozen,
   *  scroll × scroll) so the cell semantics stay identical regardless
   *  of which sticky layer it lives in. */
  const renderCell = (
    row: number,
    col: number,
    left: number,
    top: number,
    width: number,
    height: number,
    keySuffix: string
  ) => {
    if (hiddenRows.has(row)) return null;
    const key = coordKey(row, col);
    if (mergeMembers.has(key)) return null;
    const mergeAnchor = mergeAnchors.get(key);
    let cellWidth = width;
    let cellHeight = height;
    if (mergeAnchor) {
      // Merge spans use *real* sizes so a merge that crosses the freeze
      // boundary still paints the right bounding box.
      cellWidth = 0;
      for (let c = col; c <= mergeAnchor.right; c++) cellWidth += realColWidth(c);
      cellHeight = 0;
      for (let r = row; r <= mergeAnchor.bottom; r++) cellHeight += realRowHeight(r);
    }
    const baseCell = cellsByCoord.get(key);
    const patch = editsByCoord.get(key);
    const inRange = selection ? rangeContains(selection, row, col) : false;
    const inFillRange = fillRange ? rangeContains(fillRange, row, col) : false;
    const isAnchor = selection?.startRow === row && selection.startCol === col && !editing;
    const isEnd = selection?.endRow === row && selection.endCol === col && !editing;
    const isEditing = editing?.row === row && editing.col === col && editing.source === "cell";
    const showFillHandle =
      !editing &&
      !fillRange &&
      selection != null &&
      row === Math.max(selection.startRow, selection.endRow) &&
      col === Math.max(selection.startCol, selection.endCol);
    const hasValidation = validationsByCoord.has(key);
    return (
      <ExcelGridCell
        key={`${keySuffix}:${row}:${col}`}
        cell={baseCell}
        patch={patch}
        computed={computedValueAt(row, col)}
        left={left}
        top={top}
        width={cellWidth}
        height={cellHeight}
        zoom={zoom}
        inRange={inRange}
        inFillRange={inFillRange}
        isAnchor={isAnchor}
        isEnd={isEnd}
        isMergeAnchor={!!mergeAnchor}
        showFillHandle={showFillHandle}
        hasValidation={hasValidation}
        onValidationDownArrow={(event) =>
          onOpenValidationPicker(row, col, { x: event.clientX, y: event.clientY })
        }
        onFillHandleMouseDown={() => {
          fillingRef.current = true;
          onAutoFillStart();
        }}
        editing={isEditing ? editing : null}
        inputRef={isEditing ? cellInputRef : undefined}
        onSuggestKey={onSuggestKey}
        onMouseDown={(event) => {
          draggingRef.current = true;
          onSelectStart(row, col, { extend: event.shiftKey });
        }}
        onMouseEnter={() => {
          if (fillingRef.current) onAutoFillExtend(row, col);
          else if (draggingRef.current) onSelectExtend(row, col);
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
  };

  /** Render a column header at a given absolute left offset. Same API
   *  for both frozen (statically positioned) and scrollable headers. */
  const renderColumnHeader = (col: number, left: number, width: number, keySuffix: string) => {
    const isInRange = bounds !== null && col >= bounds.left && col <= bounds.right;
    const colHasFilter = activeColumnFilters.has(col);
    return (
      <div
        key={`${keySuffix}:${col}`}
        className={cn(
          "text-ui-xs absolute top-0 flex cursor-pointer select-none items-center justify-center border-r border-border/60 font-medium",
          isInRange ? "bg-foreground/[0.06] text-foreground" : "text-muted-foreground"
        )}
        style={{ left, width, height: COL_HEADER_HEIGHT_PX }}
        onMouseDown={(event) => {
          onSelectStart(0, col, { extend: event.shiftKey });
          onSelectExtend(sheet.rowCount - 1, col);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenuAt({
            x: event.clientX,
            y: event.clientY,
            row: 0,
            col,
            surface: "col-header",
          });
        }}
      >
        {columnLabel(col)}
        {(filterMode || colHasFilter) && (
          <button
            type="button"
            aria-label={`Filter column ${columnLabel(col)}`}
            className={cn(
              "absolute right-1 top-1/2 -translate-y-1/2 rounded-[2px] px-0.5 text-[8px] leading-none",
              "transition-colors hover:bg-foreground/[0.08]",
              colHasFilter ? "bg-primary/15 text-primary" : "text-muted-foreground"
            )}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenColumnFilter(col, { x: event.clientX, y: event.clientY });
            }}
          >
            ▾
          </button>
        )}
        <div
          role="separator"
          aria-label={`Resize column ${columnLabel(col)}`}
          className="absolute right-0 top-0 h-full w-[5px] cursor-col-resize hover:bg-primary/40"
          onMouseDown={(event) => beginColumnResize(col, event)}
        />
      </div>
    );
  };

  /** Render a row header at a given absolute top offset. */
  const renderRowHeader = (row: number, top: number, height: number, keySuffix: string) => {
    if (hiddenRows.has(row)) return null;
    const isInRange = bounds !== null && row >= bounds.top && row <= bounds.bottom;
    return (
      <div
        key={`${keySuffix}:${row}`}
        className={cn(
          "text-ui-xs absolute left-0 flex cursor-pointer select-none items-center justify-center border-b border-border/60 font-medium",
          isInRange ? "bg-foreground/[0.06] text-foreground" : "text-muted-foreground"
        )}
        style={{ top, width: ROW_HEADER_WIDTH_PX, height }}
        onMouseDown={(event) => {
          onSelectStart(row, 0, { extend: event.shiftKey });
          onSelectExtend(row, sheet.colCount - 1);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenuAt({
            x: event.clientX,
            y: event.clientY,
            row,
            col: 0,
            surface: "row-header",
          });
        }}
      >
        {row + 1}
        <div
          role="separator"
          aria-label={`Resize row ${row + 1}`}
          className="absolute bottom-0 left-0 h-[5px] w-full cursor-row-resize hover:bg-primary/40"
          onMouseDown={(event) => beginRowResize(row, event)}
        />
      </div>
    );
  };

  /** Indices for the frozen segments — array of `[0, frozenRow)` etc.
   *  used to spread sticky-strip iterations without inline `Array.from`. */
  const frozenRowIdx = useMemo(() => Array.from({ length: frozenRow }, (_, i) => i), [frozenRow]);
  const frozenColIdx = useMemo(() => Array.from({ length: frozenCol }, (_, i) => i), [frozenCol]);

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
            // Inner width / height = headers + frozen segments + scrollable
            // virtualizer totals. The virtualizer's totals already exclude
            // frozen indices (their size is 0).
            width: ROW_HEADER_WIDTH_PX + frozenColsWidth + totalWidth,
            minHeight: COL_HEADER_HEIGHT_PX + frozenRowsHeight + totalHeight,
          }}
        >
          {/* ─── Quadrant 1 row: column headers ─────────────────────── */}
          <div
            className="bg-sidebar sticky top-0 z-30 flex border-b border-border/60"
            style={{ height: COL_HEADER_HEIGHT_PX }}
          >
            {/* Corner */}
            <div
              className="bg-sidebar sticky left-0 z-40 shrink-0 border-r border-border/60"
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
            {/* Frozen column headers (sticky-left) */}
            {frozenCol > 0 && (
              <div
                className="bg-sidebar z-35 sticky shrink-0 border-r border-border/60"
                style={{
                  left: ROW_HEADER_WIDTH_PX,
                  width: frozenColsWidth,
                  height: COL_HEADER_HEIGHT_PX,
                  position: "sticky",
                }}
              >
                <div
                  className="relative"
                  style={{ width: frozenColsWidth, height: COL_HEADER_HEIGHT_PX }}
                >
                  {frozenColIdx.map((c) =>
                    renderColumnHeader(c, frozenColOffsets[c], realColWidth(c), "fhdr")
                  )}
                </div>
              </div>
            )}
            {/* Scrollable column headers (virtualised) */}
            <div
              className="relative shrink-0"
              style={{ width: totalWidth, height: COL_HEADER_HEIGHT_PX }}
            >
              {virtualCols.map((virtualCol) => {
                if (virtualCol.index < frozenCol) return null;
                return renderColumnHeader(
                  virtualCol.index,
                  virtualCol.start,
                  virtualCol.size,
                  "shdr"
                );
              })}
            </div>
          </div>

          {/* ─── Quadrant 2 row: frozen rows ─────────────────────────── */}
          {frozenRow > 0 && (
            <div
              className="z-25 sticky flex border-b border-border/60 bg-background"
              style={{ top: COL_HEADER_HEIGHT_PX, height: frozenRowsHeight }}
            >
              {/* Frozen-row × row-headers (sticky-left) */}
              <div
                className="bg-sidebar z-35 sticky left-0 shrink-0 border-r border-border/60"
                style={{ width: ROW_HEADER_WIDTH_PX, height: frozenRowsHeight }}
              >
                {frozenRowIdx.map((r) =>
                  renderRowHeader(r, frozenRowOffsets[r], realRowHeight(r), "frh")
                )}
              </div>
              {/* Frozen × frozen intersection */}
              {frozenCol > 0 && (
                <div
                  className="z-35 shrink-0 border-r border-border/60 bg-background"
                  style={{
                    position: "sticky",
                    left: ROW_HEADER_WIDTH_PX,
                    width: frozenColsWidth,
                    height: frozenRowsHeight,
                  }}
                >
                  <div
                    className="relative"
                    style={{ width: frozenColsWidth, height: frozenRowsHeight }}
                  >
                    {frozenRowIdx.map((r) =>
                      frozenColIdx.map((c) =>
                        renderCell(
                          r,
                          c,
                          frozenColOffsets[c],
                          frozenRowOffsets[r],
                          realColWidth(c),
                          realRowHeight(r),
                          "ff"
                        )
                      )
                    )}
                  </div>
                </div>
              )}
              {/* Frozen-row × scrollable-col cells */}
              <div
                className="relative shrink-0"
                style={{ width: totalWidth, height: frozenRowsHeight }}
              >
                {frozenRowIdx.map((r) =>
                  virtualCols.map((virtualCol) => {
                    if (virtualCol.index < frozenCol) return null;
                    return renderCell(
                      r,
                      virtualCol.index,
                      virtualCol.start,
                      frozenRowOffsets[r],
                      virtualCol.size,
                      realRowHeight(r),
                      "fs"
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* ─── Quadrant 3 row: scrollable rows ─────────────────────── */}
          <div className="flex">
            {/* Row headers (sticky-left) */}
            <div
              className="bg-sidebar sticky left-0 z-10 shrink-0 border-r border-border/60"
              style={{ width: ROW_HEADER_WIDTH_PX, height: totalHeight }}
            >
              {virtualRows.map((virtualRow) => {
                if (virtualRow.index < frozenRow) return null;
                return renderRowHeader(virtualRow.index, virtualRow.start, virtualRow.size, "srh");
              })}
            </div>
            {/* Scrollable-row × frozen-col cells (sticky-left) */}
            {frozenCol > 0 && (
              <div
                className="z-15 sticky shrink-0 border-r border-border/60 bg-background"
                style={{
                  left: ROW_HEADER_WIDTH_PX,
                  width: frozenColsWidth,
                  height: totalHeight,
                  position: "sticky",
                }}
              >
                <div className="relative" style={{ width: frozenColsWidth, height: totalHeight }}>
                  {virtualRows.map((virtualRow) => {
                    if (virtualRow.index < frozenRow) return null;
                    return frozenColIdx.map((c) =>
                      renderCell(
                        virtualRow.index,
                        c,
                        frozenColOffsets[c],
                        virtualRow.start,
                        realColWidth(c),
                        virtualRow.size,
                        "sf"
                      )
                    );
                  })}
                </div>
              </div>
            )}
            {/* Main scrollable cell grid */}
            <div className="relative" style={{ width: totalWidth, height: totalHeight }}>
              {virtualRows.map((virtualRow) =>
                virtualCols.map((virtualCol) => {
                  const row = virtualRow.index;
                  const col = virtualCol.index;
                  if (row < frozenRow || col < frozenCol) return null;
                  return renderCell(
                    row,
                    col,
                    virtualCol.start,
                    virtualRow.start,
                    virtualCol.size,
                    virtualRow.size,
                    "ss"
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
  /** Engine-computed value for the cell (null when no engine yet). */
  computed: string | number | boolean | null;
  left: number;
  top: number;
  width: number;
  height: number;
  zoom: number;
  inRange: boolean;
  /** True when the cell sits inside the in-progress AutoFill rectangle. */
  inFillRange?: boolean;
  isAnchor: boolean;
  isEnd: boolean;
  /** True when this cell is the top-left of a merge spanning width/height. */
  isMergeAnchor?: boolean;
  /** Renders the small bottom-right AutoFill handle when true. */
  showFillHandle?: boolean;
  /** Mousedown on the fill handle — capture before cell selection. */
  onFillHandleMouseDown?(event: React.MouseEvent<HTMLDivElement>): void;
  /** Renders the right-edge ▾ when the cell has list validation. */
  hasValidation?: boolean;
  /** Mousedown on the validation ▾. */
  onValidationDownArrow?(event: React.MouseEvent<HTMLDivElement>): void;
  /** Formula-autocomplete key hook. */
  onSuggestKey?(key: string): boolean;
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
  computed,
  left,
  top,
  width,
  height,
  zoom,
  inRange,
  inFillRange,
  isAnchor,
  isEnd,
  isMergeAnchor,
  showFillHandle,
  onFillHandleMouseDown,
  hasValidation,
  onValidationDownArrow,
  onSuggestKey,
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

  const decorations: string[] = [];
  if (style?.underline) decorations.push("underline");
  if (style?.strikethrough) decorations.push("line-through");
  // Hyperlinks render as underlined primary-coloured text. We *add* the
  // underline rather than replacing existing decorations so a hyperlink
  // on a strikethrough cell still shows both lines.
  if (style?.hyperlink && !decorations.includes("underline")) decorations.push("underline");

  const border = style?.border;

  // Hyperlinks override the cell's text color so the link reads as a link
  // — matches the convention in Sheets / Excel. User-set color still wins
  // (so they can paint a hyperlink red if they want).
  const effectiveColor = style?.color ?? (style?.hyperlink ? "var(--primary)" : undefined);

  // Resolve the text-overflow state. `textOverflow` wins; falls back to
  // legacy `wrapText` for sidecars saved before the 3-state model.
  const textOverflow: "clip" | "wrap" | "overflow" =
    style?.textOverflow ?? (style?.wrapText ? "wrap" : "clip");
  const isWrap = textOverflow === "wrap";
  const isOverflow = textOverflow === "overflow";

  const wrapperStyle: CSSProperties = {
    left,
    top,
    width,
    height,
    background: style?.background,
    color: effectiveColor,
    fontWeight: style?.bold ? 600 : undefined,
    fontStyle: style?.italic ? "italic" : undefined,
    textDecoration: decorations.length > 0 ? decorations.join(" ") : undefined,
    fontSize: style?.fontSize ? Math.round(style.fontSize * zoom) : Math.round(12 * zoom),
    fontFamily: style?.fontFamily,
    display: "flex",
    alignItems: verticalAlignToFlex(style?.verticalAlign),
    justifyContent: justifyFromAlign(align),
    textAlign: align,
    whiteSpace: isWrap ? "pre-wrap" : "nowrap",
    wordBreak: isWrap ? "break-word" : undefined,
    // `overflow: visible` lets text bleed into adjacent cells. We don't
    // currently bump z-index to "win" against neighbours' clips because
    // the typical case (overflow into an *empty* neighbour) just works,
    // and bumping every overflow cell would scramble selection rings.
    overflow: isOverflow ? "visible" : "hidden",
    borderTop: borderCss(border?.top),
    borderRight: borderCss(border?.right),
    borderBottom: borderCss(border?.bottom),
    borderLeft: borderCss(border?.left),
    cursor: style?.hyperlink ? "pointer" : undefined,
  };

  const showAnchorRing = isAnchor && !editing;
  const showEndRing = isEnd && !isAnchor && !editing;

  const hyperlink = style?.hyperlink;

  return (
    <div
      role="gridcell"
      onMouseDown={(event) => {
        // Cmd/Ctrl-click on a hyperlinked cell opens the URL in the
        // user's browser (matches Sheets / Excel). The click still falls
        // through to selection so the user keeps a visual breadcrumb.
        if (hyperlink && (event.metaKey || event.ctrlKey)) {
          window.open(hyperlink, "_blank", "noopener,noreferrer");
        }
        onMouseDown(event);
      }}
      onMouseEnter={onMouseEnter}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={cn(
        "absolute overflow-hidden border-b border-r border-border/60 px-1.5 py-0.5",
        inRange && !isAnchor && "bg-primary/[0.08]",
        // Fill preview: dashed primary outline tells the user the cells
        // they're about to overwrite. Sits above the default gridline.
        inFillRange && "z-[2] outline-dashed outline-1 outline-primary/70",
        showAnchorRing && "z-10 ring-2 ring-inset ring-primary/70",
        showEndRing && "z-10 ring-1 ring-inset ring-primary/40",
        isMergeAnchor && "z-[1]"
      )}
      style={wrapperStyle}
    >
      {showFillHandle && (
        <div
          aria-label="Fill handle"
          className="absolute -bottom-[3px] -right-[3px] z-20 h-[7px] w-[7px] cursor-crosshair rounded-[1px] border border-background bg-primary"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onFillHandleMouseDown?.(event);
          }}
        />
      )}
      {hasValidation && !editing && (
        <div
          role="button"
          aria-label="Open validation list"
          className="z-15 absolute right-0 top-0 flex h-full w-4 cursor-pointer items-center justify-center bg-foreground/[0.04] text-[8px] text-muted-foreground hover:bg-foreground/[0.1]"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onValidationDownArrow?.(event);
          }}
        >
          ▾
        </div>
      )}
      {editing ? (
        <ExcelCellInput
          ref={inputRef}
          align={align}
          value={editing.draft}
          onChange={onDraftChange}
          onCommit={onCommit}
          onCancel={onCancel}
          onSuggestKey={onSuggestKey}
        />
      ) : (
        <ExcelCellLabel
          cell={cell}
          patch={patch}
          computed={computed}
          wrap={isWrap}
          rotation={style?.rotation}
        />
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
  /** Formula autocomplete hook — returns true if the key was consumed. */
  onSuggestKey?(key: string): boolean;
}

const ExcelCellInput = ({
  ref,
  align,
  value,
  onChange,
  onCommit,
  onCancel,
  onSuggestKey,
}: ExcelCellInputProps & { ref?: RefObject<HTMLInputElement | null> }) => (
  <input
    ref={ref}
    type="text"
    value={value}
    onChange={(event) => onChange(event.target.value)}
    onBlur={() => onCommit()}
    onKeyDown={(event) => {
      // Formula autocomplete gets first crack at navigation keys so it
      // can intercept Tab / Enter / arrows before commit / advance.
      if (onSuggestKey && onSuggestKey(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
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
  computed,
  wrap,
  rotation,
}: {
  cell: ExcelCellDto | undefined;
  patch: ExcelCellPatch | undefined;
  computed: string | number | boolean | null;
  wrap: boolean;
  rotation?: number;
}): ReactNode {
  const text = formatCellValue(cell, patch, computed);
  if (!text) return null;
  const rotated = typeof rotation === "number" && rotation !== 0;
  return (
    <span
      className={cn("block w-full leading-tight", wrap ? "whitespace-pre-wrap" : "truncate")}
      style={
        rotated ? { transform: `rotate(${-rotation!}deg)`, transformOrigin: "center" } : undefined
      }
    >
      {text}
    </span>
  );
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
  patch: ExcelCellPatch | undefined,
  /**
   * Optional engine-computed value. When provided and the cell holds a
   * formula (in either `patch` or `cell`), the computed value renders
   * instead of the formula text. Pass `null` to fall back to the
   * formula text (engine unavailable).
   */
  computed?: string | number | boolean | null
): string {
  // Effective number format: user override wins, else parse-time value.
  const numberFormat = patch?.numberFormat ?? cell?.numberFormat;
  const hasFormula =
    Boolean(patch && "formula" in patch && patch.formula) || Boolean(cell?.formula);

  if (hasFormula) {
    if (computed !== undefined && computed !== null) {
      return renderValue(computed, numberFormat);
    }
    // No engine value — fall through to whatever cached value the
    // workbook held at parse time (openpyxl's `data_only=True` pass).
    const fallback = patch?.value !== undefined ? patch.value : cell?.value;
    if (fallback !== undefined && fallback !== null) {
      return renderValue(fallback, numberFormat);
    }
    // No cache either — last resort: show the formula text so the user
    // at least sees something they can act on.
    return patch?.formula ?? cell?.formula ?? "";
  }

  if (patch) {
    const value = patch.value !== undefined ? patch.value : cell?.value;
    return renderValue(value, numberFormat);
  }
  if (!cell) return "";
  return renderValue(cell.value, numberFormat);
}

function renderValue(value: unknown, numberFormat: string | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (numberFormat && numberFormat !== "General") {
      return applyNumberFormat(value, numberFormat);
    }
    return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
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

const BORDER_LINE_WIDTH: Record<ExcelBorderLineStyle, number> = {
  thin: 1,
  medium: 2,
  thick: 3,
  double: 3,
  dashed: 1,
  dotted: 1,
};

const BORDER_LINE_CSS: Record<ExcelBorderLineStyle, string> = {
  thin: "solid",
  medium: "solid",
  thick: "solid",
  double: "double",
  dashed: "dashed",
  dotted: "dotted",
};

function borderCss(side: ExcelBorderSide | undefined): string | undefined {
  if (!side || !side.style) return undefined;
  const width = BORDER_LINE_WIDTH[side.style] ?? 1;
  const cssStyle = BORDER_LINE_CSS[side.style] ?? "solid";
  const color = side.color ?? "currentColor";
  return `${width}px ${cssStyle} ${color}`;
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
