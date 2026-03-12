/**
 * CSV parsing utilities for database import.
 *
 * Uses PapaParse for robust parsing and provides auto-type-detection
 * heuristics for mapping CSV columns to database property types.
 */

import Papa from "papaparse";
import type { PropertyType, PropertyDef, RowProperties } from "./database-types";
import { SELECT_COLORS } from "./database-types";

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/.+/i;
const PHONE_RE = /^[+]?[\d\s().-]{7,}$/;
const BOOL_VALUES = new Set(["true", "false", "yes", "no", "0", "1"]);
const DATE_RE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/;

/**
 * Heuristically detect the best PropertyType for a column based on sample values.
 * Skips empty strings. Falls back to "text".
 */
export function detectColumnType(values: string[]): PropertyType {
  const nonEmpty = values.filter((v) => v.trim() !== "");
  if (nonEmpty.length === 0) return "text";

  // Sample up to 100 values for detection
  const sample = nonEmpty.slice(0, 100);

  // Check email
  if (sample.every((v) => EMAIL_RE.test(v.trim()))) return "email";
  // Check URL
  if (sample.every((v) => URL_RE.test(v.trim()))) return "url";
  // Check phone
  if (sample.every((v) => PHONE_RE.test(v.trim()))) return "phone";
  // Check boolean
  if (sample.every((v) => BOOL_VALUES.has(v.trim().toLowerCase()))) return "checkbox";
  // Check number
  if (sample.every((v) => !isNaN(Number(v.trim())) && v.trim() !== "")) return "number";
  // Check date
  if (sample.every((v) => DATE_RE.test(v.trim()) && !isNaN(Date.parse(v.trim())))) return "date";

  return "text";
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

export interface ParsedCSV {
  headers: string[];
  dataRows: string[][];
  detectedTypes: PropertyType[];
  totalRows: number;
}

const MAX_ROWS = 10_000;

/**
 * Parse a CSV file (or string) into headers, rows and detected types.
 * Returns a promise that resolves with the parsed data.
 */
export function parseCSVFile(file: File): Promise<ParsedCSV> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete(results) {
        const allRows = results.data as string[][];
        if (allRows.length === 0) {
          reject(new Error("CSV_EMPTY"));
          return;
        }

        const headers = allRows[0].map((h) => (h || "").trim() || "Column");
        let dataRows = allRows.slice(1);
        const totalRows = dataRows.length;

        if (totalRows > MAX_ROWS) {
          dataRows = dataRows.slice(0, MAX_ROWS);
        }

        // Detect types per column
        const detectedTypes: PropertyType[] = headers.map((_, colIdx) => {
          const colValues = dataRows.map((row) => row[colIdx] || "");
          return detectColumnType(colValues);
        });

        resolve({ headers, dataRows, detectedTypes, totalRows });
      },
      error(err) {
        reject(new Error(err.message || "CSV_PARSE_ERROR"));
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Convert parsed CSV to database creation payload
// ---------------------------------------------------------------------------

export interface CSVDatabasePayload {
  properties_schema: PropertyDef[];
  rows: { properties: RowProperties }[];
}

/**
 * Convert parsed CSV data into properties_schema + rows ready for the API.
 * typeOverrides lets the user change detected types per column index.
 */
export function csvToPayload(
  headers: string[],
  dataRows: string[][],
  types: PropertyType[],
  typeOverrides?: Record<number, PropertyType>
): CSVDatabasePayload {
  const finalTypes = types.map((t, i) => typeOverrides?.[i] ?? t);

  // Build properties schema
  const properties_schema: PropertyDef[] = headers.map((name, i) => {
    const propId = crypto.randomUUID();
    const prop: PropertyDef = {
      id: propId,
      name,
      type: finalTypes[i],
      position: i,
    };

    // For select types: collect unique values and create choices
    if (finalTypes[i] === "select" || finalTypes[i] === "multi_select") {
      const uniqueValues = new Set<string>();
      for (const row of dataRows) {
        const val = (row[i] || "").trim();
        if (val) {
          if (finalTypes[i] === "multi_select") {
            val.split(",").forEach((v) => {
              const trimmed = v.trim();
              if (trimmed) uniqueValues.add(trimmed);
            });
          } else {
            uniqueValues.add(val);
          }
        }
      }

      const choices = Array.from(uniqueValues).map((name, j) => ({
        id: crypto.randomUUID(),
        name,
        color: SELECT_COLORS[j % SELECT_COLORS.length],
      }));

      prop.options = { choices };
    }

    return prop;
  });

  // Build choice lookup maps for select types
  const choiceMaps = new Map<number, Map<string, string>>();
  properties_schema.forEach((prop, i) => {
    if (prop.options?.choices) {
      const map = new Map<string, string>();
      for (const c of prop.options.choices) {
        map.set(c.name, c.id);
      }
      choiceMaps.set(i, map);
    }
  });

  // Convert rows
  const rows = dataRows.map((rowData) => {
    const properties: RowProperties = {};
    headers.forEach((_, colIdx) => {
      const propId = properties_schema[colIdx].id;
      const raw = (rowData[colIdx] || "").trim();
      const type = finalTypes[colIdx];

      if (!raw) return;

      switch (type) {
        case "number":
          properties[propId] = Number(raw);
          break;
        case "checkbox":
          properties[propId] = ["true", "yes", "1"].includes(raw.toLowerCase());
          break;
        case "select": {
          const choiceMap = choiceMaps.get(colIdx);
          properties[propId] = choiceMap?.get(raw) ?? raw;
          break;
        }
        case "multi_select": {
          const choiceMap = choiceMaps.get(colIdx);
          properties[propId] = raw
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
            .map((v) => choiceMap?.get(v) ?? v);
          break;
        }
        default:
          properties[propId] = raw;
      }
    });
    return { properties };
  });

  return { properties_schema, rows };
}
