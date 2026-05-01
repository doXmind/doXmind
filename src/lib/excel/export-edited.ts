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
  const blob = new Blob([new Uint8Array(bytes)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const formData = new FormData();
  formData.append("file", blob, filename);
  formData.append("edits", JSON.stringify(toExportPayload(state)));

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

function toExportPayload(state: ExcelEditorState): {
  cells: Record<string, { value?: unknown; formula?: string | null; numberFormat?: string }>;
  rowHeights?: Record<string, number>;
  colWidths?: Record<string, number>;
} {
  return {
    cells: state.cells ?? {},
    rowHeights: state.rowHeights,
    colWidths: state.colWidths,
  };
}
