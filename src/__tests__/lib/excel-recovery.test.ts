import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildExcelRecoveryPayload,
  exportEditedWorkbook,
  exportEditedWorkbookLegacy,
} from "@/lib/excel/export-edited";
import type { ExcelEditorState } from "@/lib/storage/types";

describe("Excel attachment recovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses recovery when a non-empty filter state cannot be exported safely", () => {
    expect(() =>
      buildExcelRecoveryPayload({
        version: 1,
        filters: { "sheet-0!0": ["Open"] },
      })
    ).toThrow(/filters/i);

    expect(() =>
      buildExcelRecoveryPayload({
        version: 1,
        filterMode: { "sheet-0": true },
      })
    ).toThrow(/filterMode/i);
  });

  it("passes every supported non-empty edit field to the strict exporter payload", () => {
    const state: ExcelEditorState = {
      version: 1,
      activeSheetId: "sheet-0",
      cells: {
        "sheet-0!0,0": {
          value: "Recovered",
          numberFormat: "0.00",
          style: { bold: true, background: "#ffeeaa" },
        },
      },
      rowHeights: { "sheet-0!0": 24 },
      colWidths: { "sheet-0!0": 120 },
      ops: [{ type: "insertRow", sheetId: "sheet-0", before: 1, count: 1 }],
      workbookOps: [{ type: "renameSheet", sheetId: "sheet-0", name: "Recovered" }],
      frozen: { "sheet-0": { row: 1, col: 1 } },
      validations: { "sheet-0!0,0": { type: "list", values: ["A", "B"] } },
      comments: { "sheet-0!0,0": { text: "Keep this", author: "Ada" } },
      conditionalFormats: {
        "sheet-0": [
          {
            id: "rule-1",
            range: { top: 0, left: 0, bottom: 2, right: 2 },
            condition: { kind: "cellValue", op: "gt", value: 10 },
            style: { bold: true },
          },
        ],
      },
    };

    expect(buildExcelRecoveryPayload(state)).toEqual(state);
  });

  it("normalizes a missing historical version to v1", () => {
    expect(
      buildExcelRecoveryPayload({
        cells: { "sheet-0!0,0": { value: "Recovered" } },
      } as unknown as ExcelEditorState)
    ).toEqual({
      version: 1,
      cells: { "sheet-0!0,0": { value: "Recovered" } },
    });
  });

  it("preserves malformed supported fields for the backend to reject", () => {
    expect(
      buildExcelRecoveryPayload({
        version: 1,
        cells: null,
      } as unknown as ExcelEditorState)
    ).toEqual({ version: 1, cells: null });

    expect(() =>
      buildExcelRecoveryPayload({
        version: 1,
        cells: {},
        futureEdits: { "sheet-0!0,0": "Recovered" },
      } as unknown as ExcelEditorState)
    ).toThrow(/unknown field futureEdits/i);
  });

  it("requests strict validation only for attachment recovery exports", async () => {
    const output = new Blob(["xlsx"]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(output),
    });
    vi.stubGlobal("fetch", fetchMock);

    await exportEditedWorkbook(
      new Uint8Array([1, 2, 3]),
      { version: 1, cells: { "sheet-0!0,0": { value: "Recovered" } } },
      "recovered.xlsx"
    );

    const recoveryBody = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(recoveryBody.get("strict_recovery")).toBe("true");

    await exportEditedWorkbookLegacy(
      new Uint8Array([1, 2, 3]),
      { version: 1, filters: { "sheet-0!0": ["Open"] } },
      "legacy.xlsx"
    );

    const legacyBody = fetchMock.mock.calls[1][1]?.body as FormData;
    expect(legacyBody.has("strict_recovery")).toBe(false);
    expect(JSON.parse(String(legacyBody.get("edits")))).toEqual({
      version: 1,
      filters: { "sheet-0!0": ["Open"] },
    });
  });
});
