import { describe, expect, it } from "vitest";
import { buildLegacyAttachmentRecovery } from "@/lib/legacy-attachment-recovery";
import type { FileItem } from "@/types";

const file: FileItem = {
  id: "path:Research/Spec.pdf",
  name: "Spec",
  content: "",
  isFolder: false,
  parentId: null,
  position: 0,
  isFavorite: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  wordCount: 0,
  preview: "",
  documentType: "pdf",
  storageHandle: {
    mode: "disk",
    id: "path:Research/Spec.pdf",
    kind: "document",
    documentType: "pdf",
    path: "Research/Spec.pdf",
    relPath: "Research/Spec.pdf",
  },
};

describe("buildLegacyAttachmentRecovery", () => {
  it("exports the exact PDF editor state in a portable Markdown report", () => {
    const state = {
      version: 2 as const,
      paragraphEdits: {
        "p0-b3": {
          pageIndex: 0,
          text: "Recovered text",
          originalText: "Original text",
          bbox: { x: 1, y: 2, width: 100, height: 20 },
          fontSize: 12,
        },
      },
      highlights: [{ id: "highlight-1", pageIndex: 0, x: 1, y: 2, width: 3, height: 4 }],
    };

    const result = buildLegacyAttachmentRecovery(file, state, "2026-07-21T12:00:00.000Z");

    expect(result.fileName).toBe("Spec.pdf.doxmind-recovery.md");
    expect(result.markdown).toContain('source: "Research/Spec.pdf"');
    expect(result.markdown).toContain("document_type: pdf");
    expect(result.markdown).toContain('"text": "Recovered text"');
    expect(result.markdown).toContain('"id": "highlight-1"');

    const json = result.markdown.match(/```json\n([\s\S]+)\n```/)?.[1];
    expect(JSON.parse(json || "null")).toEqual(state);
  });

  it("keeps spreadsheet values, formulas, structure, and formatting losslessly", () => {
    const spreadsheet = {
      ...file,
      id: "path:Budget.xlsx",
      documentType: "excel" as const,
      storageHandle: {
        ...file.storageHandle!,
        id: "path:Budget.xlsx",
        documentType: "excel" as const,
        path: "Budget.xlsx",
        relPath: "Budget.xlsx",
      },
    };
    const state = {
      version: 1 as const,
      activeSheetId: "sheet-1",
      cells: {
        "sheet-1!1,2": {
          value: 42,
          formula: "=SUM(A1:A2)",
          style: { bold: true, background: "#ffeeaa" },
        },
      },
      ops: [{ type: "insertRow" as const, sheetId: "sheet-1", before: 1, count: 2 }],
    };

    const result = buildLegacyAttachmentRecovery(spreadsheet, state, "2026-07-21T12:00:00.000Z");
    const json = result.markdown.match(/```json\n([\s\S]+)\n```/)?.[1];

    expect(result.fileName).toBe("Budget.xlsx.doxmind-recovery.md");
    expect(JSON.parse(json || "null")).toEqual(state);
  });
});
