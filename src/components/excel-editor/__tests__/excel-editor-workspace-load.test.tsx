/**
 * Regression test for the Excel cold-open IPC path.
 *
 * Commit 32a2fd2 re-enabled parsedCache reads on cold open, which had
 * previously been removed because pulling the ~18 MB parsed-workbook JSON
 * back over IPC + parsing it on the main thread cost ~1 s — directly
 * competing with the 3.8 s openpyxl call it tried to skip. The fix is to
 * read editor state only on cold open; explicit `writeExcelParsedCache`
 * writes remain available for callers that want to prime the cache.
 *
 * This test mounts the workspace against a fake storage adapter that
 * exposes BOTH `readExcelEditorState` and `readExcelDocState`, asserts the
 * cold open touched only the editor-only path, and asserts the post-parse
 * codepath still fires the cache-prime write.
 */

import React from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` is hoisted to the top of the file, so any spy the factories
// reference must be created via `vi.hoisted` to share the same hoist phase.
const spies = vi.hoisted(() => {
  return {
    readExcelEditorState: vi.fn(async () => null),
    readExcelDocState: vi.fn(async () => null),
    writeExcelParsedCache: vi.fn(async () => undefined),
    writeExcelEditorState: vi.fn(async () => undefined),
    readBinary: vi.fn(async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04])),
    statBinary: vi.fn(async () => ({
      mtimeNs: "1700000000000000000",
      size: 4,
    })),
    fetchExcelWorkbook: vi.fn(async () => ({
      version: 1 as const,
      sheets: [
        {
          id: "sheet-1",
          name: "Sheet1",
          index: 0,
          rowCount: 10,
          colCount: 10,
          rowHeights: {},
          colWidths: {},
          merges: [],
          frozen: { row: 0, col: 0 },
          cells: [],
        },
      ],
      truncated: { sheets: false, rowsBy: {}, colsBy: {} },
    })),
  };
});

// Heavy children — mocked so the test isolates the data-loading path
// rather than the entire grid/toolbar surface. We keep every original
// export and only override the React component to a thin stub via
// `importOriginal`. The toolbar buttons, color picker, sheet view, etc.
// don't matter for what we're asserting; the data-loading effect runs
// regardless of what they render.
vi.mock("@/components/excel-editor/excel-sheet-view", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/excel-editor/excel-sheet-view")>();
  return {
    ...actual,
    ExcelSheetView: () => <div data-testid="excel-sheet-view" />,
  };
});

// Mock the storage layer. The component calls `createStorageAdapter()` to
// obtain its adapter, so we control the entire IO surface through the
// returned fake.
vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  const fakeAdapter = {
    mode: "disk" as const,
    list: vi.fn(async () => []),
    read: vi.fn(),
    write: vi.fn(),
    readBinary: spies.readBinary,
    statBinary: spies.statBinary,
    readExcelEditorState: spies.readExcelEditorState,
    readExcelDocState: spies.readExcelDocState,
    writeExcelEditorState: spies.writeExcelEditorState,
    writeExcelParsedCache: spies.writeExcelParsedCache,
    create: vi.fn(),
    rename: vi.fn(),
    move: vi.fn(),
    delete: vi.fn(),
  };
  return {
    ...actual,
    createStorageAdapter: () => fakeAdapter,
  };
});

// Mock the openpyxl-backed parse so the test doesn't hit the network.
vi.mock("@/lib/excel/parse-workbook", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/excel/parse-workbook")>(
      "@/lib/excel/parse-workbook"
    );
  return {
    ...actual,
    fetchExcelWorkbook: spies.fetchExcelWorkbook,
  };
});

// File store is consulted for `rootPath`; provide a thin stub so the
// `createStorageAdapter` selector argument doesn't blow up on undefined.
vi.mock("@/stores/file-store", async () => {
  const actual = await vi.importActual<typeof import("@/stores/file-store")>(
    "@/stores/file-store"
  );
  return {
    ...actual,
    useFileStore: (selector?: (state: { rootPath: string }) => unknown) => {
      const state = { rootPath: "/tmp/test-workspace" };
      return selector ? selector(state) : state;
    },
  };
});

// Defer the workspace import so the mocks above are installed before the
// component reads its dependencies at module load.
import { ExcelEditorWorkspace } from "@/components/excel-editor/excel-editor-workspace";
import type { FileItem } from "@/types";

function makeFile(overrides: Partial<FileItem> = {}): FileItem {
  return {
    id: `excel-${Math.random().toString(36).slice(2)}`,
    name: "test.xlsx",
    content: "",
    storageHandle: { kind: "disk", path: "/tmp/test-workspace/test.xlsx" } as never,
    documentType: "excel",
    isFolder: false,
    parentId: null,
    position: 0,
    isFavorite: false,
    icon: null,
    coverImageUrl: null,
    coverPosition: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    wordCount: 0,
    preview: "",
    ...overrides,
  };
}

describe("ExcelEditorWorkspace cold-open IPC path", () => {
  beforeEach(() => {
    spies.readExcelEditorState.mockClear();
    spies.readExcelDocState.mockClear();
    spies.writeExcelParsedCache.mockClear();
    spies.readBinary.mockClear();
    spies.statBinary.mockClear();
    spies.fetchExcelWorkbook.mockClear();
  });

  it("cold_open_reads_editor_only_not_parsed_cache", async () => {
    // Unique fileId so the module-level switch cache is guaranteed cold.
    const file = makeFile({ id: `cold-open-${Date.now()}-${Math.random()}` });

    render(<ExcelEditorWorkspace file={file} />);

    // The cold-open Promise.all + sha256Hex + post-parse write fire
    // asynchronously inside an IIFE; wait for `fetchExcelWorkbook` to land
    // before asserting on the surrounding calls.
    await waitFor(() => {
      expect(spies.fetchExcelWorkbook).toHaveBeenCalledTimes(1);
    });

    // Editor-only sidecar read happened.
    expect(spies.readExcelEditorState).toHaveBeenCalledTimes(1);

    // The full doc-state read (which would pull the ~18 MB parsedCache
    // back over IPC) did NOT happen — that's the regression we're
    // guarding against.
    expect(spies.readExcelDocState).not.toHaveBeenCalled();

    // Cold open went through binary parse; parsedCache shortcut was not
    // taken on the read side.
    expect(spies.readBinary).toHaveBeenCalledTimes(1);

    // Post-parse cache priming fires fire-and-forget. Wait for it
    // separately because the void chain resolves a microtask after the
    // visible workbook setState.
    await waitFor(() => {
      expect(spies.writeExcelParsedCache).toHaveBeenCalledTimes(1);
    });
    const call = spies.writeExcelParsedCache.mock.calls[0] as unknown[];
    const sourceHashArg = call[1];
    const parsedArg = call[2];
    expect(typeof sourceHashArg).toBe("string");
    expect(sourceHashArg).toMatch(/^[0-9a-f]{64}$/);
    expect(parsedArg).toMatchObject({ version: 1 });
  });
});
