/**
 * Round-trip the user's sidecar edits through the FastAPI sidecar back into
 * a fresh `.xlsx` blob. Mirror of `lib/pdf/export-edited.ts`.
 *
 * The Python side (`services.excel_workbook.export_edited_workbook`) takes
 * the original workbook bytes plus a JSON edit payload and returns a new
 * binary so charts, conditional formatting, and other openpyxl-preserved
 * features survive even though they aren't represented in the JSON cell
 * model the renderer uses.
 */

import { apiUrl } from "@/lib/api/base";
import type { ExcelEditorState } from "@/lib/storage/types";

export async function exportEditedWorkbook(
  bytes: Uint8Array,
  state: ExcelEditorState,
  filename = "workbook.xlsx",
  signal?: AbortSignal
): Promise<Blob> {
  return requestEditedWorkbook(bytes, buildExcelRecoveryPayload(state), filename, true, signal);
}

/** Permissive compatibility path used only by the legacy Excel editor. */
export async function exportEditedWorkbookLegacy(
  bytes: Uint8Array,
  state: ExcelEditorState,
  filename = "workbook.xlsx",
  signal?: AbortSignal
): Promise<Blob> {
  return requestEditedWorkbook(bytes, state, filename, false, signal);
}

async function requestEditedWorkbook(
  bytes: Uint8Array,
  state: ExcelEditorState | ExcelRecoveryPayload,
  filename: string,
  strictRecovery: boolean,
  signal?: AbortSignal
): Promise<Blob> {
  const isCsv = /\.csv$/i.test(filename);
  const blob = new Blob([new Uint8Array(bytes)], {
    type: isCsv ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const formData = new FormData();
  formData.append("file", blob, filename);
  formData.append("edits", JSON.stringify(state));
  if (strictRecovery) {
    formData.append("strict_recovery", "true");
  }

  const response = await fetch(apiUrl("/api/excel/export-edited"), {
    method: "POST",
    body: formData,
    signal,
  });
  if (!response.ok) {
    let message = `export-edited failed (${response.status})`;
    try {
      const detail = (await response.json()) as { detail?: string; error?: { message?: string } };
      message = detail?.error?.message ?? detail?.detail ?? message;
    } catch {
      // server returned non-JSON; fall back to status message
    }
    throw new Error(message);
  }
  return await response.blob();
}

export interface ExcelRecoveryPayload {
  version: 1;
  activeSheetId?: string;
  cells: NonNullable<ExcelEditorState["cells"]>;
  rowHeights?: Record<string, number>;
  colWidths?: Record<string, number>;
  ops?: ExcelEditorState["ops"];
  workbookOps?: ExcelEditorState["workbookOps"];
  frozen?: ExcelEditorState["frozen"];
  validations?: ExcelEditorState["validations"];
  comments?: ExcelEditorState["comments"];
  conditionalFormats?: ExcelEditorState["conditionalFormats"];
}

export function buildExcelRecoveryPayload(state: ExcelEditorState): ExcelRecoveryPayload {
  const allowedFields = new Set([
    "version",
    "activeSheetId",
    "cells",
    "rowHeights",
    "colWidths",
    "ops",
    "workbookOps",
    "filters",
    "filterMode",
    "frozen",
    "validations",
    "comments",
    "conditionalFormats",
  ]);
  const raw = { ...(state as unknown as Record<string, unknown>) };
  const unknown = Object.keys(raw).find((key) => !allowedFields.has(key));
  if (unknown) {
    throw new Error(`Excel recovery cannot safely export unknown field ${unknown}`);
  }

  for (const field of ["filters", "filterMode"] as const) {
    if (!(field in raw)) continue;
    const value = raw[field];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Excel recovery cannot safely export malformed ${field}`);
    }
    if (Object.keys(value).length > 0) {
      throw new Error(`Excel recovery cannot safely export ${field}`);
    }
    delete raw[field];
  }

  if (!("version" in raw)) raw.version = 1;
  if (!("cells" in raw)) raw.cells = {};
  return raw as unknown as ExcelRecoveryPayload;
}
