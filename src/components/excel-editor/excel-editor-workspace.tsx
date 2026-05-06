"use client";

/**
 * Excel editor workspace.
 *
 * Mirrors the high-level shape of `PdfEditorWorkspace`:
 *   1. Pull the workbook bytes via the storage adapter (`readBinary`).
 *   2. POST them to `/api/excel/parse-workbook` for the JSON cell model.
 *   3. Render our own grid (HTML, virtualised by `@tanstack/react-virtual`).
 *   4. Edits accumulate locally in `ExcelEditorState`, debounced to the
 *      `.doxmind` sidecar so the next reopen restores them.
 *   5. The unified header dispatches `doxmind:export-xlsx`; we round-trip
 *      the original bytes plus the edit payload through
 *      `/api/excel/export-edited` so styles, formulas, charts, structural
 *      ops, and other openpyxl-preserved features survive.
 *
 * Selection is a *range*, lifted to this component so the toolbar, formula
 * bar, and context menu all operate on the same cells. Structural ops
 * (insert / delete row + column) are appended to `editorState.ops`; the
 * frontend transforms existing edit keys eagerly so the renderer sees the
 * post-op coordinates and the backend can replay the same ops on openpyxl.
 *
 * Formula recalculation is deliberately not yet wired — user-edited values
 * surface immediately, but cells that depend on them via formulas keep
 * showing whatever cached value the source `.xlsx` had until a Univer-style
 * headless recalc engine is plugged in.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AlignCenter,
  AlignEndVertical,
  AlignLeft,
  AlignRight,
  AlignStartVertical,
  AlignVerticalJustifyCenter,
  ArrowDownAZ,
  ArrowUpAZ,
  Baseline,
  Bold,
  DollarSign,
  Eraser,
  Filter as FilterIcon,
  Italic,
  Link as LinkIcon,
  Loader2,
  Merge,
  MessageSquarePlus,
  PaintBucket,
  Paintbrush,
  Palette,
  Percent,
  Plus,
  Redo2,
  Sigma,
  Split,
  Strikethrough,
  Underline,
  Undo2,
  WrapText,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { notify } from "@/lib/notifications";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { exportEditedWorkbook } from "@/lib/excel/export-edited";
import {
  fetchExcelWorkbook,
  type ExcelCellDto,
  type ExcelSheetDto,
  type ExcelWorkbookDto,
} from "@/lib/excel/parse-workbook";
import {
  applyEditorStateOp,
  applyOpsToSheet,
  applyWorkbookOp,
  applyWorkbookOps,
  rangeBounds,
  rangeOrigin,
  singleCellRange,
  type EditAdvance,
  type EditingCell,
  type ExcelCellPatch,
  type SelectionRange,
} from "@/lib/excel/state";
import {
  applyCellsDiffToEngine,
  createExcelEngine,
  readEngineValue,
  type ExcelEngine,
} from "@/lib/excel/engine";
import { HyperFormula } from "hyperformula";
import { ExcelFormulaSuggest } from "@/components/excel-editor/excel-formula-suggest";
import {
  ExcelSheetView,
  columnLabel,
  coordKey,
  formatCellValue,
  formulaOrValueAsString,
  parseDraft,
} from "@/components/excel-editor/excel-sheet-view";
import {
  ExcelColorPicker,
  FILL_COLOR_SWATCHES,
  TEXT_COLOR_SWATCHES,
} from "@/components/excel-editor/excel-color-picker";
import { ExcelMenuButton } from "@/components/excel-editor/excel-menu-button";
import { ExcelFontFamilyButton } from "@/components/excel-editor/excel-font-family-button";
import {
  ExcelBordersButton,
  type BorderPattern,
} from "@/components/excel-editor/excel-borders-button";
import {
  ExcelFindReplacePanel,
  type FindMatch,
} from "@/components/excel-editor/excel-find-replace-panel";
import { ExcelFilterPopover } from "@/components/excel-editor/excel-filter-popover";
import {
  NUMBER_FORMAT_PRESETS,
  QUICK_CURRENCY_FORMAT,
  QUICK_PERCENT_FORMAT,
  adjustDecimals,
} from "@/lib/excel/format";
import { DEFAULT_BORDER_SIDE, computeBorderForCell } from "@/lib/excel/borders";
import {
  createStorageAdapter,
  type ExcelBorderConfig,
  type ExcelCellComment,
  type ExcelCellStyle,
  type ExcelConditionalFormatRule,
  type ExcelEditorState,
  type ExcelStructuralOp,
  type ExcelWorkbookOp,
} from "@/lib/storage";
import {
  buildRangeStats,
  evaluateConditionalFormat,
  type CFOverlay,
  type RangeStats,
} from "@/lib/excel/conditional-formats";
import { cn, sha256Hex } from "@/lib/utils";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { perfAsync, perfMeasure, perfSync } from "@/lib/perf";

// Module-level switch cache. The whole point of this layer is to dodge the
// 18+ MB JSON response from /api/excel/parse-workbook on a re-open. The
// backend parse cache (services/excel_workbook.py) cuts the parse itself to
// a few ms but the response is still serialised + transferred each time, so
// switching back to a 8 MB workbook still cost ~1.2 s end-to-end. Holding
// the parsed DTO and the source bytes in memory eliminates that.
//
// Key by fileId: doxmind doesn't reuse fileIds across files. If a user
// edits inside doxmind, only the sidecar editor state changes; the source
// .xlsx stays put on disk and the cached bytes/parsed DTO remain valid.
type ExcelSwitchCacheEntry = {
  bytes: Uint8Array;
  parsed: ExcelWorkbookDto;
  sourceHash: string;
};
const EXCEL_SWITCH_CACHE_MAX = 4;
const excelSwitchCache = new Map<string, ExcelSwitchCacheEntry>();

function excelSwitchCacheGet(fileId: string): ExcelSwitchCacheEntry | null {
  const entry = excelSwitchCache.get(fileId);
  if (entry) {
    excelSwitchCache.delete(fileId);
    excelSwitchCache.set(fileId, entry);
    return entry;
  }
  return null;
}

function excelSwitchCacheSet(fileId: string, entry: ExcelSwitchCacheEntry): void {
  excelSwitchCache.set(fileId, entry);
  while (excelSwitchCache.size > EXCEL_SWITCH_CACHE_MAX) {
    const firstKey = excelSwitchCache.keys().next().value;
    if (firstKey === undefined) break;
    excelSwitchCache.delete(firstKey);
  }
}

interface ExcelEditorWorkspaceProps {
  file: FileItem;
}

type ExcelTextDialogState = {
  type: "text";
  title: string;
  description?: string;
  defaultValue: string;
  placeholder?: string;
  confirmLabel?: string;
  resolve(value: string | null): void;
};

type ExcelConfirmDialogState = {
  type: "confirm";
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  resolve(value: boolean): void;
};

type ExcelDialogState = ExcelTextDialogState | ExcelConfirmDialogState;

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const SIDECAR_DEBOUNCE_MS = 350;
const HISTORY_LIMIT = 50;

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48] as const;
const DEFAULT_FONT_SIZE = 11;

/** All HyperFormula-registered function names — fetched once at module
 *  load. Used by formula autocomplete as the candidate pool. The list is
 *  language-scoped; we use the `enGB` locale that HF defaults to. */
const HF_FUNCTION_NAMES: string[] = (() => {
  try {
    const names = HyperFormula.getRegisteredFunctionNames("enGB");
    return [...names].sort();
  } catch {
    return [];
  }
})();

/** Walk back from `caret` over identifier characters to find where the
 *  current function-name token starts. Returns `caret` when there's no
 *  in-progress token. */
function findCurrentFnTokenStart(draft: string, caret: number): number {
  let i = Math.min(caret, draft.length);
  while (i > 0 && /[A-Za-z]/.test(draft[i - 1])) i--;
  return i;
}

function stepFontSize(current: number | undefined, delta: number): number {
  const target = current ?? DEFAULT_FONT_SIZE;
  if (delta > 0) {
    return FONT_SIZES.find((s) => s > target) ?? FONT_SIZES[FONT_SIZES.length - 1];
  }
  return [...FONT_SIZES].reverse().find((s) => s < target) ?? FONT_SIZES[0];
}

interface ContextMenuState {
  x: number;
  y: number;
  row: number;
  col: number;
  surface: "cell" | "row-header" | "col-header" | "corner";
}

interface CellUpdate {
  row: number;
  col: number;
  patch: ExcelCellPatch | null;
}

export function ExcelEditorWorkspace({ file }: ExcelEditorWorkspaceProps) {
  const rootPath = useFileStore((s) => s.rootPath);

  const adapter = useMemo(() => createStorageAdapter({ disk: { root: rootPath } }), [rootPath]);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [workbook, setWorkbook] = useState<ExcelWorkbookDto | null>(null);
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [editorState, setEditorState] = useState<ExcelEditorState | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [history, setHistory] = useState<ExcelEditorState[]>([]);
  const [future, setFuture] = useState<ExcelEditorState[]>([]);

  // Find & Replace state — kept here (not inside the panel) so the active
  // match drives the workspace selection while the panel stays focused.
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findReplace, setFindReplace] = useState("");
  const [findMatchCase, setFindMatchCase] = useState(false);
  const [findWholeCell, setFindWholeCell] = useState(false);
  const [findIndex, setFindIndex] = useState<number | null>(null);
  const [dialog, setDialog] = useState<ExcelDialogState | null>(null);

  // Right-click context menu over a sheet tab — separate from the main
  // grid context menu so the surface enums don't collide.
  const [tabContextMenu, setTabContextMenu] = useState<{
    x: number;
    y: number;
    sheetId: string;
  } | null>(null);

  // AutoFill drag state: `fillSource` snapshots the selection at the
  // moment the user mousedowns the bottom-right handle; `fillRange`
  // tracks the in-progress fill rectangle as the cursor moves over
  // cells. Both are cleared on mouseup (the fill commits then).
  const [fillSource, setFillSource] = useState<SelectionRange | null>(null);
  const [fillRange, setFillRange] = useState<SelectionRange | null>(null);
  const fillSourceRef = useRef<SelectionRange | null>(null);
  const fillRangeRef = useRef<SelectionRange | null>(null);
  useEffect(() => {
    fillSourceRef.current = fillSource;
  }, [fillSource]);
  useEffect(() => {
    fillRangeRef.current = fillRange;
  }, [fillRange]);

  // Open column-filter popover state. Anchored at the click position;
  // the workspace owns the value list so it can stay deduped + ordered
  // identically to what the user sees in the cells.
  const [filterPopover, setFilterPopover] = useState<{
    col: number;
    x: number;
    y: number;
  } | null>(null);

  // HyperFormula engine + a generation counter. The engine itself lives
  // in a ref (imperative API; we don't want to re-allocate on every
  // render). `engineGen` exists purely so the renderer can re-render
  // when computed values change — bump it after any mutation that
  // could ripple through formulas.
  const engineRef = useRef<ExcelEngine | null>(null);
  const lastEngineCellsRef = useRef<ExcelEditorState["cells"] | undefined>(undefined);
  const [engineGen, setEngineGen] = useState(0);

  const xlsxBytesRef = useRef<Uint8Array | null>(null);
  const editorStateRef = useRef<ExcelEditorState | null>(null);
  const editingRef = useRef<EditingCell | null>(null);
  const selectionRef = useRef<SelectionRange | null>(null);
  const cellGridRef = useRef<HTMLDivElement>(null);
  const cellInputRef = useRef<HTMLInputElement>(null);
  const formulaInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<ExcelDialogState | null>(null);

  useEffect(() => {
    editorStateRef.current = editorState;
  }, [editorState]);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    dialogRef.current = dialog;
  }, [dialog]);

  const requestTextDialog = useCallback(
    (options: {
      title: string;
      description?: string;
      defaultValue?: string;
      placeholder?: string;
      confirmLabel?: string;
    }) =>
      new Promise<string | null>((resolve) => {
        const current = dialogRef.current;
        if (current?.type === "text") current.resolve(null);
        else if (current?.type === "confirm") current.resolve(false);
        setDialog({
          type: "text",
          title: options.title,
          description: options.description,
          defaultValue: options.defaultValue ?? "",
          placeholder: options.placeholder,
          confirmLabel: options.confirmLabel,
          resolve,
        });
      }),
    []
  );

  const requestConfirmDialog = useCallback(
    (options: {
      title: string;
      description?: string;
      confirmLabel?: string;
      destructive?: boolean;
    }) =>
      new Promise<boolean>((resolve) => {
        const current = dialogRef.current;
        if (current?.type === "text") current.resolve(null);
        else if (current?.type === "confirm") current.resolve(false);
        setDialog({
          type: "confirm",
          title: options.title,
          description: options.description,
          confirmLabel: options.confirmLabel,
          destructive: options.destructive,
          resolve,
        });
      }),
    []
  );

  const closeDialog = useCallback((value: string | boolean | null) => {
    const current = dialogRef.current;
    if (!current) return;
    dialogRef.current = null;
    setDialog(null);
    if (current.type === "text") current.resolve(typeof value === "string" ? value : null);
    else current.resolve(value === true);
  }, []);

  // Format painter — armed style + ref for read inside `onSelectEnd`,
  // which runs from a window mouseup listener that captured the previous
  // closure.
  const [paintStyle, setPaintStyle] = useState<ExcelCellStyle | null>(null);
  const paintStyleRef = useRef<ExcelCellStyle | null>(null);
  useEffect(() => {
    paintStyleRef.current = paintStyle;
  }, [paintStyle]);

  // ---------------------------------------------------------------------
  // Initial load
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!file.storageHandle || !adapter.readBinary) {
      setStatus("error");
      setErrorMessage("Workbook is not stored on disk");
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const handle = file.storageHandle;
    setStatus("loading");
    setErrorMessage(null);
    setHistory([]);
    setFuture([]);

    (async () => {
      try {
        // Always read editor state only. We used to also pull a parsedCache
        // blob (the full ~18 MB parsed workbook DTO) hoping to skip openpyxl
        // on the next cold open with a matching hash. Two things made that
        // a net negative:
        //   1. The backend's process-local LRU (#3 in services/excel_workbook.py)
        //      already caches parse output for same-process re-opens.
        //   2. Reading the 18 MB JSON back over IPC + parsing it on the main
        //      thread cost ~1 s on every cold open — competing with the very
        //      thing it tried to save (3.8 s openpyxl).
        // The trade is: process-restart-then-reopen of an unmodified file now
        // re-runs openpyxl once. Switch-cache + backend LRU together cover
        // every other path, so the regression is bounded to that one slot.
        const readEditorOnly = () =>
          adapter.readExcelEditorState
            ? adapter.readExcelEditorState(handle).then(
                (editor) => ({ editor }),
                () => null
              )
            : adapter.readExcelDocState
              ? adapter.readExcelDocState(handle).then(
                  (state) => (state ? { editor: state.editor } : null),
                  () => null
                )
              : Promise.resolve(null);

        const switchCached = excelSwitchCacheGet(file.id);
        let bytes: Uint8Array;
        let parsed: ExcelWorkbookDto;
        let docState: Awaited<ReturnType<typeof readEditorOnly>>;
        if (switchCached) {
          perfSync("doxmind.excel.switchCacheHit", () => undefined, { fileId: file.id });
          docState = await perfAsync("doxmind.excel.readEditorOnly", () => readEditorOnly(), {
            fileId: file.id,
          });
          if (cancelled) return;
          bytes = switchCached.bytes;
          parsed = switchCached.parsed;
        } else {
          perfSync("doxmind.excel.switchCacheMiss", () => undefined, { fileId: file.id });
          // Cold path: binary read + editor-only sidecar read in parallel,
          // then openpyxl parse via the FastAPI sidecar (which has its own
          // process-local cache).
          const [readBytes, readDocState] = await perfAsync(
            "doxmind.excel.readBinaryAndSidecar",
            () => Promise.all([adapter.readBinary!(handle), readEditorOnly()])
          );
          if (cancelled) return;

          parsed = await perfAsync(
            "doxmind.excel.fetchWorkbook",
            () => fetchExcelWorkbook(readBytes, file.name, controller.signal),
            { bytes: readBytes.byteLength }
          );
          if (cancelled) return;

          const sourceHash = await sha256Hex(readBytes);
          if (cancelled) return;
          bytes = readBytes;
          docState = readDocState;
          excelSwitchCacheSet(file.id, { bytes, parsed, sourceHash });
        }

        xlsxBytesRef.current = bytes;
        const sidecar = docState?.editor ?? null;
        setWorkbook(parsed);
        setEditorState(sidecar);
        setActiveSheetId(sidecar?.activeSheetId ?? parsed.sheets[0]?.id ?? null);
        setSelection(singleCellRange(0, 0));
        setStatus("ready");
        // Close the firstPaint measure once and clear the start mark so it
        // doesn't get stamped repeatedly on subsequent re-renders.
        if (typeof window !== "undefined") {
          const w = window as unknown as Record<string, unknown>;
          const startMark = w.__doxmindSwitchStartMark as string | undefined;
          const fileIdAtStart = w.__doxmindSwitchFileId as string | undefined;
          if (startMark && fileIdAtStart) {
            perfMeasure("doxmind.switch.firstPaint", startMark, undefined, {
              fileId: fileIdAtStart,
              documentType: "excel",
            });
            w.__doxmindSwitchStartMark = undefined;
            w.__doxmindSwitchFileId = undefined;
          }
        }
        // The truncation is reflected in the visible sheet tabs; further
        // surfacing was a noisy success-class toast that the design no
        // longer carries.
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        const message = err instanceof Error ? err.message : "Failed to open workbook";
        setStatus("error");
        setErrorMessage(message);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [adapter, file.id, file.name, file.storageHandle]);

  // Display workbook = parsed workbook with workbook-level ops applied
  // (added / renamed / duplicated / deleted sheets). The tab strip and
  // sheet lookup all read from this so the user sees post-op state.
  const displayWorkbook = useMemo<ExcelWorkbookDto | null>(() => {
    if (!workbook) return null;
    return applyWorkbookOps(workbook, editorState?.workbookOps);
  }, [workbook, editorState?.workbookOps]);

  const activeSheet = useMemo<ExcelSheetDto | null>(() => {
    if (!displayWorkbook || !activeSheetId) return null;
    return (
      displayWorkbook.sheets.find((s) => s.id === activeSheetId) ??
      displayWorkbook.sheets[0] ??
      null
    );
  }, [displayWorkbook, activeSheetId]);

  // If the active sheet was deleted from under us, snap to the first
  // remaining sheet so the renderer doesn't show a stale empty state.
  useEffect(() => {
    if (!displayWorkbook) return;
    if (!activeSheetId) return;
    const exists = displayWorkbook.sheets.some((s) => s.id === activeSheetId);
    if (!exists && displayWorkbook.sheets[0]) {
      setActiveSheetId(displayWorkbook.sheets[0].id);
    }
  }, [displayWorkbook, activeSheetId]);

  // The sheet the renderer reads from = parsed sheet with structural ops
  // applied. Cells, merges, row/col counts and dimension overrides all
  // already use post-op coordinates.
  const displaySheet = useMemo<ExcelSheetDto | null>(() => {
    if (!activeSheet) return null;
    const opped = applyOpsToSheet(activeSheet, editorState?.ops);
    // Merge user-set row/col size overrides on top of the parsed
    // dimensions so the renderer reads a single source of truth. The
    // sidecar key shape is `${sheetId}!${index}`; the displaySheet's
    // `colWidths` / `rowHeights` are unprefixed (just `${index}`).
    const prefix = `${opped.id}!`;
    let colWidths = opped.colWidths;
    if (editorState?.colWidths) {
      colWidths = { ...opped.colWidths };
      for (const [key, value] of Object.entries(editorState.colWidths)) {
        if (!key.startsWith(prefix)) continue;
        colWidths[key.slice(prefix.length)] = value;
      }
    }
    let rowHeights = opped.rowHeights;
    if (editorState?.rowHeights) {
      rowHeights = { ...opped.rowHeights };
      for (const [key, value] of Object.entries(editorState.rowHeights)) {
        if (!key.startsWith(prefix)) continue;
        rowHeights[key.slice(prefix.length)] = value;
      }
    }
    return { ...opped, colWidths, rowHeights };
  }, [activeSheet, editorState?.ops, editorState?.colWidths, editorState?.rowHeights]);

  // ---------------------------------------------------------------------
  // Formula recalc engine (HyperFormula)
  //
  // Full rebuild on workbook structure changes (sheet add/rename/etc.,
  // row/col insert/delete) — those reshape the dependency graph in
  // ways the incremental API can't always model. For plain cell edits
  // we diff `editorState.cells` and push the deltas via `setCellContents`,
  // which keeps recalc cost proportional to what actually changed.
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!displayWorkbook) {
      engineRef.current?.hf.destroy();
      engineRef.current = null;
      lastEngineCellsRef.current = undefined;
      return;
    }
    // Defer the HyperFormula build past first paint. createExcelEngine is
    // O(cells_with_values) synchronous (~50µs/cell on medium fixtures, ie.
    // 50k cells ≈ 2.5s of main-thread work). Until the engine is ready,
    // `computedValueAt` returns null and the renderer falls back to
    // `cell.value` — the openpyxl data_only cached result — which is what
    // the user saw in their last save anyway. The first edit they make
    // will land in editorState.cells; when the deferred build picks up,
    // it includes that patch via the existing editorStateRef threading.
    let cancelled = false;
    let committed: ExcelEngine | null = null;
    const handle = setTimeout(() => {
      if (cancelled) return;
      const engine = perfSync(
        "doxmind.excel.createEngine",
        () => createExcelEngine(displayWorkbook, editorStateRef.current),
        { sheetCount: displayWorkbook.sheets.length }
      );
      if (cancelled) {
        engine.hf.destroy();
        return;
      }
      engineRef.current?.hf.destroy();
      engineRef.current = engine;
      committed = engine;
      lastEngineCellsRef.current = editorStateRef.current?.cells;
      setEngineGen((g) => g + 1);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
      if (committed) {
        committed.hf.destroy();
        if (engineRef.current === committed) engineRef.current = null;
      }
    };
    // We intentionally don't depend on `editorState` here — the
    // incremental sync below handles cell-value updates without
    // re-allocating the whole engine.
  }, [displayWorkbook, editorState?.ops, editorState?.workbookOps]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const dirty = applyCellsDiffToEngine(engine, lastEngineCellsRef.current, editorState?.cells);
    lastEngineCellsRef.current = editorState?.cells;
    if (dirty) setEngineGen((g) => g + 1);
  }, [editorState?.cells]);

  /**
   * Look up the *computed* value of a cell at (row, col) on the active
   * sheet. Returns `null` when the engine isn't ready or the address is
   * out of range — callers fall back to the parsed cell value.
   *
   * The renderer reads through this for every cell so formulas always
   * show their current result, not openpyxl's parse-time cache.
   */
  const computedValueAt = useCallback(
    (row: number, col: number): string | number | boolean | null => {
      const engine = engineRef.current;
      if (!engine || !displaySheet) return null;
      // `engineGen` is read here purely to register a dependency for
      // memoization — it isn't used in the lookup itself.
      void engineGen;
      return readEngineValue(engine, displaySheet.id, row, col);
    },
    [displaySheet, engineGen]
  );

  const mutateEditorState = useCallback(
    (updater: (prev: ExcelEditorState | null) => ExcelEditorState) => {
      const previous = editorStateRef.current;
      const next = updater(previous);
      if (next === previous) return;
      const baseline: ExcelEditorState = previous ?? { version: 1 };
      setHistory((h) => {
        const trimmed = h.length >= HISTORY_LIMIT ? h.slice(h.length - HISTORY_LIMIT + 1) : h;
        return [...trimmed, baseline];
      });
      setFuture([]);
      setEditorState(next);
    },
    []
  );

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const previous = h[h.length - 1];
      const current = editorStateRef.current ?? { version: 1 };
      setFuture((f) => [...f, current]);
      setEditorState(previous);
      return h.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[f.length - 1];
      const current = editorStateRef.current ?? { version: 1 };
      setHistory((h) => {
        const trimmed = h.length >= HISTORY_LIMIT ? h.slice(h.length - HISTORY_LIMIT + 1) : h;
        return [...trimmed, current];
      });
      setEditorState(next);
      return f.slice(0, -1);
    });
  }, []);

  // Debounced sidecar persistence — collapses bursts of edits into a single
  // disk write so we don't hammer the filesystem on every keystroke.
  useEffect(() => {
    if (!editorState || !file.storageHandle || !adapter.writeExcelEditorState) return;
    const handle = file.storageHandle;
    const snapshot = editorState;
    const timeout = window.setTimeout(() => {
      adapter.writeExcelEditorState!(handle, snapshot).catch((err) => {
        console.error("[ExcelEditor] failed to persist sidecar", err);
      });
    }, SIDECAR_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [editorState, adapter, file.storageHandle]);

  // Bookkeeping mutation: mirror activeSheetId without polluting undo.
  useEffect(() => {
    if (!activeSheet) return;
    setEditorState((prev) => {
      const base: ExcelEditorState = prev ?? { version: 1 };
      if (base.activeSheetId === activeSheet.id) return prev;
      return { ...base, version: 1, activeSheetId: activeSheet.id };
    });
  }, [activeSheet]);

  // Reset selection / editing when switching sheets so we don't leave a
  // stale highlight.
  useEffect(() => {
    if (!activeSheet) return;
    setSelection(singleCellRange(0, 0));
    setEditing(null);
    setContextMenu(null);
  }, [activeSheet?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------
  // Derived maps
  // ---------------------------------------------------------------------

  const cellsByCoord = useMemo(() => {
    const map = new Map<string, ExcelCellDto>();
    if (!displaySheet) return map;
    for (const cell of displaySheet.cells) {
      map.set(coordKey(cell.row, cell.col), cell);
    }
    return map;
  }, [displaySheet]);

  // Per-cell merge classification used by the renderer:
  //   - `anchors`: top-left of a merge → spans down to {bottom, right}
  //   - `members`: cells inside a merge that are *not* the anchor (the
  //     renderer skips them so the anchor cell can paint over them)
  const mergeIndex = useMemo(() => {
    const anchors = new Map<string, { bottom: number; right: number }>();
    const members = new Set<string>();
    if (!displaySheet) return { anchors, members };
    for (const m of displaySheet.merges) {
      anchors.set(coordKey(m.top, m.left), { bottom: m.bottom, right: m.right });
      for (let r = m.top; r <= m.bottom; r++) {
        for (let c = m.left; c <= m.right; c++) {
          if (r === m.top && c === m.left) continue;
          members.add(coordKey(r, c));
        }
      }
    }
    return { anchors, members };
  }, [displaySheet]);

  const editsByCoord = useMemo(() => {
    const map = new Map<string, ExcelCellPatch>();
    if (!editorState?.cells || !displaySheet) return map;
    const prefix = `${displaySheet.id}!`;
    for (const [key, patch] of Object.entries(editorState.cells)) {
      if (!key.startsWith(prefix)) continue;
      const [rowStr, colStr] = key.slice(prefix.length).split(",");
      map.set(coordKey(Number(rowStr), Number(colStr)), patch);
    }
    return map;
  }, [editorState?.cells, displaySheet]);

  const anchor = useMemo(() => (selection ? rangeOrigin(selection) : null), [selection]);

  const effectiveStyleForAnchor = useMemo<ExcelCellStyle | undefined>(() => {
    if (!anchor) return undefined;
    const cell = cellsByCoord.get(coordKey(anchor.row, anchor.col));
    const patch = editsByCoord.get(coordKey(anchor.row, anchor.col));
    return mergeStyle(cell?.style, patch?.style);
  }, [anchor, cellsByCoord, editsByCoord]);

  const formulaBarValue = useMemo(() => {
    if (editing) return editing.draft;
    if (!anchor) return "";
    const cell = cellsByCoord.get(coordKey(anchor.row, anchor.col));
    const patch = editsByCoord.get(coordKey(anchor.row, anchor.col));
    return formulaOrValueAsString(patch ?? cell);
  }, [editing, anchor, cellsByCoord, editsByCoord]);

  // ---------------------------------------------------------------------
  // Cell-batch mutations
  // ---------------------------------------------------------------------

  const applyCellUpdates = useCallback(
    (updates: CellUpdate[]) => {
      if (!displaySheet || updates.length === 0) return;
      mutateEditorState((prev) => {
        const base: ExcelEditorState = prev ?? { version: 1 };
        const cells = { ...(base.cells ?? {}) };
        for (const update of updates) {
          const key = `${displaySheet.id}!${update.row},${update.col}`;
          if (update.patch === null) {
            delete cells[key];
            continue;
          }
          const existing = cells[key];
          if (update.patch.style && existing?.style) {
            cells[key] = {
              ...existing,
              ...update.patch,
              style: { ...existing.style, ...update.patch.style },
            };
          } else {
            cells[key] = { ...(existing ?? {}), ...update.patch };
          }
        }
        return { ...base, version: 1, cells };
      });
    },
    [displaySheet, mutateEditorState]
  );

  const applyOp = useCallback(
    (op: ExcelStructuralOp) => {
      mutateEditorState((prev) => applyEditorStateOp(prev, op));
    },
    [mutateEditorState]
  );

  const applyWorkbookOpAndPersist = useCallback(
    (op: ExcelWorkbookOp) => {
      mutateEditorState((prev) => applyWorkbookOp(prev, op));
    },
    [mutateEditorState]
  );

  // Column / row size overrides persist on the sidecar so the next reopen
  // restores the user's layout. Units mirror what openpyxl writes to disk:
  // `colWidths` is in Excel character units, `rowHeights` is in points.
  const setColumnWidth = useCallback(
    (col: number, charUnits: number) => {
      if (!displaySheet) return;
      const key = `${displaySheet.id}!${col}`;
      mutateEditorState((prev) => {
        const base: ExcelEditorState = prev ?? { version: 1 };
        const next = { ...(base.colWidths ?? {}) };
        next[key] = Math.max(2, Number(charUnits.toFixed(2)));
        return { ...base, version: 1, colWidths: next };
      });
    },
    [displaySheet, mutateEditorState]
  );

  const setRowHeight = useCallback(
    (row: number, points: number) => {
      if (!displaySheet) return;
      const key = `${displaySheet.id}!${row}`;
      mutateEditorState((prev) => {
        const base: ExcelEditorState = prev ?? { version: 1 };
        const next = { ...(base.rowHeights ?? {}) };
        next[key] = Math.max(8, Number(points.toFixed(2)));
        return { ...base, version: 1, rowHeights: next };
      });
    },
    [displaySheet, mutateEditorState]
  );

  // Frozen panes — set both axes at once. `row` / `col` are zero-based
  // counts (e.g. row=1 freezes the first row only). Pass {row:0,col:0}
  // to clear the freeze entirely.
  const setFrozenPanes = useCallback(
    (row: number, col: number) => {
      if (!displaySheet) return;
      const sheetId = displaySheet.id;
      mutateEditorState((prev) => {
        const base: ExcelEditorState = prev ?? { version: 1 };
        const next = { ...(base.frozen ?? {}) };
        if (row <= 0 && col <= 0) delete next[sheetId];
        else next[sheetId] = { row: Math.max(0, row), col: Math.max(0, col) };
        return { ...base, version: 1, frozen: next };
      });
    },
    [displaySheet, mutateEditorState]
  );

  // Effective freeze for the active sheet — patch overrides parsed.
  const sheetFreeze = useMemo<{ row: number; col: number }>(() => {
    if (!displaySheet) return { row: 0, col: 0 };
    const override = editorState?.frozen?.[displaySheet.id];
    if (override) return override;
    return displaySheet.frozen ?? { row: 0, col: 0 };
  }, [displaySheet, editorState?.frozen]);

  // ---------------------------------------------------------------------
  // Data validation (list type)
  // ---------------------------------------------------------------------

  const validationsByCoord = useMemo(() => {
    const map = new Map<string, { type: "list"; values: string[] }>();
    if (!editorState?.validations || !displaySheet) return map;
    const prefix = `${displaySheet.id}!`;
    for (const [key, val] of Object.entries(editorState.validations)) {
      if (!key.startsWith(prefix)) continue;
      const coords = key.slice(prefix.length);
      const [rowStr, colStr] = coords.split(",");
      const r = Number(rowStr);
      const c = Number(colStr);
      if (Number.isFinite(r) && Number.isFinite(c)) {
        map.set(coordKey(r, c), val);
      }
    }
    return map;
  }, [editorState?.validations, displaySheet]);

  // ---------------------------------------------------------------------
  // Cell comments (per-sheet lookup)
  // ---------------------------------------------------------------------

  const commentsByCoord = useMemo(() => {
    const map = new Map<string, ExcelCellComment>();
    if (!editorState?.comments || !displaySheet) return map;
    const prefix = `${displaySheet.id}!`;
    for (const [key, val] of Object.entries(editorState.comments)) {
      if (!key.startsWith(prefix)) continue;
      const coords = key.slice(prefix.length);
      const [rowStr, colStr] = coords.split(",");
      const r = Number(rowStr);
      const c = Number(colStr);
      if (Number.isFinite(r) && Number.isFinite(c)) map.set(coordKey(r, c), val);
    }
    return map;
  }, [editorState?.comments, displaySheet]);

  const commentAt = useCallback(
    (row: number, col: number): ExcelCellComment | null =>
      commentsByCoord.get(coordKey(row, col)) ?? null,
    [commentsByCoord]
  );

  // ---------------------------------------------------------------------
  // Conditional formatting actions
  //
  // The toolbar surfaces a few preset rules anchored at the current
  // selection. Custom rule authoring beyond the presets is intentionally
  // out of scope for the MVP — the menu is enough to cover the 90%
  // case (highlight cells, top/bottom, color scale).
  // ---------------------------------------------------------------------

  const addConditionalFormatRule = useCallback(
    (
      build: (b: {
        top: number;
        left: number;
        bottom: number;
        right: number;
      }) => ExcelConditionalFormatRule | null
    ) => {
      if (!displaySheet || !selection) return;
      const range = rangeBounds(selection);
      const rule = build(range);
      if (!rule) return;
      mutateEditorState((prev) => {
        const base: ExcelEditorState = prev ?? { version: 1 };
        const byId = { ...(base.conditionalFormats ?? {}) };
        const list = byId[displaySheet.id] ?? [];
        byId[displaySheet.id] = [...list, rule];
        return { ...base, version: 1, conditionalFormats: byId };
      });
    },
    [displaySheet, selection, mutateEditorState]
  );

  const clearConditionalFormatsForSelection = useCallback(() => {
    if (!displaySheet || !selection) return;
    const range = rangeBounds(selection);
    mutateEditorState((prev) => {
      const base: ExcelEditorState = prev ?? { version: 1 };
      const list = base.conditionalFormats?.[displaySheet.id];
      if (!list || list.length === 0) return base;
      // Drop rules whose range is entirely inside the selection. Rules
      // that only partially overlap are kept untouched — the user can
      // expand the selection to wipe them, otherwise we'd silently
      // erase data the user didn't ask to clear.
      const next = list.filter((rule) => {
        const r = rule.range;
        const inside =
          r.top >= range.top &&
          r.bottom <= range.bottom &&
          r.left >= range.left &&
          r.right <= range.right;
        return !inside;
      });
      const byId = { ...(base.conditionalFormats ?? {}) };
      if (next.length === 0) delete byId[displaySheet.id];
      else byId[displaySheet.id] = next;
      return { ...base, version: 1, conditionalFormats: byId };
    });
  }, [displaySheet, selection, mutateEditorState]);

  const newRuleId = () => `cf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const cfPresetGreaterThan = useCallback(async () => {
    const input = await requestTextDialog({
      title: "Highlight cells greater than",
      defaultValue: "0",
      confirmLabel: "Apply",
    });
    if (input === null) return;
    const value = Number(input);
    if (!Number.isFinite(value)) {
      notify.error("Enter a number");
      return;
    }
    addConditionalFormatRule((range) => ({
      id: newRuleId(),
      range,
      condition: { kind: "cellValue", op: "gt", value },
      style: { background: "#FFF2CC", color: "#7F6000" },
    }));
  }, [addConditionalFormatRule, requestTextDialog]);

  const cfPresetLessThan = useCallback(async () => {
    const input = await requestTextDialog({
      title: "Highlight cells less than",
      defaultValue: "0",
      confirmLabel: "Apply",
    });
    if (input === null) return;
    const value = Number(input);
    if (!Number.isFinite(value)) {
      notify.error("Enter a number");
      return;
    }
    addConditionalFormatRule((range) => ({
      id: newRuleId(),
      range,
      condition: { kind: "cellValue", op: "lt", value },
      style: { background: "#FCE4D6", color: "#9C0006" },
    }));
  }, [addConditionalFormatRule, requestTextDialog]);

  const cfPresetBetween = useCallback(async () => {
    const minInput = await requestTextDialog({
      title: "Minimum value",
      defaultValue: "0",
      confirmLabel: "Next",
    });
    if (minInput === null) return;
    const maxInput = await requestTextDialog({
      title: "Maximum value",
      defaultValue: "100",
      confirmLabel: "Apply",
    });
    if (maxInput === null) return;
    const min = Number(minInput);
    const max = Number(maxInput);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      notify.error("Enter numbers");
      return;
    }
    addConditionalFormatRule((range) => ({
      id: newRuleId(),
      range,
      condition: { kind: "between", min, max, inclusive: true },
      style: { background: "#C6EFCE", color: "#006100" },
    }));
  }, [addConditionalFormatRule, requestTextDialog]);

  const cfPresetContainsText = useCallback(async () => {
    const input = await requestTextDialog({
      title: "Highlight cells containing text",
      defaultValue: "",
      confirmLabel: "Apply",
    });
    if (input === null || input === "") return;
    addConditionalFormatRule((range) => ({
      id: newRuleId(),
      range,
      condition: { kind: "containsText", text: input, mode: "contains" },
      style: { background: "#DDEBF7", color: "#1F3864", bold: true },
    }));
  }, [addConditionalFormatRule, requestTextDialog]);

  const cfPresetDuplicates = useCallback(() => {
    addConditionalFormatRule((range) => ({
      id: newRuleId(),
      range,
      condition: { kind: "duplicate" },
      style: { background: "#FFD6D6", color: "#9C0006" },
    }));
  }, [addConditionalFormatRule]);

  const cfPresetColorScaleRG = useCallback(() => {
    addConditionalFormatRule((range) => ({
      id: newRuleId(),
      range,
      condition: {
        kind: "colorScale",
        min: { color: "#F8696B" },
        mid: { color: "#FFEB84" },
        max: { color: "#63BE7B" },
      },
    }));
  }, [addConditionalFormatRule]);

  const promptCellComment = useCallback(async () => {
    if (!displaySheet || !selection) return;
    const origin = rangeOrigin(selection);
    const existing = commentsByCoord.get(coordKey(origin.row, origin.col));
    const sample = existing?.text ?? "";
    const input = await requestTextDialog({
      title: "Cell comment",
      description: "Leave empty to clear the comment.",
      defaultValue: sample,
      confirmLabel: "Save",
    });
    if (input === null) return;
    const trimmed = input.trim();
    const b = rangeBounds(selection);
    mutateEditorState((prev) => {
      const base: ExcelEditorState = prev ?? { version: 1 };
      const next = { ...(base.comments ?? {}) };
      const updatedAt = new Date().toISOString();
      for (let r = b.top; r <= b.bottom; r++) {
        for (let c = b.left; c <= b.right; c++) {
          const key = `${displaySheet.id}!${r},${c}`;
          if (trimmed === "") delete next[key];
          else next[key] = { text: trimmed, updatedAt };
        }
      }
      return { ...base, version: 1, comments: next };
    });
  }, [displaySheet, selection, commentsByCoord, mutateEditorState, requestTextDialog]);

  // ---------------------------------------------------------------------
  // Conditional formatting (per-sheet rules + range-stats cache)
  // ---------------------------------------------------------------------

  const cfRulesForSheet = useMemo<ExcelConditionalFormatRule[]>(() => {
    if (!editorState?.conditionalFormats || !displaySheet) return [];
    return editorState.conditionalFormats[displaySheet.id] ?? [];
  }, [editorState?.conditionalFormats, displaySheet]);

  // Range-stats cache: built once per render, keyed by rule id. The
  // resolveValue closure walks the same `cellsByCoord` / `editsByCoord`
  // the renderer reads from so the values match what the user sees.
  const cfRangeStats = useMemo(() => {
    if (cfRulesForSheet.length === 0) return new Map<string, RangeStats>();
    return buildRangeStats(cfRulesForSheet, (row, col) => {
      const key = coordKey(row, col);
      const cell = cellsByCoord.get(key);
      const patch = editsByCoord.get(key);
      const computed = computedValueAt(row, col);
      const display = formatCellValue(cell, patch, computed);
      const valueRaw = patch && "value" in patch ? patch.value : (computed ?? cell?.value ?? null);
      return { value: valueRaw, display };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfRulesForSheet, cellsByCoord, editsByCoord, computedValueAt, engineGen]);

  const cfOverlayAt = useCallback(
    (row: number, col: number): CFOverlay | null => {
      if (cfRulesForSheet.length === 0) return null;
      const key = coordKey(row, col);
      const cell = cellsByCoord.get(key);
      const patch = editsByCoord.get(key);
      const computed = computedValueAt(row, col);
      const display = formatCellValue(cell, patch, computed);
      const valueRaw = patch && "value" in patch ? patch.value : (computed ?? cell?.value ?? null);
      return evaluateConditionalFormat(cfRulesForSheet, {
        row,
        col,
        value: valueRaw,
        display,
        rangeValuesByRuleId: cfRangeStats,
      });
    },
    [cfRulesForSheet, cfRangeStats, cellsByCoord, editsByCoord, computedValueAt]
  );

  const promptListValidation = useCallback(async () => {
    if (!displaySheet || !selection) return;
    const sample =
      validationsByCoord
        .get(coordKey(rangeOrigin(selection).row, rangeOrigin(selection).col))
        ?.values.join(", ") ?? "";
    const input = await requestTextDialog({
      title: "Allowed values",
      description: "Comma-separated values. Leave empty to clear the list.",
      defaultValue: sample,
      placeholder: "Open, Closed, Blocked",
      confirmLabel: "Apply",
    });
    if (input === null) return;
    const values = input
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const b = rangeBounds(selection);
    mutateEditorState((prev) => {
      const base: ExcelEditorState = prev ?? { version: 1 };
      const next = { ...(base.validations ?? {}) };
      for (let r = b.top; r <= b.bottom; r++) {
        for (let c = b.left; c <= b.right; c++) {
          const key = `${displaySheet.id}!${r},${c}`;
          if (values.length === 0) delete next[key];
          else next[key] = { type: "list", values };
        }
      }
      return { ...base, version: 1, validations: next };
    });
  }, [displaySheet, selection, validationsByCoord, mutateEditorState, requestTextDialog]);

  // Validation-list popover anchored at click — when user clicks the ▾
  // on a cell with a list validation we surface the picker here.
  const [validationPopover, setValidationPopover] = useState<{
    row: number;
    col: number;
    x: number;
    y: number;
  } | null>(null);

  // ---------------------------------------------------------------------
  // Formula autocomplete
  //
  // Lives at the workspace level so the cell input + the suggest popover
  // share a single state machine: arrow-key navigation flows through the
  // input's keyboard handler, the popover just renders the highlighted
  // entry. Suggestions only show while the user is *typing* a function
  // name token inside an `=`-prefixed cell.
  // ---------------------------------------------------------------------
  const [suggestIndex, setSuggestIndex] = useState(0);
  const suggestItems = useMemo<string[]>(() => {
    if (!editing) return [];
    const draft = editing.draft;
    if (!draft.startsWith("=")) return [];
    // Caret-driven matching would be ideal, but we don't track caret —
    // approximate with "current token = trailing identifier chars" which
    // matches typical typing flow ("=SU" → suggest SUM/SUMIF/...).
    const tokenStart = findCurrentFnTokenStart(draft, draft.length);
    const prefix = draft.slice(tokenStart);
    if (prefix.length === 0) return [];
    const upper = prefix.toUpperCase();
    return HF_FUNCTION_NAMES.filter((name) => name.startsWith(upper)).slice(0, 25);
  }, [editing]);

  // Reset the highlight whenever the suggestion list changes from under us.
  useEffect(() => {
    setSuggestIndex(0);
  }, [suggestItems]);

  /** Apply the suggested function name — replace the current token with
   *  `${name}(` so the user can continue typing arguments. */
  const acceptSuggestion = useCallback(
    (name: string) => {
      if (!editing) return;
      const draft = editing.draft;
      const tokenStart = findCurrentFnTokenStart(draft, draft.length);
      const next = `${draft.slice(0, tokenStart)}${name}(`;
      setEditing((prev) => (prev ? { ...prev, draft: next, freshDraft: false } : prev));
    },
    [editing]
  );

  /** Hook called by the cell input on key events. Returns `true` when
   *  the suggest UI consumed the event (caller should `preventDefault`
   *  and skip its own handling). */
  const handleSuggestKey = useCallback(
    (key: string): boolean => {
      if (suggestItems.length === 0) return false;
      if (key === "ArrowDown") {
        setSuggestIndex((i) => (i + 1) % suggestItems.length);
        return true;
      }
      if (key === "ArrowUp") {
        setSuggestIndex((i) => (i - 1 + suggestItems.length) % suggestItems.length);
        return true;
      }
      if (key === "Tab" || key === "Enter") {
        const choice = suggestItems[suggestIndex];
        if (choice) {
          acceptSuggestion(choice);
          return true;
        }
      }
      return false;
    },
    [suggestItems, suggestIndex, acceptSuggestion]
  );

  // Anchor for the suggest popover — pinned to the active edit input's
  // bottom-left so suggestions appear directly under the user's caret
  // regardless of which surface (cell vs formula bar) they're typing on.
  const [suggestAnchor, setSuggestAnchor] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!editing || suggestItems.length === 0) {
      setSuggestAnchor(null);
      return;
    }
    const input = editing.source === "formula-bar" ? formulaInputRef.current : cellInputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    setSuggestAnchor({ x: rect.left, y: rect.bottom + 4 });
  }, [editing, suggestItems]);

  // ---------------------------------------------------------------------
  // Column filters
  // ---------------------------------------------------------------------

  const sheetFilterMode = displaySheet ? !!editorState?.filterMode?.[displaySheet.id] : false;

  const toggleFilterMode = useCallback(() => {
    if (!displaySheet) return;
    const sheetId = displaySheet.id;
    mutateEditorState((prev) => {
      const base: ExcelEditorState = prev ?? { version: 1 };
      const nextMode = { ...(base.filterMode ?? {}) };
      const willEnable = !nextMode[sheetId];
      if (willEnable) nextMode[sheetId] = true;
      else delete nextMode[sheetId];
      // Turning filter mode off also drops every column filter for this
      // sheet so hidden rows reappear automatically.
      let nextFilters = base.filters;
      if (!willEnable && base.filters) {
        const prefix = `${sheetId}!`;
        const stripped: Record<string, string[]> = {};
        for (const [key, value] of Object.entries(base.filters)) {
          if (!key.startsWith(prefix)) stripped[key] = value;
        }
        nextFilters = stripped;
      }
      return { ...base, version: 1, filterMode: nextMode, filters: nextFilters };
    });
  }, [displaySheet, mutateEditorState]);

  const setColumnFilter = useCallback(
    (col: number, visible: string[] | null) => {
      if (!displaySheet) return;
      const key = `${displaySheet.id}!${col}`;
      mutateEditorState((prev) => {
        const base: ExcelEditorState = prev ?? { version: 1 };
        const next = { ...(base.filters ?? {}) };
        if (visible === null || visible.length === 0) {
          delete next[key];
        } else {
          next[key] = visible;
        }
        return { ...base, version: 1, filters: next };
      });
    },
    [displaySheet, mutateEditorState]
  );

  // Distinct display values per column (lazily computed when the popover
  // asks for them). We snapshot all rows except the header (row 0) since
  // that's almost always a label that the user wouldn't want to hide.
  const getColumnUniqueValues = useCallback(
    (col: number): string[] => {
      if (!displaySheet) return [];
      const seen = new Set<string>();
      const ordered: string[] = [];
      for (let r = 1; r < displaySheet.rowCount; r++) {
        const cell = cellsByCoord.get(coordKey(r, col));
        const patch = editsByCoord.get(coordKey(r, col));
        const text = formatCellValue(cell, patch, computedValueAt(r, col));
        if (seen.has(text)) continue;
        seen.add(text);
        ordered.push(text);
      }
      return ordered;
    },
    [displaySheet, cellsByCoord, editsByCoord, computedValueAt]
  );

  // Rows hidden by any active column filter. Rebuilt whenever the
  // filters or the cell content for the current sheet changes.
  const hiddenRows = useMemo<Set<number>>(() => {
    const set = new Set<number>();
    if (!displaySheet || !editorState?.filters) return set;
    const prefix = `${displaySheet.id}!`;
    const colFilters: Array<{ col: number; allowed: Set<string> }> = [];
    for (const [key, values] of Object.entries(editorState.filters)) {
      if (!key.startsWith(prefix)) continue;
      const col = Number(key.slice(prefix.length));
      if (!Number.isFinite(col)) continue;
      colFilters.push({ col, allowed: new Set(values) });
    }
    if (colFilters.length === 0) return set;
    // Header row stays visible regardless of filters — matches Sheets.
    for (let r = 1; r < displaySheet.rowCount; r++) {
      for (const { col, allowed } of colFilters) {
        const cell = cellsByCoord.get(coordKey(r, col));
        const patch = editsByCoord.get(coordKey(r, col));
        const text = formatCellValue(cell, patch, computedValueAt(r, col));
        if (!allowed.has(text)) {
          set.add(r);
          break;
        }
      }
    }
    return set;
  }, [displaySheet, editorState?.filters, cellsByCoord, editsByCoord, computedValueAt]);

  const activeColumnFilters = useMemo<Set<number>>(() => {
    const out = new Set<number>();
    if (!displaySheet || !editorState?.filters) return out;
    const prefix = `${displaySheet.id}!`;
    for (const key of Object.keys(editorState.filters)) {
      if (!key.startsWith(prefix)) continue;
      const col = Number(key.slice(prefix.length));
      if (Number.isFinite(col)) out.add(col);
    }
    return out;
  }, [displaySheet, editorState?.filters]);

  // ---------------------------------------------------------------------
  // AutoFill — drag the bottom-right handle of the selection to extend
  // it. We snap the fill rectangle to a single dominant axis so the user
  // can pull straight down or straight right (matches Sheets / Excel).
  // ---------------------------------------------------------------------

  const beginAutoFill = useCallback(() => {
    if (!selection) return;
    setFillSource(selection);
    setFillRange(null);
  }, [selection]);

  const extendAutoFill = useCallback((row: number, col: number) => {
    const source = fillSourceRef.current;
    if (!source) return;
    const b = rangeBounds(source);
    const dRow = row < b.top ? row - b.top : row > b.bottom ? row - b.bottom : 0;
    const dCol = col < b.left ? col - b.left : col > b.right ? col - b.right : 0;
    if (dRow === 0 && dCol === 0) {
      setFillRange(source);
      return;
    }
    // Snap to the dominant axis — Sheets behaviour. Equal magnitudes
    // prefer vertical (the more common spreadsheet flow).
    if (Math.abs(dRow) >= Math.abs(dCol)) {
      setFillRange({
        startRow: dRow > 0 ? b.top : row,
        startCol: b.left,
        endRow: dRow > 0 ? row : b.bottom,
        endCol: b.right,
      });
    } else {
      setFillRange({
        startRow: b.top,
        startCol: dCol > 0 ? b.left : col,
        endRow: b.bottom,
        endCol: dCol > 0 ? col : b.right,
      });
    }
  }, []);

  const commitAutoFill = useCallback(() => {
    const source = fillSourceRef.current;
    const range = fillRangeRef.current;
    setFillSource(null);
    setFillRange(null);
    if (!source || !range || !displaySheet) return;
    const sb = rangeBounds(source);
    const fb = rangeBounds(range);
    // Bail if the fill rectangle equals the source — nothing to do.
    if (
      sb.top === fb.top &&
      sb.bottom === fb.bottom &&
      sb.left === fb.left &&
      sb.right === fb.right
    ) {
      return;
    }
    // Snapshot source values + styles so we can repeat / extrapolate.
    const sourceRows = sb.bottom - sb.top + 1;
    const sourceCols = sb.right - sb.left + 1;
    type Snap = {
      value: string | number | boolean | null;
      formula: string | null;
      style?: ExcelCellStyle;
      numberFormat?: string;
    };
    const snapshot: Snap[][] = [];
    for (let r = 0; r < sourceRows; r++) {
      const row: Snap[] = [];
      for (let c = 0; c < sourceCols; c++) {
        const baseCell = cellsByCoord.get(coordKey(sb.top + r, sb.left + c));
        const patch = editsByCoord.get(coordKey(sb.top + r, sb.left + c));
        const value = patch && "value" in patch ? (patch.value ?? null) : (baseCell?.value ?? null);
        const formula = patch?.formula ?? baseCell?.formula ?? null;
        const style = mergeStyle(baseCell?.style, patch?.style);
        const numberFormat = patch?.numberFormat ?? baseCell?.numberFormat;
        row.push({ value, formula, style, numberFormat });
      }
      snapshot.push(row);
    }
    // Determine fill axis + direction.
    const isVertical = fb.top !== sb.top || fb.bottom !== sb.bottom;
    const fillingForward = isVertical ? fb.bottom > sb.bottom : fb.right > sb.right;

    // Per-column (vertical fill) or per-row (horizontal fill) arithmetic
    // step. NaN signals "not a clean numeric series — repeat instead".
    const seriesSteps: number[] = isVertical
      ? Array.from({ length: sourceCols }, (_, c) => {
          if (sourceRows < 2) {
            const v = snapshot[0][c].value;
            return typeof v === "number" ? 1 : NaN;
          }
          const first = snapshot[0][c].value;
          const last = snapshot[sourceRows - 1][c].value;
          if (typeof first !== "number" || typeof last !== "number") return NaN;
          return (last - first) / (sourceRows - 1);
        })
      : Array.from({ length: sourceRows }, (_, r) => {
          if (sourceCols < 2) {
            const v = snapshot[r][0].value;
            return typeof v === "number" ? 1 : NaN;
          }
          const first = snapshot[r][0].value;
          const last = snapshot[r][sourceCols - 1].value;
          if (typeof first !== "number" || typeof last !== "number") return NaN;
          return (last - first) / (sourceCols - 1);
        });

    const updates: CellUpdate[] = [];
    for (let r = fb.top; r <= fb.bottom; r++) {
      for (let c = fb.left; c <= fb.right; c++) {
        // Skip the source rows/cols — they already hold the user's data.
        if (r >= sb.top && r <= sb.bottom && c >= sb.left && c <= sb.right) continue;

        // `step` measures how many cells past the source edge we are
        // (positive forward, negative backward). For arithmetic series
        // that's the multiplier on the per-axis step. For pattern repeat
        // it picks which source row/col we wrap to.
        const step = isVertical
          ? fillingForward
            ? r - sb.bottom
            : -(sb.top - r)
          : fillingForward
            ? c - sb.right
            : -(sb.left - c);

        // The "anchor" cell in the source = last row/col when filling
        // forward, first when backward. The series extrapolates from
        // there; pattern-repeat falls back to the same anchor cell value
        // when the series detection fails.
        const srcRow = isVertical
          ? fillingForward
            ? sourceRows - 1 - ((Math.abs(step) - 1) % sourceRows)
            : (Math.abs(step) - 1) % sourceRows
          : r - sb.top;
        const srcCol = isVertical
          ? c - sb.left
          : fillingForward
            ? sourceCols - 1 - ((Math.abs(step) - 1) % sourceCols)
            : (Math.abs(step) - 1) % sourceCols;
        const snap = snapshot[srcRow]?.[srcCol];
        if (!snap) continue;

        const seriesIndex = isVertical ? srcCol : srcRow;
        const stepValue = seriesSteps[seriesIndex];
        let value: string | number | boolean | null = snap.value;
        if (typeof snap.value === "number" && Number.isFinite(stepValue)) {
          // Arithmetic extrapolation — `step` is already signed so the
          // multiplication produces the right offset both forward and
          // backward of the source range.
          value = snap.value + stepValue * step;
        }
        updates.push({
          row: r,
          col: c,
          patch: {
            value,
            formula: null,
            numberFormat: snap.numberFormat,
            style: snap.style,
          },
        });
      }
    }
    if (updates.length === 0) return;
    applyCellUpdates(updates);
    setSelection(range);
  }, [displaySheet, cellsByCoord, editsByCoord, applyCellUpdates]);

  // Pick a fresh sheet name like Excel ("Sheet2", "Sheet3", …) skipping
  // names already in use so duplicates don't trip openpyxl on export.
  const generateSheetName = useCallback(
    (preferredBase: string): string => {
      const taken = new Set((displayWorkbook?.sheets ?? []).map((s) => s.name.toLowerCase()));
      if (!taken.has(preferredBase.toLowerCase())) return preferredBase;
      for (let i = 2; i < 1000; i++) {
        const candidate = `${preferredBase} ${i}`;
        if (!taken.has(candidate.toLowerCase())) return candidate;
      }
      return `${preferredBase}-${Date.now()}`;
    },
    [displayWorkbook]
  );

  const newSheetId = useCallback(() => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `sheet-user-${crypto.randomUUID()}`;
    }
    return `sheet-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }, []);

  const addSheet = useCallback(() => {
    if (!displayWorkbook) return;
    const sheetId = newSheetId();
    const name = generateSheetName("Sheet");
    applyWorkbookOpAndPersist({
      type: "addSheet",
      sheetId,
      name,
      afterSheetId: activeSheetId ?? undefined,
    });
    setActiveSheetId(sheetId);
  }, [displayWorkbook, generateSheetName, newSheetId, applyWorkbookOpAndPersist, activeSheetId]);

  const renameSheetById = useCallback(
    async (sheetId: string) => {
      if (!displayWorkbook) return;
      const sheet = displayWorkbook.sheets.find((s) => s.id === sheetId);
      if (!sheet) return;
      const next = await requestTextDialog({
        title: "Rename sheet",
        defaultValue: sheet.name,
        confirmLabel: "Rename",
      });
      if (!next) return;
      const trimmed = next.trim();
      if (!trimmed || trimmed === sheet.name) return;
      const taken = displayWorkbook.sheets.some(
        (s) => s.id !== sheetId && s.name.toLowerCase() === trimmed.toLowerCase()
      );
      if (taken) {
        notify.error("A sheet with that name already exists");
        return;
      }
      applyWorkbookOpAndPersist({ type: "renameSheet", sheetId, name: trimmed });
    },
    [displayWorkbook, applyWorkbookOpAndPersist, requestTextDialog]
  );

  const duplicateSheetById = useCallback(
    (sheetId: string) => {
      if (!displayWorkbook) return;
      const source = displayWorkbook.sheets.find((s) => s.id === sheetId);
      if (!source) return;
      const id = newSheetId();
      const name = generateSheetName(`${source.name} (copy)`);
      applyWorkbookOpAndPersist({
        type: "duplicateSheet",
        sourceSheetId: sheetId,
        sheetId: id,
        name,
      });
      setActiveSheetId(id);
    },
    [displayWorkbook, generateSheetName, newSheetId, applyWorkbookOpAndPersist]
  );

  const deleteSheetById = useCallback(
    async (sheetId: string) => {
      if (!displayWorkbook) return;
      if (displayWorkbook.sheets.length <= 1) {
        notify.error("A workbook must have at least one sheet");
        return;
      }
      const sheet = displayWorkbook.sheets.find((s) => s.id === sheetId);
      if (!sheet) return;
      const ok = await requestConfirmDialog({
        title: `Delete "${sheet.name}"?`,
        description: "This cannot be undone after saving.",
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!ok) return;
      applyWorkbookOpAndPersist({ type: "deleteSheet", sheetId });
    },
    [displayWorkbook, applyWorkbookOpAndPersist, requestConfirmDialog]
  );

  // ---------------------------------------------------------------------
  // Find & Replace
  // ---------------------------------------------------------------------

  const findMatches = useMemo<FindMatch[]>(() => {
    if (!findOpen || !displaySheet || findQuery === "") return [];
    const needle = findMatchCase ? findQuery : findQuery.toLowerCase();
    const matches: FindMatch[] = [];
    const visited = new Set<string>();
    const consider = (row: number, col: number, text: string) => {
      if (!text) return;
      const haystack = findMatchCase ? text : text.toLowerCase();
      const hit = findWholeCell ? haystack === needle : haystack.includes(needle);
      if (hit) matches.push({ row, col });
    };
    for (const cell of displaySheet.cells) {
      const key = coordKey(cell.row, cell.col);
      visited.add(key);
      const patch = editsByCoord.get(key);
      consider(
        cell.row,
        cell.col,
        formatCellValue(cell, patch, computedValueAt(cell.row, cell.col))
      );
    }
    // Cells that exist only in the patch overlay (user-typed into a
    // previously empty cell).
    for (const [key, patch] of editsByCoord.entries()) {
      if (visited.has(key)) continue;
      const [rowStr, colStr] = key.split(":");
      const row = Number(rowStr);
      const col = Number(colStr);
      consider(row, col, formatCellValue(undefined, patch, computedValueAt(row, col)));
    }
    matches.sort((a, b) => a.row - b.row || a.col - b.col);
    return matches;
  }, [
    findOpen,
    displaySheet,
    findQuery,
    findMatchCase,
    findWholeCell,
    editsByCoord,
    computedValueAt,
  ]);

  // Reset / clamp the cursor whenever the active match list changes.
  useEffect(() => {
    if (findMatches.length === 0) {
      setFindIndex(null);
      return;
    }
    setFindIndex((current) => {
      if (current == null) return 0;
      if (current >= findMatches.length) return findMatches.length - 1;
      return current;
    });
  }, [findMatches]);

  // Whenever the cursor moves, jump the selection there too — gives the
  // user a visual breadcrumb that doesn't depend on a separate highlight.
  useEffect(() => {
    if (findIndex == null) return;
    const match = findMatches[findIndex];
    if (!match) return;
    setSelection(singleCellRange(match.row, match.col));
  }, [findIndex, findMatches]);

  const findCurrentMatch = findIndex != null ? (findMatches[findIndex] ?? null) : null;

  const openFindPanel = useCallback(() => {
    setFindOpen(true);
    if (anchor && !findQuery) {
      // Seed with the current cell's display text — common Sheets
      // convenience: ⌘F over a value pre-populates the search field.
      const cell = cellsByCoord.get(coordKey(anchor.row, anchor.col));
      const patch = editsByCoord.get(coordKey(anchor.row, anchor.col));
      const text = formatCellValue(cell, patch, computedValueAt(anchor.row, anchor.col));
      if (text) setFindQuery(text);
    }
  }, [anchor, findQuery, cellsByCoord, editsByCoord, computedValueAt]);

  useEffect(() => {
    window.addEventListener("doxmind:excel-find", openFindPanel);
    return () => window.removeEventListener("doxmind:excel-find", openFindPanel);
  }, [openFindPanel]);

  const closeFindPanel = useCallback(() => {
    setFindOpen(false);
    window.requestAnimationFrame(() => cellGridRef.current?.focus());
  }, []);

  const advanceFind = useCallback(
    (direction: 1 | -1) => {
      if (findMatches.length === 0) return;
      setFindIndex((current) => {
        if (current == null) return direction === 1 ? 0 : findMatches.length - 1;
        return (current + direction + findMatches.length) % findMatches.length;
      });
    },
    [findMatches.length]
  );

  const replaceCurrentMatch = useCallback(() => {
    if (!displaySheet || findMatches.length === 0 || findIndex == null) return;
    const match = findMatches[findIndex];
    if (!match) return;
    const cell = cellsByCoord.get(coordKey(match.row, match.col));
    const patch = editsByCoord.get(coordKey(match.row, match.col));
    if (patch?.formula || cell?.formula) {
      // Skip formula cells — replacing inside computed text would clobber
      // the formula. Find Next still walks past them.
      advanceFind(1);
      return;
    }
    const currentText = formatCellValue(cell, patch, computedValueAt(match.row, match.col));
    const nextText = findWholeCell
      ? findReplace
      : replaceInString(currentText, findQuery, findReplace, findMatchCase);
    applyCellUpdates([{ row: match.row, col: match.col, patch: parseDraft(nextText) }]);
    advanceFind(1);
  }, [
    displaySheet,
    findMatches,
    findIndex,
    cellsByCoord,
    editsByCoord,
    findWholeCell,
    findReplace,
    findQuery,
    findMatchCase,
    applyCellUpdates,
    advanceFind,
    computedValueAt,
  ]);

  const replaceAllMatches = useCallback(() => {
    if (!displaySheet || findMatches.length === 0) return;
    const updates: CellUpdate[] = [];
    for (const match of findMatches) {
      const cell = cellsByCoord.get(coordKey(match.row, match.col));
      const patch = editsByCoord.get(coordKey(match.row, match.col));
      if (patch?.formula || cell?.formula) continue;
      const currentText = formatCellValue(cell, patch, computedValueAt(match.row, match.col));
      const nextText = findWholeCell
        ? findReplace
        : replaceInString(currentText, findQuery, findReplace, findMatchCase);
      if (nextText === currentText) continue;
      updates.push({ row: match.row, col: match.col, patch: parseDraft(nextText) });
    }
    if (updates.length === 0) return;
    applyCellUpdates(updates);
    // Silent: the cells visibly update.
  }, [
    displaySheet,
    findMatches,
    cellsByCoord,
    editsByCoord,
    findWholeCell,
    findReplace,
    findQuery,
    findMatchCase,
    applyCellUpdates,
  ]);

  // ---------------------------------------------------------------------
  // Selection helpers
  // ---------------------------------------------------------------------

  const onSelectStart = useCallback((row: number, col: number, options: { extend: boolean }) => {
    // If a cell input is open, the input's `onBlur` will commit the
    // in-flight draft. We don't trigger commit here because the click
    // hasn't taken focus yet — letting blur run after this lets the
    // click's selection survive instead of getting overwritten.
    if (options.extend) {
      setSelection((prev) => {
        if (!prev) return singleCellRange(row, col);
        return { ...prev, endRow: row, endCol: col };
      });
    } else {
      setSelection(singleCellRange(row, col));
    }
  }, []);

  const onSelectExtend = useCallback((row: number, col: number) => {
    setSelection((prev) => (prev ? { ...prev, endRow: row, endCol: col } : prev));
  }, []);

  const onSelectEnd = useCallback(() => {
    // Drag finished — nothing to persist; selection is already in state.
    // Format painter consumes the just-finished selection: paint the
    // captured style onto the range, then disarm.
    if (paintStyleRef.current) {
      const captured = paintStyleRef.current;
      paintStyleRef.current = null;
      // Defer to a microtask so the selection update has flushed.
      window.setTimeout(() => {
        if (!selectionRef.current) {
          setPaintStyle(null);
          return;
        }
        const b = rangeBounds(selectionRef.current);
        const updates: CellUpdate[] = [];
        for (let r = b.top; r <= b.bottom; r++) {
          for (let c = b.left; c <= b.right; c++) {
            updates.push({ row: r, col: c, patch: { style: { ...captured } } });
          }
        }
        applyCellUpdates(updates);
        setPaintStyle(null);
      }, 0);
    }
  }, [applyCellUpdates]);

  const moveSelection = useCallback(
    (deltaRow: number, deltaCol: number, options?: { extend?: boolean }) => {
      if (!displaySheet) return;
      const maxRow = displaySheet.rowCount - 1;
      const maxCol = displaySheet.colCount - 1;
      setSelection((prev) => {
        const start = prev ?? singleCellRange(0, 0);
        if (options?.extend) {
          return {
            ...start,
            endRow: clamp(start.endRow + deltaRow, 0, maxRow),
            endCol: clamp(start.endCol + deltaCol, 0, maxCol),
          };
        }
        const nextRow = clamp(start.endRow + deltaRow, 0, maxRow);
        const nextCol = clamp(start.endCol + deltaCol, 0, maxCol);
        return singleCellRange(nextRow, nextCol);
      });
    },
    [displaySheet]
  );

  const selectAll = useCallback(() => {
    if (!displaySheet) return;
    setSelection({
      startRow: 0,
      startCol: 0,
      endRow: Math.max(0, displaySheet.rowCount - 1),
      endCol: Math.max(0, displaySheet.colCount - 1),
    });
  }, [displaySheet]);

  // ---------------------------------------------------------------------
  // Editing flow
  // ---------------------------------------------------------------------

  const beginEdit = useCallback(
    (
      row: number,
      col: number,
      options?: { initialChar?: string; source?: "cell" | "formula-bar" }
    ) => {
      const cell = cellsByCoord.get(coordKey(row, col));
      const patch = editsByCoord.get(coordKey(row, col));
      const existing = formulaOrValueAsString(patch ?? cell);
      const initialChar = options?.initialChar;
      const draft = initialChar !== undefined ? initialChar : existing;
      setEditing({
        row,
        col,
        draft,
        freshDraft: initialChar !== undefined,
        source: options?.source ?? "cell",
      });
      setSelection(singleCellRange(row, col));
    },
    [cellsByCoord, editsByCoord]
  );

  const commitEditingCell = useCallback(
    (advance?: EditAdvance) => {
      if (!displaySheet) return;
      const current = editingRef.current;
      if (!current) return;
      const trimmed = current.draft.trim();
      const patch = parseDraft(trimmed);
      applyCellUpdates([{ row: current.row, col: current.col, patch }]);
      setEditing(null);
      // Only steer the selection when the caller explicitly asked us to
      // (Enter/Tab from the cell input, or the formula bar's Enter). When
      // editing ends because the user clicked another cell, the click's
      // own selection update stays — overriding it here would wipe out
      // the user's intent.
      if (advance) {
        const nextRow = clamp(current.row + advance.dRow, 0, displaySheet.rowCount - 1);
        const nextCol = clamp(current.col + advance.dCol, 0, displaySheet.colCount - 1);
        setSelection(singleCellRange(nextRow, nextCol));
      }
      window.requestAnimationFrame(() => cellGridRef.current?.focus());
    },
    [displaySheet, applyCellUpdates]
  );

  const cancelEdit = useCallback(() => {
    setEditing(null);
    window.requestAnimationFrame(() => cellGridRef.current?.focus());
  }, []);

  const updateDraft = useCallback((draft: string) => {
    setEditing((prev) => (prev ? { ...prev, draft, freshDraft: false } : prev));
  }, []);

  // ---------------------------------------------------------------------
  // Range-wide operations
  // ---------------------------------------------------------------------

  const buildRangeUpdates = useCallback(
    (mapper: (row: number, col: number) => ExcelCellPatch | null): CellUpdate[] => {
      if (!displaySheet || !selection) return [];
      const b = rangeBounds(selection);
      const updates: CellUpdate[] = [];
      for (let r = b.top; r <= b.bottom; r++) {
        for (let c = b.left; c <= b.right; c++) {
          if (r < 0 || c < 0) continue;
          if (r >= displaySheet.rowCount || c >= displaySheet.colCount) continue;
          updates.push({ row: r, col: c, patch: mapper(r, c) });
        }
      }
      return updates;
    },
    [displaySheet, selection]
  );

  const applyStyleToRange = useCallback(
    (stylePatch: Partial<ExcelCellStyle>) => {
      const updates = buildRangeUpdates(() => ({ style: stylePatch }));
      applyCellUpdates(updates);
    },
    [buildRangeUpdates, applyCellUpdates]
  );

  const toggleBold = useCallback(
    () => applyStyleToRange({ bold: !effectiveStyleForAnchor?.bold }),
    [applyStyleToRange, effectiveStyleForAnchor]
  );
  const toggleItalic = useCallback(
    () => applyStyleToRange({ italic: !effectiveStyleForAnchor?.italic }),
    [applyStyleToRange, effectiveStyleForAnchor]
  );
  const toggleUnderline = useCallback(
    () => applyStyleToRange({ underline: !effectiveStyleForAnchor?.underline }),
    [applyStyleToRange, effectiveStyleForAnchor]
  );
  const toggleStrikethrough = useCallback(
    () => applyStyleToRange({ strikethrough: !effectiveStyleForAnchor?.strikethrough }),
    [applyStyleToRange, effectiveStyleForAnchor]
  );
  const setTextOverflow = useCallback(
    (next: "clip" | "wrap" | "overflow") => {
      // Also clear the legacy `wrapText` flag — new sidecars rely solely
      // on `textOverflow`. Leaving `wrapText` set could shadow the new
      // value on cells that round-trip through older code.
      applyStyleToRange({ textOverflow: next, wrapText: undefined });
    },
    [applyStyleToRange]
  );
  const currentTextOverflow: "clip" | "wrap" | "overflow" =
    effectiveStyleForAnchor?.textOverflow ?? (effectiveStyleForAnchor?.wrapText ? "wrap" : "clip");
  const setAlign = useCallback(
    (textAlign: "left" | "center" | "right") => applyStyleToRange({ textAlign }),
    [applyStyleToRange]
  );
  const setVerticalAlign = useCallback(
    (verticalAlign: "top" | "middle" | "bottom") => applyStyleToRange({ verticalAlign }),
    [applyStyleToRange]
  );
  // `null` means the user hit "Reset" — we drop the override by writing
  // `undefined`, which the JSON serialisation strips out, so on the next
  // load the parsed cell's original color reappears (matching Excel's
  // "remove formatting" semantics).
  const setTextColor = useCallback(
    (color: string | null) => applyStyleToRange({ color: color ?? undefined }),
    [applyStyleToRange]
  );
  const setFillColor = useCallback(
    (background: string | null) => applyStyleToRange({ background: background ?? undefined }),
    [applyStyleToRange]
  );
  const adjustFontSize = useCallback(
    (delta: number) => {
      const next = stepFontSize(effectiveStyleForAnchor?.fontSize, delta);
      applyStyleToRange({ fontSize: next });
    },
    [applyStyleToRange, effectiveStyleForAnchor]
  );
  const setFontFamily = useCallback(
    (family: string | null) => applyStyleToRange({ fontFamily: family ?? undefined }),
    [applyStyleToRange]
  );

  const applyBorderPattern = useCallback(
    (pattern: BorderPattern) => {
      if (!selection || !displaySheet) return;
      const b = rangeBounds(selection);
      const updates = buildRangeUpdates((row, col) => {
        const cell = cellsByCoord.get(coordKey(row, col));
        const patch = editsByCoord.get(coordKey(row, col));
        const existing: ExcelBorderConfig | undefined = {
          ...(cell?.style?.border ?? {}),
          ...(patch?.style?.border ?? {}),
        };
        const nextBorder = computeBorderForCell(
          pattern,
          DEFAULT_BORDER_SIDE,
          row,
          col,
          b,
          existing
        );
        return { style: { border: nextBorder } };
      });
      applyCellUpdates(updates);
    },
    [selection, displaySheet, buildRangeUpdates, cellsByCoord, editsByCoord, applyCellUpdates]
  );

  // -------------------------------------------------------------------
  // Σ — quick-insert aggregate formula (Sheets calls it "Functions"). The
  // formula lands in the cell *just below* the selection (or just to the
  // right, when the selection is a single row). This matches the Sheets
  // / Excel default for a single click of the Σ button.
  // -------------------------------------------------------------------
  const insertAggregateFn = useCallback(
    (fn: "SUM" | "AVERAGE" | "COUNT" | "MAX" | "MIN") => {
      if (!displaySheet || !selection) return;
      const b = rangeBounds(selection);
      const isSingleRow = b.top === b.bottom;
      const targetRow = isSingleRow ? b.top : b.bottom + 1;
      const targetCol = isSingleRow ? b.right + 1 : b.left;
      if (targetRow >= displaySheet.rowCount || targetCol >= displaySheet.colCount) {
        notify.error("No empty cell adjacent to the selection — extend the sheet first");
        return;
      }
      const range = `${columnLabel(b.left)}${b.top + 1}:${columnLabel(b.right)}${b.bottom + 1}`;
      const formula = `=${fn}(${range})`;
      applyCellUpdates([{ row: targetRow, col: targetCol, patch: { formula, value: null } }]);
      setSelection(singleCellRange(targetRow, targetCol));
    },
    [displaySheet, selection, applyCellUpdates]
  );

  // -------------------------------------------------------------------
  // Sort A→Z / Z→A — sorts rows in the selection by the leftmost column.
  // We deliberately move *values only*, not styles or formulas: cells with
  // formulas are left in place (formulas reference absolute coordinates
  // that would break under row reordering — preserving them keeps the
  // sheet computable). Anything else moves with its row.
  // -------------------------------------------------------------------
  const sortRangeBy = useCallback(
    (direction: "asc" | "desc") => {
      if (!displaySheet || !selection) return;
      const b = rangeBounds(selection);
      if (b.top === b.bottom) {
        // Silent: caller noop.
        return;
      }
      type RowSnapshot = {
        originalRow: number;
        values: (string | number | boolean | null)[];
        hasFormula: boolean;
      };
      const rows: RowSnapshot[] = [];
      for (let r = b.top; r <= b.bottom; r++) {
        const values: (string | number | boolean | null)[] = [];
        let hasFormula = false;
        for (let c = b.left; c <= b.right; c++) {
          const cell = cellsByCoord.get(coordKey(r, c));
          const patch = editsByCoord.get(coordKey(r, c));
          if ((patch && "formula" in patch && patch.formula) || cell?.formula) hasFormula = true;
          const value = patch && "value" in patch ? (patch.value ?? null) : (cell?.value ?? null);
          values.push(value);
        }
        rows.push({ originalRow: r, values, hasFormula });
      }
      // Skip rows that contain formulas — they stay anchored.
      const sortable = rows.filter((r) => !r.hasFormula);
      sortable.sort((a, b2) => {
        const cmp = compareCellValues(a.values[0], b2.values[0]);
        return direction === "asc" ? cmp : -cmp;
      });
      const updates: CellUpdate[] = [];
      let nextSortable = 0;
      for (let r = b.top; r <= b.bottom; r++) {
        const isFormulaRow = rows.find((s) => s.originalRow === r)?.hasFormula;
        if (isFormulaRow) continue;
        const snap = sortable[nextSortable++];
        if (!snap) continue;
        for (let c = b.left; c <= b.right; c++) {
          const j = c - b.left;
          updates.push({
            row: r,
            col: c,
            patch: { value: snap.values[j], formula: null },
          });
        }
      }
      if (updates.length === 0) return;
      applyCellUpdates(updates);
      // Silent on success; the visible cells reorder themselves.
    },
    [displaySheet, selection, cellsByCoord, editsByCoord, applyCellUpdates]
  );

  // -------------------------------------------------------------------
  // Format painter — capture the *effective* style of the current anchor,
  // arm a one-shot "next selection paints" mode, then on next select-end
  // apply that style across the freshly-selected range. The `paintStyle`
  // state is declared up top alongside its mirror ref.
  // -------------------------------------------------------------------
  const togglePaintMode = useCallback(() => {
    if (paintStyle) {
      setPaintStyle(null);
      return;
    }
    if (!effectiveStyleForAnchor) {
      return;
    }
    setPaintStyle({ ...effectiveStyleForAnchor });
  }, [paintStyle, effectiveStyleForAnchor]);

  // -------------------------------------------------------------------
  // Insert link ⌘K — wraps the cell value as a hyperlink. The link itself
  // lives in `style.hyperlink`; the renderer styles the cell as a link
  // (underline + primary color) and the backend writes it via openpyxl's
  // `cell.hyperlink`. Empty input clears the existing link.
  // -------------------------------------------------------------------
  const promptInsertLink = useCallback(async () => {
    if (!displaySheet || !anchor) return;
    const cell = cellsByCoord.get(coordKey(anchor.row, anchor.col));
    const patch = editsByCoord.get(coordKey(anchor.row, anchor.col));
    const currentLink = patch?.style?.hyperlink ?? cell?.style?.hyperlink ?? "";
    const next = await requestTextDialog({
      title: "Link URL",
      description: "Leave empty to remove the link.",
      defaultValue: currentLink,
      placeholder: "https://example.com",
      confirmLabel: "Apply",
    });
    if (next === null) return; // user cancelled
    const trimmed = next.trim();
    applyCellUpdates([
      {
        row: anchor.row,
        col: anchor.col,
        patch: { style: { hyperlink: trimmed.length > 0 ? trimmed : undefined } },
      },
    ]);
  }, [displaySheet, anchor, cellsByCoord, editsByCoord, applyCellUpdates, requestTextDialog]);

  const applyNumberFormatToRange = useCallback(
    (format: string) => {
      const updates = buildRangeUpdates(() => ({ numberFormat: format }));
      applyCellUpdates(updates);
    },
    [buildRangeUpdates, applyCellUpdates]
  );

  const adjustDecimalsForRange = useCallback(
    (delta: number) => {
      const updates = buildRangeUpdates((row, col) => {
        const cell = cellsByCoord.get(coordKey(row, col));
        const patch = editsByCoord.get(coordKey(row, col));
        const current = patch?.numberFormat ?? cell?.numberFormat;
        return { numberFormat: adjustDecimals(current, delta) };
      });
      applyCellUpdates(updates);
    },
    [buildRangeUpdates, cellsByCoord, editsByCoord, applyCellUpdates]
  );

  const clearRange = useCallback(() => {
    const updates = buildRangeUpdates(() => null);
    applyCellUpdates(updates);
  }, [buildRangeUpdates, applyCellUpdates]);

  const copyRangeToClipboard = useCallback(async () => {
    if (!selection || !displaySheet) return "";
    const b = rangeBounds(selection);
    const lines: string[] = [];
    for (let r = b.top; r <= b.bottom; r++) {
      const row: string[] = [];
      for (let c = b.left; c <= b.right; c++) {
        const cell = cellsByCoord.get(coordKey(r, c));
        const patch = editsByCoord.get(coordKey(r, c));
        // Copy the *computed* value (what the user sees), not the
        // formula text — matches Sheets / Excel paste-as-values default.
        row.push(formatCellValue(cell, patch, computedValueAt(r, c)));
      }
      lines.push(row.join("\t"));
    }
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      notify.error("Clipboard write was blocked");
    }
    return text;
  }, [selection, displaySheet, cellsByCoord, editsByCoord, computedValueAt]);

  const pasteFromClipboardIntoRange = useCallback(async () => {
    if (!selection || !displaySheet) return;
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      notify.error("Clipboard read was blocked");
      return;
    }
    if (!text) return;
    const lines = text.replace(/\r/g, "").split("\n");
    // Trim a single trailing empty line that comes from a final newline.
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    if (lines.length === 0) return;

    const b = rangeBounds(selection);
    const updates: CellUpdate[] = [];
    for (let dr = 0; dr < lines.length; dr++) {
      const cols = lines[dr].split("\t");
      for (let dc = 0; dc < cols.length; dc++) {
        const r = b.top + dr;
        const c = b.left + dc;
        if (r >= displaySheet.rowCount || c >= displaySheet.colCount) continue;
        updates.push({ row: r, col: c, patch: parseDraft(cols[dc]) });
      }
    }
    if (!updates.length) return;
    applyCellUpdates(updates);
    // Expand selection to match the pasted range so subsequent ops cover it.
    const lastRow = b.top + lines.length - 1;
    const lastCol = b.left + Math.max(...lines.map((line) => line.split("\t").length)) - 1;
    setSelection({
      startRow: b.top,
      startCol: b.left,
      endRow: clamp(lastRow, 0, displaySheet.rowCount - 1),
      endCol: clamp(lastCol, 0, displaySheet.colCount - 1),
    });
  }, [selection, displaySheet, applyCellUpdates]);

  // ---------------------------------------------------------------------
  // Structural ops (insert / delete row + column)
  // ---------------------------------------------------------------------

  const insertRowAt = useCallback(
    (before: number, count = 1) => {
      if (!displaySheet) return;
      applyOp({ type: "insertRow", sheetId: displaySheet.id, before, count });
    },
    [applyOp, displaySheet]
  );
  const deleteRowsAt = useCallback(
    (index: number, count = 1) => {
      if (!displaySheet) return;
      applyOp({ type: "deleteRow", sheetId: displaySheet.id, index, count });
    },
    [applyOp, displaySheet]
  );
  const insertColAt = useCallback(
    (before: number, count = 1) => {
      if (!displaySheet) return;
      applyOp({ type: "insertCol", sheetId: displaySheet.id, before, count });
    },
    [applyOp, displaySheet]
  );
  const deleteColsAt = useCallback(
    (index: number, count = 1) => {
      if (!displaySheet) return;
      applyOp({ type: "deleteCol", sheetId: displaySheet.id, index, count });
    },
    [applyOp, displaySheet]
  );

  // Merge / unmerge — toggles based on selection. If the selection
  // intersects any existing merge, we unmerge (so the user can "undo" a
  // bad merge from the same button). Otherwise we merge — but only when
  // there's at least 2 cells selected, since merging a single cell is a
  // no-op in Excel.
  const selectionMergeState = useMemo<"merge" | "unmerge" | "noop">(() => {
    if (!displaySheet || !selection) return "noop";
    const b = rangeBounds(selection);
    const intersects = displaySheet.merges.some(
      (m) => m.top <= b.bottom && m.bottom >= b.top && m.left <= b.right && m.right >= b.left
    );
    if (intersects) return "unmerge";
    if (b.top === b.bottom && b.left === b.right) return "noop";
    return "merge";
  }, [displaySheet, selection]);

  const toggleMerge = useCallback(() => {
    if (!displaySheet || !selection) return;
    const b = rangeBounds(selection);
    if (selectionMergeState === "merge") {
      applyOp({
        type: "mergeCells",
        sheetId: displaySheet.id,
        top: b.top,
        left: b.left,
        bottom: b.bottom,
        right: b.right,
      });
    } else if (selectionMergeState === "unmerge") {
      applyOp({
        type: "unmergeCells",
        sheetId: displaySheet.id,
        top: b.top,
        left: b.left,
        bottom: b.bottom,
        right: b.right,
      });
    }
  }, [displaySheet, selection, selectionMergeState, applyOp]);

  // ---------------------------------------------------------------------
  // Zoom + export
  // ---------------------------------------------------------------------

  const decreaseZoom = useCallback(() => {
    setZoom((current) => {
      const idx = ZOOM_LEVELS.indexOf(current as (typeof ZOOM_LEVELS)[number]);
      return idx > 0 ? ZOOM_LEVELS[idx - 1] : ZOOM_LEVELS[0];
    });
  }, []);
  const increaseZoom = useCallback(() => {
    setZoom((current) => {
      const idx = ZOOM_LEVELS.indexOf(current as (typeof ZOOM_LEVELS)[number]);
      return idx >= 0 && idx < ZOOM_LEVELS.length - 1
        ? ZOOM_LEVELS[idx + 1]
        : ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
    });
  }, []);

  const handleExport = useCallback(async () => {
    const bytes = xlsxBytesRef.current;
    const state = editorStateRef.current ?? { version: 1 as const };
    if (!bytes) {
      notify.error("Workbook bytes are not loaded yet");
      return;
    }
    setIsExporting(true);
    try {
      const blob = await exportEditedWorkbook(bytes, state, file.name);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      // OS save dialog is the success signal.
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to export workbook";
      notify.error(message);
    } finally {
      setIsExporting(false);
    }
  }, [file.name]);

  useEffect(() => {
    const handler = () => {
      void handleExport();
    };
    window.addEventListener("doxmind:export-xlsx", handler);
    return () => window.removeEventListener("doxmind:export-xlsx", handler);
  }, [handleExport]);

  // ---------------------------------------------------------------------
  // Workspace-level keyboard handler
  // ---------------------------------------------------------------------

  const handleGridKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (editing) return;
      if (!displaySheet) return;

      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        const k = event.key.toLowerCase();
        if (k === "z") {
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
          return;
        }
        if (k === "y") {
          event.preventDefault();
          redo();
          return;
        }
        if (k === "a") {
          event.preventDefault();
          selectAll();
          return;
        }
        if (k === "f") {
          event.preventDefault();
          openFindPanel();
          return;
        }
        if (k === "h") {
          // Convention from Excel — ⌘H also opens find/replace.
          event.preventDefault();
          openFindPanel();
          return;
        }
        if (k === "k") {
          event.preventDefault();
          promptInsertLink();
          return;
        }
        if (k === "b") {
          event.preventDefault();
          toggleBold();
          return;
        }
        if (k === "i") {
          event.preventDefault();
          toggleItalic();
          return;
        }
        if (k === "u") {
          event.preventDefault();
          toggleUnderline();
          return;
        }
        if (k === "c") {
          event.preventDefault();
          void copyRangeToClipboard();
          return;
        }
        if (k === "v") {
          event.preventDefault();
          void pasteFromClipboardIntoRange();
          return;
        }
        if (k === "x") {
          event.preventDefault();
          void copyRangeToClipboard().then(() => clearRange());
          return;
        }
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-1, 0, { extend: event.shiftKey });
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(1, 0, { extend: event.shiftKey });
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveSelection(0, -1, { extend: event.shiftKey });
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveSelection(0, 1, { extend: event.shiftKey });
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        moveSelection(0, event.shiftKey ? -1 : 1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        moveSelection(event.shiftKey ? -1 : 1, 0);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (paintStyle) {
          // First disarm the format painter — it's the most surprising
          // mode to leave on by accident.
          setPaintStyle(null);
          return;
        }
        if (
          selection &&
          (selection.startRow !== selection.endRow || selection.startCol !== selection.endCol)
        ) {
          // Collapse a multi-cell range first; second Escape clears selection.
          setSelection(singleCellRange(selection.startRow, selection.startCol));
        } else {
          setSelection(null);
        }
        return;
      }
      if (event.key === "F2") {
        event.preventDefault();
        if (anchor) beginEdit(anchor.row, anchor.col);
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        clearRange();
        return;
      }
      if (event.key.length === 1) {
        event.preventDefault();
        if (anchor) beginEdit(anchor.row, anchor.col, { initialChar: event.key });
      }
    },
    [
      editing,
      displaySheet,
      anchor,
      selection,
      moveSelection,
      beginEdit,
      clearRange,
      toggleBold,
      toggleItalic,
      toggleUnderline,
      copyRangeToClipboard,
      pasteFromClipboardIntoRange,
      undo,
      redo,
      selectAll,
      openFindPanel,
      promptInsertLink,
      paintStyle,
    ]
  );

  // ---------------------------------------------------------------------
  // Context menu helpers
  // ---------------------------------------------------------------------

  const openContextMenu = useCallback(
    (payload: ContextMenuState) => {
      // Snap selection to whatever was right-clicked if it's outside the
      // current range — Excel does the same. Multi-cell selections are
      // preserved when the click lands inside.
      setSelection((prev) => {
        if (!prev) return singleCellRange(payload.row, payload.col);
        const b = rangeBounds(prev);
        if (
          payload.row >= b.top &&
          payload.row <= b.bottom &&
          payload.col >= b.left &&
          payload.col <= b.right
        ) {
          return prev;
        }
        if (payload.surface === "row-header" && displaySheet) {
          return {
            startRow: payload.row,
            startCol: 0,
            endRow: payload.row,
            endCol: Math.max(0, displaySheet.colCount - 1),
          };
        }
        if (payload.surface === "col-header" && displaySheet) {
          return {
            startRow: 0,
            startCol: payload.col,
            endRow: Math.max(0, displaySheet.rowCount - 1),
            endCol: payload.col,
          };
        }
        return singleCellRange(payload.row, payload.col);
      });
      setContextMenu(payload);
    },
    [displaySheet]
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Insert/delete actions wired to the *current selection* so the user can
  // also drive them from the format toolbar / keyboard.
  const insertRowAbove = useCallback(() => {
    if (!selection) return;
    const b = rangeBounds(selection);
    insertRowAt(b.top, b.bottom - b.top + 1);
  }, [selection, insertRowAt]);
  const insertRowBelow = useCallback(() => {
    if (!selection) return;
    const b = rangeBounds(selection);
    insertRowAt(b.bottom + 1, b.bottom - b.top + 1);
  }, [selection, insertRowAt]);
  const deleteRows = useCallback(() => {
    if (!selection) return;
    const b = rangeBounds(selection);
    deleteRowsAt(b.top, b.bottom - b.top + 1);
  }, [selection, deleteRowsAt]);
  const insertColLeft = useCallback(() => {
    if (!selection) return;
    const b = rangeBounds(selection);
    insertColAt(b.left, b.right - b.left + 1);
  }, [selection, insertColAt]);
  const insertColRight = useCallback(() => {
    if (!selection) return;
    const b = rangeBounds(selection);
    insertColAt(b.right + 1, b.right - b.left + 1);
  }, [selection, insertColAt]);
  const deleteCols = useCallback(() => {
    if (!selection) return;
    const b = rangeBounds(selection);
    deleteColsAt(b.left, b.right - b.left + 1);
  }, [selection, deleteColsAt]);

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  const cellRefLabel = anchor ? `${columnLabel(anchor.col)}${anchor.row + 1}` : "";
  const canUndo = history.length > 0;
  const canRedo = future.length > 0;

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* Top toolbar — split into two rows by frequency. Row 1 holds the
          high-frequency cell-formatting cluster (font, B/I/U, colors,
          alignment, borders, merge, clear). Row 2 holds the
          data/view/operations cluster (validation, filter, freeze, Σ,
          sort, format painter, link, rotation, zoom). Each row scrolls
          horizontally on narrow displays. */}
      <div className="bg-sidebar flex shrink-0 flex-col border-b border-border/60">
        <div className="flex h-9 items-center gap-2 overflow-x-auto px-3">
          {isExporting && (
            <span className="text-ui-xs flex shrink-0 items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Exporting…
            </span>
          )}

          <div className="flex shrink-0 items-center gap-1">
            {/* Undo / Redo */}
            <Tooltip content="Undo (⌘Z)" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md"
                onClick={undo}
                disabled={!canUndo}
                aria-label="Undo"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content="Redo (⌘⇧Z)" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md"
                onClick={redo}
                disabled={!canRedo}
                aria-label="Redo"
              >
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>

            <ToolbarSeparator />

            {/* Number formats */}
            <Tooltip content="Format as currency" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md"
                onClick={() => applyNumberFormatToRange(QUICK_CURRENCY_FORMAT)}
                disabled={!selection}
                aria-label="Format as currency"
              >
                <DollarSign className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content="Format as percent" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md"
                onClick={() => applyNumberFormatToRange(QUICK_PERCENT_FORMAT)}
                disabled={!selection}
                aria-label="Format as percent"
              >
                <Percent className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content="Decrease decimal places" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md font-mono text-xs"
                onClick={() => adjustDecimalsForRange(-1)}
                disabled={!selection}
                aria-label="Decrease decimal places"
              >
                .0−
              </Button>
            </Tooltip>
            <Tooltip content="Increase decimal places" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md font-mono text-xs"
                onClick={() => adjustDecimalsForRange(1)}
                disabled={!selection}
                aria-label="Increase decimal places"
              >
                .0+
              </Button>
            </Tooltip>
            <ExcelMenuButton
              tooltip="More formats"
              disabled={!selection}
              width={260}
              trigger={<span className="font-mono text-xs">123</span>}
              items={NUMBER_FORMAT_PRESETS.map((preset) => ({
                id: preset.id,
                label: preset.label,
                example: preset.example,
                onSelect: () => applyNumberFormatToRange(preset.format),
              }))}
            />

            <ToolbarSeparator />

            {/* Font family */}
            <ExcelFontFamilyButton
              value={effectiveStyleForAnchor?.fontFamily}
              disabled={!selection}
              onChange={setFontFamily}
            />

            <ToolbarSeparator />

            {/* Font size */}
            <Tooltip content="Decrease font size" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md"
                onClick={() => adjustFontSize(-1)}
                disabled={!selection}
                aria-label="Decrease font size"
              >
                <span className="text-base leading-none">−</span>
              </Button>
            </Tooltip>
            <div className="text-ui-xs flex h-7 min-w-9 items-center justify-center rounded-md border border-border/70 bg-background px-2 font-semibold text-muted-foreground">
              {effectiveStyleForAnchor?.fontSize ?? DEFAULT_FONT_SIZE}
            </div>
            <Tooltip content="Increase font size" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md"
                onClick={() => adjustFontSize(1)}
                disabled={!selection}
                aria-label="Increase font size"
              >
                <span className="text-base leading-none">+</span>
              </Button>
            </Tooltip>

            <ToolbarSeparator />

            {/* Bold / Italic / Underline / Strikethrough */}
            <Tooltip content="Bold (⌘B)" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 rounded-md",
                  effectiveStyleForAnchor?.bold && "bg-foreground/[0.08] text-foreground"
                )}
                onClick={toggleBold}
                disabled={!selection}
                aria-label="Bold"
              >
                <Bold className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content="Italic (⌘I)" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 rounded-md",
                  effectiveStyleForAnchor?.italic && "bg-foreground/[0.08] text-foreground"
                )}
                onClick={toggleItalic}
                disabled={!selection}
                aria-label="Italic"
              >
                <Italic className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content="Underline (⌘U)" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 rounded-md",
                  effectiveStyleForAnchor?.underline && "bg-foreground/[0.08] text-foreground"
                )}
                onClick={toggleUnderline}
                disabled={!selection}
                aria-label="Underline"
              >
                <Underline className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content="Strikethrough" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 rounded-md",
                  effectiveStyleForAnchor?.strikethrough && "bg-foreground/[0.08] text-foreground"
                )}
                onClick={toggleStrikethrough}
                disabled={!selection}
                aria-label="Strikethrough"
              >
                <Strikethrough className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>

            {/* Color pickers */}
            <ExcelColorPicker
              tooltip="Text color"
              value={effectiveStyleForAnchor?.color}
              fallbackBar="currentColor"
              swatches={TEXT_COLOR_SWATCHES}
              resetLabel="Reset color"
              disabled={!selection}
              onChange={setTextColor}
            >
              <Baseline className="h-3.5 w-3.5" />
            </ExcelColorPicker>
            <ExcelColorPicker
              tooltip="Fill color"
              value={effectiveStyleForAnchor?.background}
              fallbackBar="transparent"
              swatches={FILL_COLOR_SWATCHES}
              resetLabel="No fill"
              disabled={!selection}
              onChange={setFillColor}
            >
              <PaintBucket className="h-3.5 w-3.5" />
            </ExcelColorPicker>

            <ToolbarSeparator />

            {/* Horizontal alignment */}
            <Tooltip content="Align left" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 rounded-md",
                  effectiveStyleForAnchor?.textAlign === "left" &&
                    "bg-foreground/[0.08] text-foreground"
                )}
                onClick={() => setAlign("left")}
                disabled={!selection}
                aria-label="Align left"
              >
                <AlignLeft className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content="Align center" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 rounded-md",
                  effectiveStyleForAnchor?.textAlign === "center" &&
                    "bg-foreground/[0.08] text-foreground"
                )}
                onClick={() => setAlign("center")}
                disabled={!selection}
                aria-label="Align center"
              >
                <AlignCenter className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content="Align right" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 rounded-md",
                  effectiveStyleForAnchor?.textAlign === "right" &&
                    "bg-foreground/[0.08] text-foreground"
                )}
                onClick={() => setAlign("right")}
                disabled={!selection}
                aria-label="Align right"
              >
                <AlignRight className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>

            {/* Vertical alignment */}
            <Tooltip content="Align top" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 rounded-md",
                  effectiveStyleForAnchor?.verticalAlign === "top" &&
                    "bg-foreground/[0.08] text-foreground"
                )}
                onClick={() => setVerticalAlign("top")}
                disabled={!selection}
                aria-label="Align top"
              >
                <AlignStartVertical className="h-3.5 w-3.5 rotate-90" />
              </Button>
            </Tooltip>
            <Tooltip content="Align middle" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 rounded-md",
                  effectiveStyleForAnchor?.verticalAlign === "middle" &&
                    "bg-foreground/[0.08] text-foreground"
                )}
                onClick={() => setVerticalAlign("middle")}
                disabled={!selection}
                aria-label="Align middle"
              >
                <AlignVerticalJustifyCenter className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content="Align bottom" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 rounded-md",
                  effectiveStyleForAnchor?.verticalAlign === "bottom" &&
                    "bg-foreground/[0.08] text-foreground"
                )}
                onClick={() => setVerticalAlign("bottom")}
                disabled={!selection}
                aria-label="Align bottom"
              >
                <AlignEndVertical className="h-3.5 w-3.5 rotate-90" />
              </Button>
            </Tooltip>

            {/* Borders */}
            <ExcelBordersButton disabled={!selection} onPattern={applyBorderPattern} />

            {/* Merge cells */}
            <Tooltip
              content={selectionMergeState === "unmerge" ? "Unmerge cells" : "Merge cells"}
              side="bottom"
            >
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 rounded-md",
                  selectionMergeState === "unmerge" && "bg-foreground/[0.08] text-foreground"
                )}
                onClick={toggleMerge}
                disabled={selectionMergeState === "noop"}
                aria-label={selectionMergeState === "unmerge" ? "Unmerge cells" : "Merge cells"}
              >
                {selectionMergeState === "unmerge" ? (
                  <Split className="h-3.5 w-3.5" />
                ) : (
                  <Merge className="h-3.5 w-3.5" />
                )}
              </Button>
            </Tooltip>

            {/* Text overflow — cycles clip → wrap → overflow → clip. The
              click toggles via `cycleTextOverflow`; the dropdown carat
              opens an explicit menu. */}
            <ExcelMenuButton
              tooltip={`Text overflow (${currentTextOverflow})`}
              disabled={!selection}
              width={200}
              trigger={
                <span
                  className={cn(
                    "flex h-3.5 w-3.5 items-center justify-center rounded-sm",
                    currentTextOverflow !== "clip" && "bg-foreground/[0.08] text-foreground"
                  )}
                >
                  <WrapText className="h-3.5 w-3.5" />
                </span>
              }
              items={[
                {
                  id: "clip",
                  label: "Clip (truncate)",
                  active: currentTextOverflow === "clip",
                  onSelect: () => setTextOverflow("clip"),
                },
                {
                  id: "wrap",
                  label: "Wrap",
                  active: currentTextOverflow === "wrap",
                  onSelect: () => setTextOverflow("wrap"),
                },
                {
                  id: "overflow",
                  label: "Overflow",
                  active: currentTextOverflow === "overflow",
                  onSelect: () => setTextOverflow("overflow"),
                },
              ]}
            />

            <ToolbarSeparator />

            <Tooltip content="Clear (Delete)" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md"
                onClick={clearRange}
                disabled={!selection}
                aria-label="Clear range"
              >
                <Eraser className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
          </div>
        </div>

        {/* Row 2 — operations / data tools / view */}
        <div className="flex h-9 items-center gap-2 overflow-x-auto border-t border-border/40 px-3">
          <div className="flex shrink-0 items-center gap-1">
            {/* Data validation (list) */}
            <Tooltip content="Data validation (list)" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md"
                onClick={promptListValidation}
                disabled={!selection}
                aria-label="Data validation (list)"
              >
                <span className="font-mono text-xs">⌃▾</span>
              </Button>
            </Tooltip>

            {/* Filter — toggle the per-column filter dropdowns */}
            <Tooltip content={sheetFilterMode ? "Turn off filter" : "Filter"} side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 rounded-md",
                  sheetFilterMode && "bg-foreground/[0.08] text-foreground"
                )}
                onClick={toggleFilterMode}
                disabled={!displaySheet}
                aria-pressed={sheetFilterMode}
                aria-label="Toggle filter"
              >
                <FilterIcon className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>

            {/* Conditional formatting — preset rules anchored at selection */}
            <ExcelMenuButton
              tooltip="Conditional formatting"
              disabled={!selection}
              width={260}
              trigger={<Palette className="h-3.5 w-3.5" />}
              items={[
                {
                  id: "gt",
                  label: "Greater than…",
                  example: "> N",
                  onSelect: cfPresetGreaterThan,
                },
                {
                  id: "lt",
                  label: "Less than…",
                  example: "< N",
                  onSelect: cfPresetLessThan,
                },
                {
                  id: "between",
                  label: "Between…",
                  example: "[a, b]",
                  onSelect: cfPresetBetween,
                },
                {
                  id: "contains",
                  label: "Text contains…",
                  example: "abc",
                  onSelect: cfPresetContainsText,
                },
                {
                  id: "duplicates",
                  label: "Duplicate values",
                  onSelect: cfPresetDuplicates,
                },
                {
                  id: "color-scale",
                  label: "Color scale (red→yellow→green)",
                  onSelect: cfPresetColorScaleRG,
                },
                {
                  id: "clear",
                  label: "Clear rules in selection",
                  onSelect: clearConditionalFormatsForSelection,
                },
              ]}
            />

            {/* Cell comment / note */}
            <Tooltip content="Comment" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md"
                onClick={promptCellComment}
                disabled={!selection}
                aria-label="Comment"
              >
                <MessageSquarePlus className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>

            {/* View → Freeze panes */}
            <ExcelMenuButton
              tooltip="Freeze"
              disabled={!displaySheet}
              width={240}
              trigger={<span className="font-mono text-[10px] font-semibold leading-none">⫼</span>}
              items={[
                {
                  id: "none",
                  label: "No freeze",
                  active: sheetFreeze.row === 0 && sheetFreeze.col === 0,
                  onSelect: () => setFrozenPanes(0, 0),
                },
                {
                  id: "row1",
                  label: "Freeze 1 row",
                  active: sheetFreeze.row === 1 && sheetFreeze.col === 0,
                  onSelect: () => setFrozenPanes(1, sheetFreeze.col),
                },
                {
                  id: "row2",
                  label: "Freeze 2 rows",
                  active: sheetFreeze.row === 2 && sheetFreeze.col === 0,
                  onSelect: () => setFrozenPanes(2, sheetFreeze.col),
                },
                {
                  id: "uptoRow",
                  label: anchor ? `Freeze up to row ${anchor.row + 1}` : "Freeze up to current row",
                  onSelect: () => setFrozenPanes(anchor ? anchor.row + 1 : 0, sheetFreeze.col),
                  disabled: !anchor,
                },
                {
                  id: "col1",
                  label: "Freeze 1 column",
                  active: sheetFreeze.row === 0 && sheetFreeze.col === 1,
                  onSelect: () => setFrozenPanes(sheetFreeze.row, 1),
                },
                {
                  id: "col2",
                  label: "Freeze 2 columns",
                  active: sheetFreeze.row === 0 && sheetFreeze.col === 2,
                  onSelect: () => setFrozenPanes(sheetFreeze.row, 2),
                },
                {
                  id: "uptoCol",
                  label: anchor
                    ? `Freeze up to column ${columnLabel(anchor.col)}`
                    : "Freeze up to current column",
                  onSelect: () => setFrozenPanes(sheetFreeze.row, anchor ? anchor.col + 1 : 0),
                  disabled: !anchor,
                },
              ]}
            />

            {/* Σ — quick-insert aggregate formulas */}
            <ExcelMenuButton
              tooltip="Functions"
              disabled={!selection}
              width={200}
              trigger={<Sigma className="h-3.5 w-3.5" />}
              items={[
                { id: "sum", label: "SUM", example: "Σ", onSelect: () => insertAggregateFn("SUM") },
                {
                  id: "avg",
                  label: "AVERAGE",
                  example: "x̄",
                  onSelect: () => insertAggregateFn("AVERAGE"),
                },
                {
                  id: "count",
                  label: "COUNT",
                  example: "#",
                  onSelect: () => insertAggregateFn("COUNT"),
                },
                { id: "max", label: "MAX", example: "▲", onSelect: () => insertAggregateFn("MAX") },
                { id: "min", label: "MIN", example: "▼", onSelect: () => insertAggregateFn("MIN") },
              ]}
            />

            {/* Sort */}
            <Tooltip content="Sort A → Z (by leftmost column)" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md"
                onClick={() => sortRangeBy("asc")}
                disabled={!selection}
                aria-label="Sort A to Z"
              >
                <ArrowDownAZ className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content="Sort Z → A (by leftmost column)" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md"
                onClick={() => sortRangeBy("desc")}
                disabled={!selection}
                aria-label="Sort Z to A"
              >
                <ArrowUpAZ className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>

            {/* Format painter */}
            <Tooltip
              content={paintStyle ? "Cancel format painter" : "Format painter"}
              side="bottom"
            >
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 rounded-md",
                  paintStyle && "bg-foreground/[0.08] text-foreground"
                )}
                onClick={togglePaintMode}
                disabled={!selection && !paintStyle}
                aria-label="Format painter"
                aria-pressed={!!paintStyle}
              >
                <Paintbrush className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>

            {/* Insert link */}
            <Tooltip content="Insert link (⌘K)" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md"
                onClick={promptInsertLink}
                disabled={!anchor}
                aria-label="Insert link"
              >
                <LinkIcon className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>

            {/* Text rotation */}
            <ExcelMenuButton
              tooltip="Text rotation"
              disabled={!selection}
              width={220}
              trigger={
                <span
                  className="inline-flex items-center font-mono text-[10px] font-semibold"
                  style={{ transform: "rotate(-20deg)" }}
                >
                  Ab
                </span>
              }
              items={[
                {
                  id: "0",
                  label: "None",
                  example: "0°",
                  onSelect: () => applyStyleToRange({ rotation: 0 }),
                },
                {
                  id: "45",
                  label: "Tilt up",
                  example: "45°",
                  onSelect: () => applyStyleToRange({ rotation: 45 }),
                },
                {
                  id: "-45",
                  label: "Tilt down",
                  example: "−45°",
                  onSelect: () => applyStyleToRange({ rotation: -45 }),
                },
                {
                  id: "90",
                  label: "Stack vertically",
                  example: "90°",
                  onSelect: () => applyStyleToRange({ rotation: 90 }),
                },
                {
                  id: "-90",
                  label: "Rotate down",
                  example: "−90°",
                  onSelect: () => applyStyleToRange({ rotation: -90 }),
                },
              ]}
            />

            <ToolbarSeparator />

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md"
              onClick={decreaseZoom}
              disabled={zoom <= ZOOM_LEVELS[0]}
              aria-label="Zoom out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <div className="text-ui-xs flex h-7 min-w-16 items-center justify-center rounded-md border border-border/70 bg-background px-2 font-semibold text-muted-foreground">
              {Math.round(zoom * 100)}%
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md"
              onClick={increaseZoom}
              disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
              aria-label="Zoom in"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Formula bar */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-3">
        <ExcelNameBox
          label={cellRefLabel}
          disabled={!displaySheet}
          onSubmit={(input) => {
            if (!displaySheet) return;
            const range = parseRangeRef(input);
            if (!range) {
              notify.error("Couldn't read that cell reference");
              return;
            }
            const maxRow = Math.max(0, displaySheet.rowCount - 1);
            const maxCol = Math.max(0, displaySheet.colCount - 1);
            setSelection({
              startRow: clamp(range.startRow, 0, maxRow),
              startCol: clamp(range.startCol, 0, maxCol),
              endRow: clamp(range.endRow, 0, maxRow),
              endCol: clamp(range.endCol, 0, maxCol),
            });
            window.requestAnimationFrame(() => cellGridRef.current?.focus());
          }}
        />
        <span className="text-ui-xs font-mono text-muted-foreground">fx</span>
        <input
          ref={formulaInputRef}
          type="text"
          value={formulaBarValue}
          disabled={!anchor}
          spellCheck={false}
          onFocus={() => {
            if (anchor && (!editing || editing.source !== "formula-bar")) {
              beginEdit(anchor.row, anchor.col, { source: "formula-bar" });
            }
          }}
          onChange={(event) => {
            if (!editing && anchor) {
              beginEdit(anchor.row, anchor.col, {
                initialChar: event.target.value,
                source: "formula-bar",
              });
              return;
            }
            updateDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            // Formula autocomplete first — same precedence as the in-cell
            // input so both editing surfaces feel identical.
            if (handleSuggestKey(event.key)) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              commitEditingCell({ dRow: event.shiftKey ? -1 : 1, dCol: 0 });
              return;
            }
            if (event.key === "Tab") {
              event.preventDefault();
              commitEditingCell({ dRow: 0, dCol: event.shiftKey ? -1 : 1 });
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancelEdit();
              return;
            }
            event.stopPropagation();
          }}
          onBlur={() => {
            if (editing?.source === "formula-bar") commitEditingCell();
          }}
          className="text-ui-sm bg-sidebar h-7 flex-1 rounded-md border border-border/70 px-2 font-mono text-foreground outline-none focus:border-primary/40"
        />
      </div>

      {/* Sheet area */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {status === "loading" && (
          <div className="flex flex-1 items-center justify-center bg-background/80 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Parsing workbook…
          </div>
        )}
        {status === "error" && (
          <div className="flex flex-1 items-center justify-center bg-background p-8 text-center text-sm text-muted-foreground">
            {errorMessage ?? "Could not open workbook."}
          </div>
        )}
        {findOpen && (
          <ExcelFindReplacePanel
            initialQuery={findQuery}
            matchCount={findMatches.length}
            currentMatch={findCurrentMatch}
            matchCaseEnabled={findMatchCase}
            matchWholeCellEnabled={findWholeCell}
            onQueryChange={setFindQuery}
            onReplaceTextChange={setFindReplace}
            onMatchCaseChange={setFindMatchCase}
            onMatchWholeCellChange={setFindWholeCell}
            onFindNext={() => advanceFind(1)}
            onFindPrev={() => advanceFind(-1)}
            onReplace={replaceCurrentMatch}
            onReplaceAll={replaceAllMatches}
            onClose={closeFindPanel}
          />
        )}
        {status === "ready" && displaySheet && (
          <ExcelSheetView
            key={displaySheet.id}
            ref={cellGridRef}
            sheet={displaySheet}
            zoom={zoom}
            cellsByCoord={cellsByCoord}
            editsByCoord={editsByCoord}
            mergeAnchors={mergeIndex.anchors}
            mergeMembers={mergeIndex.members}
            selection={selection}
            editing={editing}
            cellInputRef={cellInputRef}
            onSelectStart={onSelectStart}
            onSelectExtend={onSelectExtend}
            onSelectEnd={onSelectEnd}
            onBeginEdit={(row, col) => beginEdit(row, col)}
            onUpdateDraft={updateDraft}
            onCommitEdit={commitEditingCell}
            onCancelEdit={cancelEdit}
            onContextMenuAt={openContextMenu}
            onKeyDown={handleGridKeyDown}
            onResizeColumn={setColumnWidth}
            onResizeRow={setRowHeight}
            fillRange={fillRange}
            onAutoFillStart={beginAutoFill}
            onAutoFillExtend={extendAutoFill}
            onAutoFillEnd={commitAutoFill}
            computedValueAt={computedValueAt}
            frozenRow={Math.max(0, Math.min(displaySheet.rowCount, sheetFreeze.row))}
            frozenCol={Math.max(0, Math.min(displaySheet.colCount, sheetFreeze.col))}
            hiddenRows={hiddenRows}
            filterMode={sheetFilterMode}
            activeColumnFilters={activeColumnFilters}
            onOpenColumnFilter={(col, anchor) =>
              setFilterPopover({ col, x: anchor.x, y: anchor.y })
            }
            validationsByCoord={validationsByCoord}
            onOpenValidationPicker={(row, col, anchor) =>
              setValidationPopover({ row, col, x: anchor.x, y: anchor.y })
            }
            cfOverlayAt={cfOverlayAt}
            commentAt={commentAt}
            onSuggestKey={handleSuggestKey}
          />
        )}
      </div>

      {/* Sheet tabs */}
      {displayWorkbook && displayWorkbook.sheets.length > 0 && (
        <div className="bg-sidebar flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-t border-border/60 px-2">
          <Tooltip content="Add sheet" side="top">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 rounded-md"
              onClick={addSheet}
              aria-label="Add sheet"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <ToolbarSeparator />
          {displayWorkbook.sheets.map((sheet) => {
            const isActive = sheet.id === activeSheetId;
            return (
              <button
                key={sheet.id}
                type="button"
                className={cn(
                  "text-ui-xs flex h-7 shrink-0 items-center rounded-md border px-3 font-medium transition-colors",
                  isActive
                    ? "border-primary/40 bg-background text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-foreground/[0.04]"
                )}
                onClick={() => setActiveSheetId(sheet.id)}
                onDoubleClick={() => renameSheetById(sheet.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setActiveSheetId(sheet.id);
                  setTabContextMenu({
                    x: event.clientX,
                    y: event.clientY,
                    sheetId: sheet.id,
                  });
                }}
              >
                {sheet.name}
              </button>
            );
          })}
        </div>
      )}

      {suggestAnchor && suggestItems.length > 0 && (
        <ExcelFormulaSuggest
          anchor={suggestAnchor}
          items={suggestItems}
          selectedIndex={suggestIndex}
          onPick={acceptSuggestion}
        />
      )}

      {validationPopover &&
        displaySheet &&
        (() => {
          const v = validationsByCoord.get(coordKey(validationPopover.row, validationPopover.col));
          if (!v) {
            // Stale — popover anchor outlived the validation entry.
            return null;
          }
          return (
            <ContextMenuPortal
              x={validationPopover.x}
              y={validationPopover.y}
              onClose={() => setValidationPopover(null)}
            >
              {v.values.map((value) => (
                <ContextMenuItem
                  key={value}
                  onSelect={() => {
                    applyCellUpdates([
                      {
                        row: validationPopover.row,
                        col: validationPopover.col,
                        patch: parseDraft(value),
                      },
                    ]);
                  }}
                >
                  {value}
                </ContextMenuItem>
              ))}
            </ContextMenuPortal>
          );
        })()}

      {filterPopover && displaySheet && (
        <ExcelFilterPopover
          anchor={{ x: filterPopover.x, y: filterPopover.y }}
          uniqueValues={getColumnUniqueValues(filterPopover.col)}
          visibleValues={
            editorState?.filters?.[`${displaySheet.id}!${filterPopover.col}`] ??
            getColumnUniqueValues(filterPopover.col)
          }
          onApply={(visible) => setColumnFilter(filterPopover.col, visible)}
          onClear={() => setColumnFilter(filterPopover.col, null)}
          onClose={() => setFilterPopover(null)}
        />
      )}

      {tabContextMenu && (
        <ContextMenuPortal
          x={tabContextMenu.x}
          y={tabContextMenu.y}
          onClose={() => setTabContextMenu(null)}
        >
          <ContextMenuItem onSelect={() => renameSheetById(tabContextMenu.sheetId)}>
            Rename
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => duplicateSheetById(tabContextMenu.sheetId)}>
            Duplicate
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => deleteSheetById(tabContextMenu.sheetId)}>
            Delete
          </ContextMenuItem>
        </ContextMenuPortal>
      )}

      {dialog && <ExcelInlineDialog state={dialog} onClose={closeDialog} />}

      {/* Right-click context menu — own portal + outside-click handling so
          we don't depend on DropdownMenu's controlled-open behavior, which
          didn't reliably dismiss for anchorPoint-based menus. */}
      {contextMenu && (
        <ContextMenuPortal x={contextMenu.x} y={contextMenu.y} onClose={closeContextMenu}>
          {contextMenu.surface !== "row-header" && contextMenu.surface !== "col-header" && (
            <>
              <ContextMenuItem onSelect={() => void copyRangeToClipboard()} shortcut="⌘C">
                Copy
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => void copyRangeToClipboard().then(() => clearRange())}
                shortcut="⌘X"
              >
                Cut
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => void pasteFromClipboardIntoRange()} shortcut="⌘V">
                Paste
              </ContextMenuItem>
              <ContextMenuItem onSelect={clearRange} shortcut="⌫">
                Clear contents
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          {contextMenu.surface !== "col-header" && (
            <>
              <ContextMenuItem onSelect={insertRowAbove}>Insert row above</ContextMenuItem>
              <ContextMenuItem onSelect={insertRowBelow}>Insert row below</ContextMenuItem>
              <ContextMenuItem onSelect={deleteRows}>Delete row</ContextMenuItem>
              {contextMenu.surface !== "row-header" && <ContextMenuSeparator />}
            </>
          )}
          {contextMenu.surface !== "row-header" && (
            <>
              <ContextMenuItem onSelect={insertColLeft}>Insert column to the left</ContextMenuItem>
              <ContextMenuItem onSelect={insertColRight}>
                Insert column to the right
              </ContextMenuItem>
              <ContextMenuItem onSelect={deleteCols}>Delete column</ContextMenuItem>
            </>
          )}
          {contextMenu.surface === "cell" && (
            <>
              <ContextMenuSeparator />
              {selectionMergeState !== "noop" && (
                <ContextMenuItem onSelect={toggleMerge}>
                  {selectionMergeState === "unmerge" ? "Unmerge cells" : "Merge cells"}
                </ContextMenuItem>
              )}
              <ContextMenuItem onSelect={toggleBold} shortcut="⌘B">
                {effectiveStyleForAnchor?.bold ? "Remove bold" : "Bold"}
              </ContextMenuItem>
              <ContextMenuItem onSelect={toggleItalic} shortcut="⌘I">
                {effectiveStyleForAnchor?.italic ? "Remove italic" : "Italic"}
              </ContextMenuItem>
              <ContextMenuItem onSelect={toggleUnderline} shortcut="⌘U">
                {effectiveStyleForAnchor?.underline ? "Remove underline" : "Underline"}
              </ContextMenuItem>
            </>
          )}
        </ContextMenuPortal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom context menu (portalled to body, owns its own outside-click handling)
// ---------------------------------------------------------------------------

const ContextMenuCloseContext = createContext<() => void>(() => undefined);

interface ContextMenuPortalProps {
  x: number;
  y: number;
  onClose(): void;
  children: ReactNode;
}

function ContextMenuPortal({ x, y, onClose, children }: ContextMenuPortalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [adjusted, setAdjusted] = useState<{ left: number; top: number }>({ left: x, top: y });

  // Outside click + Escape close. We attach in the next tick so the very
  // mousedown that triggered the right-click / openContextMenu doesn't
  // immediately close the menu it just opened.
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target && containerRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const tid = window.setTimeout(() => {
      document.addEventListener("mousedown", onMouseDown, true);
      document.addEventListener("keydown", onKey, true);
    }, 0);
    return () => {
      window.clearTimeout(tid);
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  // Flip / clamp into the viewport once we've measured the menu — keeps
  // the menu fully visible when right-clicking near the right or bottom
  // edge of the window.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    setAdjusted({ left, top });
  }, [x, y]);

  return createPortal(
    <ContextMenuCloseContext.Provider value={onClose}>
      <div
        ref={containerRef}
        role="menu"
        className="animate-in fade-in-0 zoom-in-95 fixed z-50 min-w-[14rem] overflow-hidden rounded-md border border-border/60 bg-popover p-1 text-popover-foreground shadow-lg"
        style={{ left: adjusted.left, top: adjusted.top }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {children}
      </div>
    </ContextMenuCloseContext.Provider>,
    document.body
  );
}

interface ContextMenuItemProps {
  children: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  onSelect(): void;
}

function ContextMenuItem({ children, shortcut, disabled, onSelect }: ContextMenuItemProps) {
  const close = useContext(ContextMenuCloseContext);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onSelect();
        close();
      }}
      className="text-ui-sm flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="flex-1 text-left">{children}</span>
      {shortcut && <span className="ml-3 text-xs text-muted-foreground">{shortcut}</span>}
    </button>
  );
}

function ExcelInlineDialog({
  state,
  onClose,
}: {
  state: ExcelDialogState;
  onClose(value: string | boolean | null): void;
}) {
  const [draft, setDraft] = useState(state.type === "text" ? state.defaultValue : "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.type !== "text") return;
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [state]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose(state.type === "text" ? null : false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, state.type]);

  const confirm = () => onClose(state.type === "text" ? draft : true);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={state.title}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose(state.type === "text" ? null : false);
      }}
    >
      <div className="w-full max-w-sm rounded-lg border border-border/70 bg-popover p-4 text-popover-foreground shadow-xl">
        <div className="text-ui-sm font-semibold text-foreground">{state.title}</div>
        {state.description && (
          <div className="text-ui-xs mt-1 text-muted-foreground">{state.description}</div>
        )}
        {state.type === "text" && (
          <input
            ref={inputRef}
            type="text"
            value={draft}
            placeholder={state.placeholder}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                confirm();
              }
            }}
            className="text-ui-sm mt-3 h-9 w-full rounded-md border border-border/70 bg-background px-3 text-foreground outline-none focus:border-primary/50"
          />
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => onClose(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant={state.type === "confirm" && state.destructive ? "destructive" : "default"}
            onClick={confirm}
          >
            {state.confirmLabel ?? (state.type === "confirm" ? "Confirm" : "OK")}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ContextMenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-border/60" />;
}

function ToolbarSeparator() {
  return <div className="mx-1 h-5 w-px shrink-0 bg-border/60" aria-hidden />;
}

interface ExcelNameBoxProps {
  /** Current cell ref shown when the input isn't focused. */
  label: string;
  disabled?: boolean;
  onSubmit(input: string): void;
}

/** Editable name box on the formula bar. Shows the current selection's
 *  reference when unfocused; on Enter parses the input as `A1` /
 *  `A1:C10` and navigates / re-selects. Esc + blur revert. */
function ExcelNameBox({ label, disabled, onSubmit }: ExcelNameBoxProps) {
  const [draft, setDraft] = useState(label);
  const [focused, setFocused] = useState(false);
  // Sync the displayed value to the live selection while the input
  // isn't focused — without this the box would freeze on whatever the
  // user last typed even after they navigated elsewhere.
  useEffect(() => {
    if (!focused) setDraft(label);
  }, [label, focused]);
  return (
    <input
      type="text"
      value={focused ? draft : label || ""}
      placeholder="—"
      disabled={disabled}
      spellCheck={false}
      onFocus={(event) => {
        setFocused(true);
        setDraft(label);
        event.currentTarget.select();
      }}
      onBlur={() => {
        setFocused(false);
        setDraft(label);
      }}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (draft.trim()) onSubmit(draft);
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          setDraft(label);
          event.currentTarget.blur();
        }
        event.stopPropagation();
      }}
      className="text-ui-xs bg-sidebar h-7 w-20 shrink-0 rounded-md border border-border/70 px-2 text-center font-mono font-semibold text-foreground/90 outline-none focus:border-primary/40 disabled:opacity-50"
    />
  );
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

function mergeStyle(
  base: ExcelCellStyle | undefined,
  overlay: ExcelCellStyle | undefined
): ExcelCellStyle | undefined {
  if (!base && !overlay) return undefined;
  return { ...(base ?? {}), ...(overlay ?? {}) };
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceInString(
  text: string,
  needle: string,
  replacement: string,
  caseSensitive: boolean
): string {
  if (!needle) return text;
  if (caseSensitive) return text.split(needle).join(replacement);
  const re = new RegExp(escapeRegExp(needle), "gi");
  return text.replace(re, replacement);
}

/** Parse a single cell reference like "A5" or "AB12" into zero-based
 *  `{ row, col }`. Returns `null` when the input doesn't match the
 *  letters-then-digits shape — callers fall back to range parsing. */
function parseCellRef(ref: string): { row: number; col: number } | null {
  const match = /^([A-Za-z]+)([0-9]+)$/.exec(ref.trim());
  if (!match) return null;
  const letters = match[1].toUpperCase();
  const rowOneBased = Number(match[2]);
  if (!Number.isFinite(rowOneBased) || rowOneBased < 1) return null;
  let col = 0;
  for (const ch of letters) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: rowOneBased - 1, col: col - 1 };
}

/** Parse "A1:C10" into a `SelectionRange`. Single-cell input ("A1") yields
 *  a degenerate range too, so callers can always feed the result back into
 *  `setSelection`. */
function parseRangeRef(ref: string): {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
} | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  const colon = trimmed.indexOf(":");
  if (colon < 0) {
    const single = parseCellRef(trimmed);
    if (!single) return null;
    return { startRow: single.row, startCol: single.col, endRow: single.row, endCol: single.col };
  }
  const start = parseCellRef(trimmed.slice(0, colon));
  const end = parseCellRef(trimmed.slice(colon + 1));
  if (!start || !end) return null;
  return { startRow: start.row, startCol: start.col, endRow: end.row, endCol: end.col };
}

/** Sheets-style cell value comparator: numbers numerically, strings via
 *  `localeCompare`, booleans (FALSE < TRUE), `null` last. Mixed-type rows
 *  fall back to a stable bucketing so the result stays deterministic. */
function compareCellValues(
  a: string | number | boolean | null | undefined,
  b: string | number | boolean | null | undefined
): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  // Coerce to numbers when both are numeric-looking strings.
  const an = typeof a === "string" ? Number(a) : a;
  const bn = typeof b === "string" ? Number(b) : b;
  if (typeof an === "number" && typeof bn === "number" && !Number.isNaN(an) && !Number.isNaN(bn)) {
    return an - bn;
  }
  return String(a).localeCompare(String(b));
}
