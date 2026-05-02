/**
 * Best-effort Excel number-format interpreter.
 *
 * Excel format strings are a small DSL with conditional sections, locale
 * tokens, and dozens of edge cases. We deliberately don't attempt full
 * fidelity — only the patterns that show up in everyday spreadsheets:
 *
 *   - General / @ → fall through to JS toLocaleString (or value as-is)
 *   - 0 / 0.00 / #,##0 / #,##0.00 → fixed-decimal numeric formats
 *   - 0% / 0.00% → percent (multiplies by 100)
 *   - "$"#,##0.00 / [$$-409]#,##0.00 → currency with grouping
 *   - 0.00E+00 → scientific notation
 *   - yyyy-mm-dd / hh:mm / etc. → date / time (we already get strings from
 *     the openpyxl side, so no serial-date arithmetic is required here)
 *
 * Anything we can't parse falls back to `value.toString()`. The original
 * format string still travels with the cell to the backend, where openpyxl
 * applies it verbatim — Excel itself will render the cell correctly when
 * the user opens the exported file.
 */

export interface NumberFormatPreset {
  id: string;
  label: string;
  format: string;
  /** Short summary shown next to the label in the dropdown (e.g. "$#,##0.00"). */
  example?: string;
}

/** "More formats" menu — order roughly matches Google Sheets. */
export const NUMBER_FORMAT_PRESETS: NumberFormatPreset[] = [
  { id: "general", label: "Default", format: "General", example: "1,000.12" },
  { id: "plain", label: "Plain text", format: "@", example: "1000.12" },
  { id: "number", label: "Number", format: "#,##0.00", example: "1,000.12" },
  { id: "percent", label: "Percent", format: "0.00%", example: "10.12%" },
  { id: "scientific", label: "Scientific", format: "0.00E+00", example: "1.00E+03" },
  {
    id: "accounting",
    label: "Accounting",
    format: '_("$"* #,##0.00_);_("$"* (#,##0.00);_("$"* "-"??_);_(@_)',
    example: "$ (1,000.12)",
  },
  { id: "currency", label: "Currency", format: '"$"#,##0.00', example: "$1,000.12" },
  {
    id: "currency-rounded",
    label: "Currency (rounded)",
    format: '"$"#,##0',
    example: "$1,000",
  },
  { id: "date", label: "Date", format: "yyyy-mm-dd", example: "2026-05-01" },
  { id: "time", label: "Time", format: "hh:mm:ss", example: "15:04:05" },
  {
    id: "datetime",
    label: "Date time",
    format: "yyyy-mm-dd hh:mm:ss",
    example: "2026-05-01 15:04:05",
  },
];

const CURRENCY_FORMAT = '"$"#,##0.00';
const PERCENT_FORMAT = "0.00%";

/** Apply currency to the active selection — caller writes via updateCell. */
export const QUICK_CURRENCY_FORMAT = CURRENCY_FORMAT;
export const QUICK_PERCENT_FORMAT = PERCENT_FORMAT;

/**
 * Adjust the decimal-place count in a format string by `delta`. Falls back
 * to a sensible default ("0.00" / "0") when the existing format doesn't
 * follow the simple `0.00` template — covers ~95% of formats produced by
 * the toolbar without needing a full parser.
 */
export function adjustDecimals(current: string | undefined, delta: number): string {
  const format = current ?? "General";
  const isGeneral = format === "General" || format === "" || format === "@";

  // Detect the existing decimal block (the run of `0`s after `.` in the
  // *first* numeric placeholder section).
  const decimalMatch = format.match(/(?<!\\)\.(0+)/);
  const currentDecimals = decimalMatch ? decimalMatch[1].length : 0;
  const next = Math.max(0, currentDecimals + delta);

  if (isGeneral) {
    return next === 0 ? "0" : `0.${"0".repeat(next)}`;
  }

  if (decimalMatch) {
    if (next === 0) {
      // Drop the `.000…` block entirely.
      return format.replace(/(?<!\\)\.(0+)/, "");
    }
    return format.replace(/(?<!\\)\.(0+)/, `.${"0".repeat(next)}`);
  }

  // No decimal block — append one. Insert before any trailing `%` so percent
  // formats stay percentage-shaped.
  if (format.endsWith("%")) {
    const head = format.slice(0, -1);
    return next === 0 ? format : `${head}.${"0".repeat(next)}%`;
  }
  return next === 0 ? format : `${format}.${"0".repeat(next)}`;
}

/**
 * Render `value` through `format`. Best-effort: returns the format-aware
 * string when we recognise the pattern, otherwise falls back to a sensible
 * `toLocaleString` rendering so cells aren't blank.
 */
export function applyNumberFormat(value: unknown, format: string | undefined): string {
  if (value === null || value === undefined || value === "") return "";

  // Plain text — render as-is.
  if (format === "@") return String(value);

  // Booleans / strings without a numeric format → as-is.
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value !== "number") {
    return typeof value === "string" ? value : String(value);
  }

  if (!format || format === "General") {
    return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }

  // Date / time formats — we never reach here for numbers that *should*
  // render as a date because openpyxl already coerces them on the backend.
  // For safety, fall back to the numeric path when the value is numeric.
  // (Real serial-date conversion is a future hookup.)
  if (/[ymdhs]/.test(format) && /[0]/.test(format) === false) {
    return String(value);
  }

  const isPercent = format.includes("%");
  const decimals = countDecimals(format);
  const grouped = format.includes("#,##0") || format.includes("#,###");
  const negativeParens = /\(.*[#0].*\)/.test(format);

  const numeric = isPercent ? value * 100 : value;
  const absStr = formatNumber(Math.abs(numeric), decimals, grouped);

  // Pick out a currency symbol if the format declares one.
  const symbolMatch = format.match(/"([^"]+)"|\[\$([^\]-]+)(?:-[^\]]*)?\]|([$£€¥¢])/);
  const symbol = symbolMatch?.[1] ?? symbolMatch?.[2] ?? symbolMatch?.[3] ?? "";

  let body = `${symbol}${absStr}${isPercent ? "%" : ""}`;
  if (numeric < 0) {
    body = negativeParens ? `(${body})` : `-${body}`;
  }
  return body;
}

function countDecimals(format: string): number {
  const match = format.match(/(?<!\\)\.(0+)/);
  return match ? match[1].length : 0;
}

function formatNumber(value: number, decimals: number, grouped: boolean): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouped,
  });
}
