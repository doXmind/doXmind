/**
 * Conditional formatting evaluator. Pure functions: given a list of rules
 * (already filtered to a single sheet) plus per-cell context, returns the
 * style to overlay on top of the static cell style.
 *
 * Rule resolution order: the *last matching rule* wins, mirroring the way
 * Excel layers later rules on top of earlier ones in the manage-rules
 * dialog. Color-scale rules are evaluated alongside discrete rules; if a
 * color-scale matches it always supplies `background`.
 */

import type {
  ExcelCellStyle,
  ExcelConditionalFormatCondition,
  ExcelConditionalFormatRule,
} from "@/lib/storage/types";

export interface ConditionalFormatInput {
  row: number;
  col: number;
  /** The cell's resolved value. Strings are matched as-is; numbers go
   *  through the numeric branch. `null`/`undefined` is treated as blank. */
  value: unknown;
  /** Pre-computed display string — passed in so the evaluator doesn't
   *  duplicate `formatCellValue`'s logic. Used for `containsText`. */
  display: string;
  /** Per-rule cache of all values inside the rule's range, used for
   *  duplicate / unique / colorScale rules. Built lazily and shared across
   *  cells in the same sheet render. */
  rangeValuesByRuleId: Map<string, RangeStats>;
}

export interface RangeStats {
  /** All non-blank display strings in the range — for duplicate / unique. */
  displays: string[];
  /** Numeric values only — for colorScale. */
  numbers: number[];
  min: number;
  max: number;
  /** Frequency map for duplicate / unique tests. */
  displayCounts: Map<string, number>;
}

export type CFOverlay = Pick<
  ExcelCellStyle,
  "bold" | "italic" | "underline" | "strikethrough" | "color" | "background"
>;

export function evaluateConditionalFormat(
  rules: ExcelConditionalFormatRule[] | undefined,
  input: ConditionalFormatInput
): CFOverlay | null {
  if (!rules || rules.length === 0) return null;
  let overlay: CFOverlay | null = null;
  for (const rule of rules) {
    if (!isInRange(input.row, input.col, rule)) continue;
    if (!matchesCondition(rule.condition, input, rule.id)) continue;

    if (rule.condition.kind === "colorScale") {
      const stats = input.rangeValuesByRuleId.get(rule.id);
      const color = computeColorScaleColor(rule.condition, input.value, stats);
      if (color) overlay = { ...(overlay ?? {}), background: color };
      continue;
    }
    if (rule.style) overlay = { ...(overlay ?? {}), ...rule.style };
  }
  return overlay;
}

function isInRange(row: number, col: number, rule: ExcelConditionalFormatRule): boolean {
  const { top, bottom, left, right } = rule.range;
  return row >= top && row <= bottom && col >= left && col <= right;
}

function matchesCondition(
  cond: ExcelConditionalFormatCondition,
  input: ConditionalFormatInput,
  ruleId: string
): boolean {
  const { value, display } = input;
  switch (cond.kind) {
    case "blank":
      return display.trim() === "";
    case "notBlank":
      return display.trim() !== "";
    case "duplicate":
    case "unique": {
      const stats = input.rangeValuesByRuleId.get(ruleId);
      if (!stats) return false;
      const trimmed = display.trim();
      if (trimmed === "") return false;
      const count = stats.displayCounts.get(display) ?? 0;
      return cond.kind === "duplicate" ? count > 1 : count === 1;
    }
    case "containsText": {
      const haystackRaw = display;
      const needleRaw = cond.text;
      if (needleRaw === "") return false;
      const haystack = cond.caseSensitive ? haystackRaw : haystackRaw.toLowerCase();
      const needle = cond.caseSensitive ? needleRaw : needleRaw.toLowerCase();
      switch (cond.mode) {
        case "contains":
          return haystack.includes(needle);
        case "notContains":
          return !haystack.includes(needle);
        case "startsWith":
          return haystack.startsWith(needle);
        case "endsWith":
          return haystack.endsWith(needle);
      }
      return false;
    }
    case "between": {
      const num = toNumeric(value, display);
      if (num === null) return false;
      const lo = Math.min(cond.min, cond.max);
      const hi = Math.max(cond.min, cond.max);
      return cond.inclusive === false ? num > lo && num < hi : num >= lo && num <= hi;
    }
    case "cellValue": {
      // Numeric vs string comparison: if both rule.value and the cell
      // are numeric, compare as numbers; otherwise fall back to string
      // ordering (matches Excel's "Cell value > 'a'" behavior).
      const ruleNum = typeof cond.value === "number" ? cond.value : Number(cond.value);
      const cellNum = toNumeric(value, display);
      const useNumeric =
        Number.isFinite(ruleNum) &&
        cellNum !== null &&
        (typeof cond.value !== "string" || cond.value.trim() !== "");
      if (useNumeric) {
        return numericCompare(cellNum, cond.op, ruleNum);
      }
      const a = display;
      const b = String(cond.value);
      return stringCompare(a, cond.op, b);
    }
    case "colorScale":
      // Always "matches" — the gradient handles ordering. Cells outside
      // the numeric domain just don't get a color (handled in
      // computeColorScaleColor).
      return true;
  }
}

function toNumeric(value: unknown, display: string): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const v = Number(value);
    if (Number.isFinite(v)) return v;
  }
  // Last-resort: try the display string (handles formatted numbers).
  const stripped = display.replace(/[$,%\s]/g, "");
  const v = Number(stripped);
  return Number.isFinite(v) ? v : null;
}

function numericCompare(a: number, op: string, b: number): boolean {
  switch (op) {
    case "gt":
      return a > b;
    case "lt":
      return a < b;
    case "gte":
      return a >= b;
    case "lte":
      return a <= b;
    case "eq":
      return a === b;
    case "neq":
      return a !== b;
  }
  return false;
}

function stringCompare(a: string, op: string, b: string): boolean {
  switch (op) {
    case "eq":
      return a === b;
    case "neq":
      return a !== b;
    case "gt":
      return a > b;
    case "lt":
      return a < b;
    case "gte":
      return a >= b;
    case "lte":
      return a <= b;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Range-stats cache — used by duplicate/unique/colorScale rules.
// ---------------------------------------------------------------------------

export function buildRangeStats(
  rules: ExcelConditionalFormatRule[],
  resolveValue: (row: number, col: number) => { value: unknown; display: string }
): Map<string, RangeStats> {
  const out = new Map<string, RangeStats>();
  for (const rule of rules) {
    const needsStats =
      rule.condition.kind === "duplicate" ||
      rule.condition.kind === "unique" ||
      rule.condition.kind === "colorScale";
    if (!needsStats) continue;

    const displays: string[] = [];
    const numbers: number[] = [];
    const counts = new Map<string, number>();
    for (let r = rule.range.top; r <= rule.range.bottom; r++) {
      for (let c = rule.range.left; c <= rule.range.right; c++) {
        const { value, display } = resolveValue(r, c);
        if (display.trim() !== "") {
          displays.push(display);
          counts.set(display, (counts.get(display) ?? 0) + 1);
        }
        const num = toNumeric(value, display);
        if (num !== null) numbers.push(num);
      }
    }
    out.set(rule.id, {
      displays,
      numbers,
      min: numbers.length ? Math.min(...numbers) : 0,
      max: numbers.length ? Math.max(...numbers) : 0,
      displayCounts: counts,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Color scale interpolation
// ---------------------------------------------------------------------------

function computeColorScaleColor(
  cond: Extract<ExcelConditionalFormatCondition, { kind: "colorScale" }>,
  value: unknown,
  stats: RangeStats | undefined
): string | null {
  if (!stats || stats.numbers.length === 0) return null;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return null;

  const minVal = cond.min.value ?? stats.min;
  const maxVal = cond.max.value ?? stats.max;
  if (minVal === maxVal) return cond.min.color;
  const t = clamp01((num - minVal) / (maxVal - minVal));

  if (cond.mid) {
    const midVal = cond.mid.value ?? (minVal + maxVal) / 2;
    const midT = clamp01((midVal - minVal) / (maxVal - minVal));
    if (t < midT) {
      return lerpColor(cond.min.color, cond.mid.color, t / Math.max(midT, 1e-9));
    }
    return lerpColor(cond.mid.color, cond.max.color, (t - midT) / Math.max(1 - midT, 1e-9));
  }
  return lerpColor(cond.min.color, cond.max.color, t);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function lerpColor(aHex: string, bHex: string, t: number): string {
  const a = parseHex(aHex);
  const b = parseHex(bHex);
  if (!a || !b) return aHex;
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`;
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return { r, g, b };
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
}
