/**
 * openpyxl-backed workbook client.
 *
 * Mirrors `lib/pdf/parse-blocks.ts`: the editor never touches the xlsx
 * binary directly. We POST the bytes to `/api/excel/parse-workbook` and
 * the FastAPI sidecar returns a JSON cell model the renderer can hydrate
 * straight into a Univer-compatible workbook (or our custom canvas grid).
 *
 * Schema mirrors `services.excel_workbook.parse_workbook` on the backend.
 */

import { apiUrl } from "@/lib/api/base";
import type { ExcelCellStyle } from "@/lib/storage/types";

export interface ExcelCellDto {
  row: number;
  col: number;
  value: string | number | boolean | null;
  formula: string | null;
  numberFormat?: string;
  style?: ExcelCellStyle;
}

export interface ExcelMergeRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface ExcelFrozenPanes {
  row: number;
  col: number;
}

export interface ExcelSheetDto {
  id: string;
  name: string;
  index: number;
  rowCount: number;
  colCount: number;
  rowHeights: Record<string, number>;
  colWidths: Record<string, number>;
  merges: ExcelMergeRange[];
  frozen: ExcelFrozenPanes;
  cells: ExcelCellDto[];
}

export interface ExcelWorkbookDto {
  version: 1;
  sheets: ExcelSheetDto[];
  truncated: {
    sheets: boolean;
    rowsBy: Record<string, boolean>;
    colsBy: Record<string, boolean>;
  };
}

export async function fetchExcelWorkbook(
  bytes: Uint8Array,
  filename = "workbook.xlsx",
  signal?: AbortSignal
): Promise<ExcelWorkbookDto> {
  const blob = new Blob([new Uint8Array(bytes)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const formData = new FormData();
  formData.append("file", blob, filename);

  const response = await fetch(apiUrl("/api/excel/parse-workbook"), {
    method: "POST",
    body: formData,
    signal,
  });
  if (!response.ok) {
    const detail = await safeReadJson(response);
    throw new Error(
      detail?.error?.message ?? detail?.detail ?? `parse-workbook failed (${response.status})`
    );
  }
  return (await response.json()) as ExcelWorkbookDto;
}

async function safeReadJson(response: Response): Promise<{
  detail?: string;
  error?: { message?: string };
} | null> {
  try {
    return (await response.json()) as { detail?: string; error?: { message?: string } };
  } catch {
    return null;
  }
}
