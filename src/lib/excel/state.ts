/**
 * Pure helpers for the Excel editor's state model.
 *
 *   - `applyOpsToSheet` produces a "display sheet" from a parsed sheet plus
 *     the structural ops accumulated in the sidecar. The renderer reads
 *     from the display sheet so cells, merges, and headers all reflect
 *     post-op coordinates.
 *
 *   - `transformCellsForOp` shifts existing edit keys when a new structural
 *     op is appended, so already-edited cells stay tied to the right
 *     visual position after a row/column insert or delete.
 *
 *   - `transformDimensionMapForOp` does the same for `rowHeights` /
 *     `colWidths` records that are keyed by `"${sheetId}!${index}"`.
 *
 *   - `transformRangeForOp` shifts an in-flight selection range when a
 *     structural op is applied so the user keeps "their" cells highlighted.
 *
 * Keeping these pure and outside React makes them trivially unit-testable
 * later, and avoids bloating the workspace component further.
 */

import type { ExcelCellStyle, ExcelEditorState, ExcelStructuralOp } from "@/lib/storage/types";
import type { ExcelCellDto, ExcelMergeRange, ExcelSheetDto } from "@/lib/excel/parse-workbook";

export interface ExcelCellPatch {
  value?: string | number | boolean | null;
  formula?: string | null;
  numberFormat?: string;
  style?: ExcelCellStyle;
}

export type ExcelCellsMap = NonNullable<ExcelEditorState["cells"]>;

export interface EditingCell {
  row: number;
  col: number;
  draft: string;
  /**
   * `true` when the input was opened by typing a fresh character — the
   * caret goes at the end and existing text is *not* selected, so the
   * user's keystroke replaces nothing. F2 / double-click open with the
   * existing value pre-selected for easy overwrite.
   */
  freshDraft: boolean;
  /** The surface that owns the input — controls focus + key handling. */
  source: "cell" | "formula-bar";
}

export type EditAdvance = { dRow: number; dCol: number };

/**
 * Lightweight diff between two cell coordinates. Used as the payload from
 * the editor to the in-cell input when committing — the input doesn't
 * care about absolute coordinates, just where to land next.
 */
export const ADVANCE_DOWN: EditAdvance = { dRow: 1, dCol: 0 };
export const ADVANCE_UP: EditAdvance = { dRow: -1, dCol: 0 };
export const ADVANCE_RIGHT: EditAdvance = { dRow: 0, dCol: 1 };
export const ADVANCE_LEFT: EditAdvance = { dRow: 0, dCol: -1 };

// ---------------------------------------------------------------------------
// Display sheet derivation
// ---------------------------------------------------------------------------

export function applyOpsToSheet(
  parsed: ExcelSheetDto,
  ops: ExcelStructuralOp[] | undefined
): ExcelSheetDto {
  if (!ops || ops.length === 0) return parsed;

  let cells = parsed.cells;
  let rowCount = parsed.rowCount;
  let colCount = parsed.colCount;
  let merges = parsed.merges;
  let rowHeights = { ...parsed.rowHeights };
  let colWidths = { ...parsed.colWidths };

  for (const op of ops) {
    if (op.sheetId !== parsed.id) continue;
    cells = shiftCellsForOp(cells, op);
    merges = shiftMergesForOp(merges, op);
    if (op.type === "insertRow") {
      rowCount += op.count;
      rowHeights = shiftDimensionForward(rowHeights, op.before, op.count);
    } else if (op.type === "deleteRow") {
      rowCount = Math.max(0, rowCount - op.count);
      rowHeights = shiftDimensionBackward(rowHeights, op.index, op.count);
    } else if (op.type === "insertCol") {
      colCount += op.count;
      colWidths = shiftDimensionForward(colWidths, op.before, op.count);
    } else if (op.type === "deleteCol") {
      colCount = Math.max(0, colCount - op.count);
      colWidths = shiftDimensionBackward(colWidths, op.index, op.count);
    }
  }

  return { ...parsed, cells, rowCount, colCount, merges, rowHeights, colWidths };
}

function shiftCellsForOp(cells: ExcelCellDto[], op: ExcelStructuralOp): ExcelCellDto[] {
  switch (op.type) {
    case "insertRow":
      return cells.map((c) => (c.row >= op.before ? { ...c, row: c.row + op.count } : c));
    case "deleteRow":
      return cells
        .filter((c) => c.row < op.index || c.row >= op.index + op.count)
        .map((c) => (c.row >= op.index + op.count ? { ...c, row: c.row - op.count } : c));
    case "insertCol":
      return cells.map((c) => (c.col >= op.before ? { ...c, col: c.col + op.count } : c));
    case "deleteCol":
      return cells
        .filter((c) => c.col < op.index || c.col >= op.index + op.count)
        .map((c) => (c.col >= op.index + op.count ? { ...c, col: c.col - op.count } : c));
  }
}

function shiftMergesForOp(merges: ExcelMergeRange[], op: ExcelStructuralOp): ExcelMergeRange[] {
  const out: ExcelMergeRange[] = [];
  for (const m of merges) {
    switch (op.type) {
      case "insertRow":
        out.push({
          top: m.top >= op.before ? m.top + op.count : m.top,
          bottom: m.bottom >= op.before ? m.bottom + op.count : m.bottom,
          left: m.left,
          right: m.right,
        });
        break;
      case "deleteRow":
        // Drop merges entirely inside the deleted range.
        if (m.top >= op.index && m.bottom < op.index + op.count) continue;
        out.push({
          top: m.top >= op.index + op.count ? m.top - op.count : m.top,
          bottom: m.bottom >= op.index + op.count ? m.bottom - op.count : m.bottom,
          left: m.left,
          right: m.right,
        });
        break;
      case "insertCol":
        out.push({
          top: m.top,
          bottom: m.bottom,
          left: m.left >= op.before ? m.left + op.count : m.left,
          right: m.right >= op.before ? m.right + op.count : m.right,
        });
        break;
      case "deleteCol":
        if (m.left >= op.index && m.right < op.index + op.count) continue;
        out.push({
          top: m.top,
          bottom: m.bottom,
          left: m.left >= op.index + op.count ? m.left - op.count : m.left,
          right: m.right >= op.index + op.count ? m.right - op.count : m.right,
        });
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Edit-map transforms
// ---------------------------------------------------------------------------

export function transformCellsForOp(
  cells: ExcelCellsMap | undefined,
  op: ExcelStructuralOp
): ExcelCellsMap | undefined {
  if (!cells) return cells;
  const out: ExcelCellsMap = {};
  for (const [key, patch] of Object.entries(cells)) {
    const split = splitCellKey(key);
    if (!split || split.sheetId !== op.sheetId) {
      out[key] = patch;
      continue;
    }
    const { row, col } = split;
    let nextRow = row;
    let nextCol = col;
    let dropped = false;

    switch (op.type) {
      case "insertRow":
        if (row >= op.before) nextRow = row + op.count;
        break;
      case "deleteRow":
        if (row >= op.index && row < op.index + op.count) dropped = true;
        else if (row >= op.index + op.count) nextRow = row - op.count;
        break;
      case "insertCol":
        if (col >= op.before) nextCol = col + op.count;
        break;
      case "deleteCol":
        if (col >= op.index && col < op.index + op.count) dropped = true;
        else if (col >= op.index + op.count) nextCol = col - op.count;
        break;
    }

    if (dropped) continue;
    out[`${split.sheetId}!${nextRow},${nextCol}`] = patch;
  }
  return out;
}

export function transformDimensionMapForOp(
  map: Record<string, number> | undefined,
  op: ExcelStructuralOp,
  axis: "row" | "col"
): Record<string, number> | undefined {
  if (!map) return map;
  const isRowAxis = axis === "row";
  const matchesAxis =
    (isRowAxis && (op.type === "insertRow" || op.type === "deleteRow")) ||
    (!isRowAxis && (op.type === "insertCol" || op.type === "deleteCol"));
  if (!matchesAxis) return map;

  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(map)) {
    const split = splitDimensionKey(key);
    if (!split || split.sheetId !== op.sheetId) {
      out[key] = value;
      continue;
    }
    let next: number | null = split.index;
    if (op.type === "insertRow" || op.type === "insertCol") {
      const before = op.before;
      if (split.index >= before) next = split.index + op.count;
    } else {
      const start = op.index;
      const end = op.index + op.count;
      if (split.index >= start && split.index < end) next = null;
      else if (split.index >= end) next = split.index - op.count;
    }
    if (next === null) continue;
    out[`${split.sheetId}!${next}`] = value;
  }
  return out;
}

export function applyEditorStateOp(
  state: ExcelEditorState | null,
  op: ExcelStructuralOp
): ExcelEditorState {
  const base: ExcelEditorState = state ?? { version: 1 };
  return {
    ...base,
    version: 1,
    cells: transformCellsForOp(base.cells, op),
    rowHeights: transformDimensionMapForOp(base.rowHeights, op, "row"),
    colWidths: transformDimensionMapForOp(base.colWidths, op, "col"),
    ops: [...(base.ops ?? []), op],
  };
}

// ---------------------------------------------------------------------------
// Range / selection helpers
// ---------------------------------------------------------------------------

export interface SelectionRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export function rangeBounds(range: SelectionRange): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  return {
    top: Math.min(range.startRow, range.endRow),
    bottom: Math.max(range.startRow, range.endRow),
    left: Math.min(range.startCol, range.endCol),
    right: Math.max(range.startCol, range.endCol),
  };
}

export function rangeContains(range: SelectionRange, row: number, col: number): boolean {
  const b = rangeBounds(range);
  return row >= b.top && row <= b.bottom && col >= b.left && col <= b.right;
}

export function rangeIsSingle(range: SelectionRange): boolean {
  return range.startRow === range.endRow && range.startCol === range.endCol;
}

export function singleCellRange(row: number, col: number): SelectionRange {
  return { startRow: row, startCol: col, endRow: row, endCol: col };
}

export function rangeOrigin(range: SelectionRange): { row: number; col: number } {
  // The "anchor" cell — used for the formula bar and toolbar effective style.
  const b = rangeBounds(range);
  return { row: b.top, col: b.left };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ParsedCellKey {
  sheetId: string;
  row: number;
  col: number;
}

interface ParsedDimensionKey {
  sheetId: string;
  index: number;
}

function splitCellKey(key: string): ParsedCellKey | null {
  const bang = key.indexOf("!");
  if (bang < 0) return null;
  const sheetId = key.slice(0, bang);
  const coords = key.slice(bang + 1);
  const comma = coords.indexOf(",");
  if (comma < 0) return null;
  const row = Number(coords.slice(0, comma));
  const col = Number(coords.slice(comma + 1));
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
  return { sheetId, row, col };
}

function splitDimensionKey(key: string): ParsedDimensionKey | null {
  const bang = key.indexOf("!");
  if (bang < 0) return null;
  const sheetId = key.slice(0, bang);
  const index = Number(key.slice(bang + 1));
  if (!Number.isFinite(index)) return null;
  return { sheetId, index };
}

function shiftDimensionForward(
  map: Record<string, number>,
  threshold: number,
  count: number
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(map)) {
    const split = splitDimensionKey(key);
    if (!split) {
      out[key] = value;
      continue;
    }
    const next = split.index >= threshold ? split.index + count : split.index;
    out[`${split.sheetId}!${next}`] = value;
  }
  return out;
}

function shiftDimensionBackward(
  map: Record<string, number>,
  threshold: number,
  count: number
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(map)) {
    const split = splitDimensionKey(key);
    if (!split) {
      out[key] = value;
      continue;
    }
    if (split.index >= threshold && split.index < threshold + count) continue;
    const next = split.index >= threshold + count ? split.index - count : split.index;
    out[`${split.sheetId}!${next}`] = value;
  }
  return out;
}
