/**
 * HyperFormula adapter — builds a recalc engine over the parsed workbook
 * + the user's sidecar patches and exposes a tiny query API the renderer
 * can use to look up *computed* cell values (as opposed to the cached
 * values openpyxl handed us at parse time).
 *
 * The engine is sheet-name-keyed (matching HyperFormula's domain) but our
 * workspace tracks sheets by `sheet-N` ids. We hold a small id ↔ name
 * map alongside the engine so the workspace can translate without
 * threading the live workbook through every call site.
 *
 * License note: HyperFormula's GPLv3 license key is "gpl-v3"; the
 * commercial key would replace it for proprietary builds.
 */

import {
  HyperFormula,
  type CellValue,
  type DetailedCellError,
  type SimpleCellAddress,
} from "hyperformula";

import type { ExcelEditorState } from "@/lib/storage/types";
import type { ExcelWorkbookDto } from "@/lib/excel/parse-workbook";

export interface ExcelEngine {
  hf: HyperFormula;
  /** Map our `sheet-N` ids to the engine's sheet name. */
  sheetIdToName: Map<string, string>;
}

const HF_OPTIONS = {
  licenseKey: "gpl-v3",
  // We compute numbers in JS — leave date/time interpretation to the
  // renderer's number-format pass for now, otherwise HF would coerce
  // numeric serial dates we'd rather show as numbers.
  smartRounding: false,
} as const;

/**
 * Build a fresh engine seeded with everything the workspace knows: the
 * parsed cells from the original `.xlsx` plus the user's accumulated
 * patches. Sparse — we only `setCellContents` for cells that actually
 * have a value or a formula, so a 5000×200 sheet stays cheap.
 */
export function createExcelEngine(
  workbook: ExcelWorkbookDto,
  editorState: ExcelEditorState | null
): ExcelEngine {
  const hf = HyperFormula.buildEmpty(HF_OPTIONS);
  const sheetIdToName = new Map<string, string>();

  for (const sheet of workbook.sheets) {
    // HF allows sheet rename + handles duplicates, but our names are
    // already deduped upstream by the workbook ops phase.
    hf.addSheet(sheet.name);
    sheetIdToName.set(sheet.id, sheet.name);
  }

  hf.suspendEvaluation();
  for (const sheet of workbook.sheets) {
    const sheetIdx = hf.getSheetId(sheet.name);
    if (sheetIdx === undefined) continue;
    for (const cell of sheet.cells) {
      const content = cell.formula ?? rawForEngine(cell.value);
      if (content === null || content === undefined) continue;
      hf.setCellContents({ sheet: sheetIdx, col: cell.col, row: cell.row }, content);
    }
  }

  if (editorState?.cells) {
    for (const [key, patch] of Object.entries(editorState.cells)) {
      const split = splitCellKey(key);
      if (!split) continue;
      const sheetName = sheetIdToName.get(split.sheetId);
      if (!sheetName) continue;
      const sheetIdx = hf.getSheetId(sheetName);
      if (sheetIdx === undefined) continue;
      const content = patchToContent(patch);
      hf.setCellContents({ sheet: sheetIdx, col: split.col, row: split.row }, content);
    }
  }
  hf.resumeEvaluation();

  return { hf, sheetIdToName };
}

/**
 * Apply a single cell-edit patch to the engine in place. Returns the
 * rebuilt engine reference (always the same instance) so callers can
 * chain calls. The engine's dependency graph propagates the change to
 * dependent formulas automatically.
 */
export function syncCellInEngine(
  engine: ExcelEngine,
  sheetId: string,
  row: number,
  col: number,
  patch: { formula?: string | null; value?: unknown } | null
): void {
  const sheetName = engine.sheetIdToName.get(sheetId);
  if (!sheetName) return;
  const sheetIdx = engine.hf.getSheetId(sheetName);
  if (sheetIdx === undefined) return;
  const content = patch === null ? null : patchToContent(patch);
  engine.hf.setCellContents({ sheet: sheetIdx, col, row }, content);
}

/**
 * Rebuild the engine from scratch. Called when structural / workbook ops
 * shift cells, since openpyxl-style index shifts are easier to model as a
 * full rebuild than as a flurry of `setCellContents` calls.
 */
export function rebuildEngine(
  engine: ExcelEngine | null,
  workbook: ExcelWorkbookDto,
  editorState: ExcelEditorState | null
): ExcelEngine {
  engine?.hf.destroy();
  return createExcelEngine(workbook, editorState);
}

/**
 * Read a cell's *computed* value. For formula cells this is the freshly
 * evaluated number / string / boolean. For literal cells it's just the
 * value back out, which is fine — the workspace can decide whether to
 * prefer it over the parsed `cell.value` (e.g. when the user has typed
 * a new value).
 *
 * `null` signals "engine doesn't have a value for that address" — the
 * caller falls back to the parsed cell.
 */
/**
 * Apply a diff between two `editorState.cells` snapshots — added /
 * removed / changed entries get pushed to the engine via
 * `setCellContents`. Returns `true` when any change was applied so the
 * caller can bump its generation counter and trigger a re-render.
 */
export function applyCellsDiffToEngine(
  engine: ExcelEngine,
  prev: Record<string, { formula?: string | null; value?: unknown }> | undefined,
  next: Record<string, { formula?: string | null; value?: unknown }> | undefined
): boolean {
  const before = prev ?? {};
  const after = next ?? {};
  let dirty = false;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (before[key] === after[key]) continue;
    const split = splitCellKey(key);
    if (!split) continue;
    syncCellInEngine(engine, split.sheetId, split.row, split.col, after[key] ?? null);
    dirty = true;
  }
  return dirty;
}

export function readEngineValue(
  engine: ExcelEngine,
  sheetId: string,
  row: number,
  col: number
): string | number | boolean | null {
  const sheetName = engine.sheetIdToName.get(sheetId);
  if (!sheetName) return null;
  const sheetIdx = engine.hf.getSheetId(sheetName);
  if (sheetIdx === undefined) return null;
  const address: SimpleCellAddress = { sheet: sheetIdx, col, row };
  const raw = engine.hf.getCellValue(address);
  return normalizeEngineValue(raw);
}

function normalizeEngineValue(value: CellValue): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  // DetailedCellError → render as the canonical Excel-style token so the
  // user sees `#DIV/0!`, `#REF!`, etc. directly in the cell.
  const detailed = value as DetailedCellError;
  if (detailed && typeof detailed === "object" && "value" in detailed) {
    return detailed.value;
  }
  return null;
}

function patchToContent(patch: { formula?: string | null; value?: unknown }): string | null {
  if ("formula" in patch && patch.formula) {
    return patch.formula.startsWith("=") ? patch.formula : `=${patch.formula}`;
  }
  return rawForEngine(patch.value);
}

function rawForEngine(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    // Bare leading "=" only counts as a formula when the user explicitly
    // marks it via the `formula` field; treat literal strings starting
    // with "=" as text by prefixing a quote (HF convention).
    return value.startsWith("=") ? `'${value}` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return String(value);
}

interface ParsedCellKey {
  sheetId: string;
  row: number;
  col: number;
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
