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

import type {
  ExcelCellStyle,
  ExcelConditionalFormatRule,
  ExcelEditorState,
  ExcelStructuralOp,
  ExcelWorkbookOp,
} from "@/lib/storage/types";
import type {
  ExcelCellDto,
  ExcelMergeRange,
  ExcelSheetDto,
  ExcelWorkbookDto,
} from "@/lib/excel/parse-workbook";

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
    if (op.type === "mergeCells") {
      // Drop any existing merge that fully equals or sits inside the new
      // one (so re-merging an overlap doesn't leave a phantom inside).
      merges = merges.filter(
        (m) =>
          !(m.top >= op.top && m.bottom <= op.bottom && m.left >= op.left && m.right <= op.right)
      );
      merges = [...merges, { top: op.top, bottom: op.bottom, left: op.left, right: op.right }];
      continue;
    }
    if (op.type === "unmergeCells") {
      merges = merges.filter(
        (m) =>
          !(m.top <= op.bottom && m.bottom >= op.top && m.left <= op.right && m.right >= op.left)
      );
      continue;
    }
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
    default:
      // Merge / unmerge ops don't shift cells — applyOpsToSheet handles
      // them on the merges array directly and never calls in here.
      return cells;
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
    comments: transformCellsForOp(
      base.comments as ExcelCellsMap | undefined,
      op
    ) as typeof base.comments,
    conditionalFormats: transformConditionalFormatsForOp(base.conditionalFormats, op),
    ops: [...(base.ops ?? []), op],
  };
}

// ---------------------------------------------------------------------------
// Conditional-format transforms
// ---------------------------------------------------------------------------

function shiftIndex(
  i: number,
  start: number,
  end: number,
  insert: number,
  mode: "insert" | "delete"
): number | null {
  if (mode === "insert") {
    return i >= start ? i + insert : i;
  }
  if (i >= start && i < end) return null;
  if (i >= end) return i - (end - start);
  return i;
}

export function transformConditionalFormatsForOp(
  byId: Record<string, ExcelConditionalFormatRule[]> | undefined,
  op: ExcelStructuralOp
): Record<string, ExcelConditionalFormatRule[]> | undefined {
  if (!byId) return byId;
  const list = byId[op.sheetId];
  if (!list || list.length === 0) return byId;

  const next: ExcelConditionalFormatRule[] = [];
  for (const rule of list) {
    let { top, bottom, left, right } = rule.range;

    if (op.type === "insertRow" || op.type === "deleteRow") {
      const mode = op.type === "insertRow" ? "insert" : "delete";
      const start = op.type === "insertRow" ? op.before : op.index;
      const end = op.type === "insertRow" ? op.before : op.index + op.count;
      const insert = op.count;
      const t = shiftIndex(top, start, end, insert, mode);
      const b = shiftIndex(bottom, start, end, insert, mode);
      // Drop only when the entire range collapsed away.
      if (t === null && b === null) continue;
      top = t ?? start;
      bottom = b ?? Math.max(top, start);
      if (op.type === "deleteRow" && top > bottom) continue;
    } else if (op.type === "insertCol" || op.type === "deleteCol") {
      const mode = op.type === "insertCol" ? "insert" : "delete";
      const start = op.type === "insertCol" ? op.before : op.index;
      const end = op.type === "insertCol" ? op.before : op.index + op.count;
      const insert = op.count;
      const l = shiftIndex(left, start, end, insert, mode);
      const r = shiftIndex(right, start, end, insert, mode);
      if (l === null && r === null) continue;
      left = l ?? start;
      right = r ?? Math.max(left, start);
      if (op.type === "deleteCol" && left > right) continue;
    }

    next.push({ ...rule, range: { top, bottom, left, right } });
  }

  return { ...byId, [op.sheetId]: next };
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
// Workbook-level ops
// ---------------------------------------------------------------------------

const NEW_SHEET_DEFAULT_ROWS = 100;
const NEW_SHEET_DEFAULT_COLS = 26;

function blankSheetDto(id: string, name: string, index: number): ExcelSheetDto {
  return {
    id,
    name,
    index,
    rowCount: NEW_SHEET_DEFAULT_ROWS,
    colCount: NEW_SHEET_DEFAULT_COLS,
    rowHeights: {},
    colWidths: {},
    merges: [],
    frozen: { row: 0, col: 0 },
    cells: [],
  };
}

/**
 * Replay workbook-level ops onto the parsed workbook to derive the tab
 * strip the user actually sees: includes added sheets, renames,
 * duplicates, and excludes deleted ones.
 */
export function applyWorkbookOps(
  workbook: ExcelWorkbookDto,
  ops: ExcelWorkbookOp[] | undefined
): ExcelWorkbookDto {
  if (!ops || ops.length === 0) return workbook;
  let sheets = [...workbook.sheets];
  for (const op of ops) {
    if (op.type === "addSheet") {
      const idx = op.afterSheetId
        ? sheets.findIndex((s) => s.id === op.afterSheetId)
        : sheets.length - 1;
      const insertAt = idx >= 0 ? idx + 1 : sheets.length;
      const blank = blankSheetDto(op.sheetId, op.name, insertAt);
      sheets = [...sheets.slice(0, insertAt), blank, ...sheets.slice(insertAt)];
    } else if (op.type === "renameSheet") {
      sheets = sheets.map((s) => (s.id === op.sheetId ? { ...s, name: op.name } : s));
    } else if (op.type === "duplicateSheet") {
      const idx = sheets.findIndex((s) => s.id === op.sourceSheetId);
      if (idx < 0) continue;
      const source = sheets[idx];
      const copy: ExcelSheetDto = {
        ...source,
        id: op.sheetId,
        name: op.name,
        index: idx + 1,
        rowHeights: { ...source.rowHeights },
        colWidths: { ...source.colWidths },
        // cells/merges arrays are reused — the renderer treats them as
        // read-only and any user edits land in the patch overlay keyed by
        // the new sheetId so they don't bleed back into the source.
        cells: source.cells,
        merges: source.merges,
      };
      sheets = [...sheets.slice(0, idx + 1), copy, ...sheets.slice(idx + 1)];
    } else if (op.type === "deleteSheet") {
      sheets = sheets.filter((s) => s.id !== op.sheetId);
    }
  }
  sheets = sheets.map((s, i) => ({ ...s, index: i }));
  return { ...workbook, sheets };
}

export function applyWorkbookOp(
  state: ExcelEditorState | null,
  op: ExcelWorkbookOp
): ExcelEditorState {
  const base: ExcelEditorState = state ?? { version: 1 };
  let cells = base.cells;
  let ops = base.ops;
  let rowHeights = base.rowHeights;
  let colWidths = base.colWidths;
  let comments = base.comments;
  let conditionalFormats = base.conditionalFormats;
  if (op.type === "deleteSheet") {
    // Drop everything keyed by the dropped sheet so undo doesn't
    // resurrect orphaned edits, and the sidecar stays minimal.
    cells = filterMapByPrefix(cells, `${op.sheetId}!`);
    rowHeights = filterMapByPrefix(rowHeights, `${op.sheetId}!`);
    colWidths = filterMapByPrefix(colWidths, `${op.sheetId}!`);
    comments = filterMapByPrefix(comments, `${op.sheetId}!`);
    if (conditionalFormats?.[op.sheetId]) {
      const { [op.sheetId]: _drop, ...rest } = conditionalFormats;
      void _drop;
      conditionalFormats = rest;
    }
    ops = ops?.filter((entry) => entry.sheetId !== op.sheetId);
  }
  return {
    ...base,
    version: 1,
    cells,
    ops,
    rowHeights,
    colWidths,
    comments,
    conditionalFormats,
    workbookOps: [...(base.workbookOps ?? []), op],
  };
}

function filterMapByPrefix<T>(
  map: Record<string, T> | undefined,
  prefix: string
): Record<string, T> | undefined {
  if (!map) return map;
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(map)) {
    if (key.startsWith(prefix)) continue;
    out[key] = value;
  }
  return out;
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
