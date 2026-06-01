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
 * cold open touched only the editor-only path, and asserts the cold path
 * is write-free with respect to the sidecar — `writeExcelParsedCache` is
 * never called during open. The adapter method stays in the adapter
 * surface so explicit primers (outside the open path) can still use it,
 * but the open path itself neither reads nor writes parsedCache.
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` is hoisted to the top of the file, so any spy the factories
// reference must be created via `vi.hoisted` to share the same hoist phase.
const spies = vi.hoisted(() => {
  return {
    readExcelEditorState: vi.fn(
      async (): Promise<{ version: 1; activeSheetId?: string } | null> => null
    ),
    readExcelDocState: vi.fn(async () => null),
    writeExcelParsedCache: vi.fn(async () => undefined),
    writeExcelEditorState: vi.fn(async () => undefined),
    notifyError: vi.fn(),
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
        {
          id: "sheet-2",
          name: "Sheet2",
          index: 1,
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

// Mock the notification surface so we can assert read-only banner fires.
vi.mock("@/lib/notifications", () => ({
  notify: {
    error: spies.notifyError,
    promise: vi.fn(),
    startProgress: vi.fn(),
    updateProgress: vi.fn(),
    resolveProgress: vi.fn(),
    failProgress: vi.fn(),
    removeProgress: vi.fn(),
  },
}));

// Mock the openpyxl-backed parse so the test doesn't hit the network.
vi.mock("@/lib/excel/parse-workbook", async () => {
  const actual = await vi.importActual<typeof import("@/lib/excel/parse-workbook")>(
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
  const actual = await vi.importActual<typeof import("@/stores/file-store")>("@/stores/file-store");
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
    spies.writeExcelEditorState.mockClear();
    spies.notifyError.mockClear();
    spies.readBinary.mockClear();
    spies.statBinary.mockClear();
    spies.fetchExcelWorkbook.mockClear();
    spies.readExcelEditorState.mockImplementation(async () => null);
    spies.writeExcelEditorState.mockImplementation(async () => undefined);
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
    await screen.findByTestId("excel-sheet-view");

    // Editor-only sidecar read happened.
    expect(spies.readExcelEditorState).toHaveBeenCalledTimes(1);

    // The full doc-state read (which would pull the ~18 MB parsedCache
    // back over IPC) did NOT happen — that's the regression we're
    // guarding against.
    expect(spies.readExcelDocState).not.toHaveBeenCalled();

    // Cold open went through binary parse; parsedCache shortcut was not
    // taken on the read side.
    expect(spies.readBinary).toHaveBeenCalledTimes(1);

    // Cold open is write-free with respect to the sidecar: the open path
    // must not prime parsedCache on disk. The adapter method stays on the
    // surface for explicit primers outside this codepath. Wait one more
    // microtask cycle so any (incorrectly) deferred write would have
    // landed by the time we assert.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(spies.writeExcelParsedCache).not.toHaveBeenCalled();
  });

  it("cold_open_does_not_persist_sidecar_when_editor_state_was_never_user_modified", async () => {
    // Cold open with a missing sidecar (`readExcelEditorState` returns null).
    // The activeSheetId bookkeeping effect would otherwise mirror the
    // defaulted active sheet into editorState, tripping the debounced
    // sidecar writer ~350ms later — a write triggered by a read, in
    // violation of the Fix-3 "cold open is sidecar write-free" contract.
    // The guard suppresses that first mirror; a subsequent user-initiated
    // sheet switch must still persist.
    spies.readExcelEditorState.mockImplementationOnce(async () => null);
    const file = makeFile({ id: `cold-open-bookkeeping-${Date.now()}-${Math.random()}` });

    render(<ExcelEditorWorkspace file={file} />);

    await waitFor(() => {
      expect(spies.fetchExcelWorkbook).toHaveBeenCalledTimes(1);
    });

    // Sit past the 350ms debounce. Any spurious bookkeeping mirror would
    // have landed in writeExcelEditorState by now. We poll for a tick at
    // the end so any in-flight microtasks settle.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(spies.writeExcelEditorState).not.toHaveBeenCalled();

    // Now simulate a legitimate user action: click a different sheet tab.
    // The bookkeeping effect should fire on this transition (the hydration
    // guard is one-shot) and trigger a debounced write.
    const sheet2Tab = await screen.findByRole("button", { name: "Sheet2" });
    await act(async () => {
      fireEvent.click(sheet2Tab);
    });

    // Wait past the debounce again — this time we expect a write.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    await waitFor(() => {
      expect(spies.writeExcelEditorState).toHaveBeenCalledTimes(1);
    });
    const [, snapshot] = spies.writeExcelEditorState.mock.calls[0] as unknown as [
      unknown,
      { activeSheetId?: string },
    ];
    expect(snapshot.activeSheetId).toBe("sheet-2");
  });

  it("surfaces the read-only banner once when the sidecar rejects with the cross-runtime error", async () => {
    // Rust's `read_only_document_error()` returns this verbatim string when
    // DOXMIND_SIDECAR_MIGRATE=off opens a legacy sidecar. Make every
    // autosave reject with it — the workspace must show the banner exactly
    // once per file open, regardless of how many edits the user makes.
    spies.writeExcelEditorState.mockImplementation(async () => {
      throw new Error(
        "document at /tmp/test-workspace/.test.doxmind is read-only (DOXMIND_SIDECAR_MIGRATE=0 against legacy sidecar)"
      );
    });

    const file = makeFile({ id: `readonly-${Date.now()}-${Math.random()}` });
    render(<ExcelEditorWorkspace file={file} />);

    await waitFor(() => {
      expect(spies.fetchExcelWorkbook).toHaveBeenCalledTimes(1);
    });

    // Trigger an edit — clicking Sheet2 mirrors activeSheetId into
    // editorState, which fires the debounced autosave. The autosave
    // rejects; the workspace should call notify.error exactly once.
    const sheet2Tab = await screen.findByRole("button", { name: "Sheet2" });
    await act(async () => {
      fireEvent.click(sheet2Tab);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    await waitFor(() => {
      expect(spies.writeExcelEditorState).toHaveBeenCalledTimes(1);
    });
    expect(spies.notifyError).toHaveBeenCalledTimes(1);
    expect(spies.notifyError.mock.calls[0][0]).toMatch(/read-only/i);

    // Trigger a second edit — switch back to Sheet1. The autosave fires
    // again and rejects again, but the banner must NOT re-fire: per-file
    // `readOnlySurfacedRef` is now set.
    const sheet1Tab = await screen.findByRole("button", { name: "Sheet1" });
    await act(async () => {
      fireEvent.click(sheet1Tab);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    await waitFor(() => {
      expect(spies.writeExcelEditorState).toHaveBeenCalledTimes(2);
    });
    expect(spies.notifyError).toHaveBeenCalledTimes(1);
  });

  it("cold_open_with_stale_active_sheet_id_writes_correction", async () => {
    // Cold open with a sidecar whose activeSheetId points at a sheet that
    // no longer exists (renamed/deleted out-of-band). The activeSheet
    // resolver falls back to the first sheet, but if we suppress the
    // bookkeeping mirror write the stale id sits on disk forever — every
    // reopen re-runs the same fallback, and the next unrelated user edit's
    // autosave will persist the ghost id verbatim. The fix is to let the
    // mirror write through when the loaded sidecar's activeSheetId
    // diverges from the resolved sheet, so the next debounced flush
    // rewrites the sidecar with the correct id.
    spies.readExcelEditorState.mockImplementationOnce(async () => ({
      version: 1 as const,
      activeSheetId: "GhostSheet",
    }));
    const file = makeFile({ id: `cold-open-stale-${Date.now()}-${Math.random()}` });

    render(<ExcelEditorWorkspace file={file} />);

    await waitFor(() => {
      expect(spies.fetchExcelWorkbook).toHaveBeenCalledTimes(1);
    });

    // Sit past the 350ms debounce so the corrective write has a chance to
    // land.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });

    await waitFor(() => {
      expect(spies.writeExcelEditorState).toHaveBeenCalledTimes(1);
    });
    const [, snapshot] = spies.writeExcelEditorState.mock.calls[0] as unknown as [
      unknown,
      { activeSheetId?: string },
    ];
    // The persisted snapshot must hold the resolved first-sheet id, not
    // the ghost id from the stale sidecar.
    expect(snapshot.activeSheetId).toBe("sheet-1");
  });
});
