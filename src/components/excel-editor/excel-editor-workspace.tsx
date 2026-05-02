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
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  Italic,
  Loader2,
  Redo2,
  Underline,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { getDisplayName } from "@/lib/document-types";
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
  rangeBounds,
  rangeOrigin,
  singleCellRange,
  type EditAdvance,
  type EditingCell,
  type ExcelCellPatch,
  type SelectionRange,
} from "@/lib/excel/state";
import {
  ExcelSheetView,
  columnLabel,
  coordKey,
  formatCellValue,
  formulaOrValueAsString,
  parseDraft,
} from "@/components/excel-editor/excel-sheet-view";
import {
  createStorageAdapter,
  type ExcelCellStyle,
  type ExcelEditorState,
  type ExcelStructuralOp,
} from "@/lib/storage";
import { cn } from "@/lib/utils";
import { useFileStore, type FileItem } from "@/stores/file-store";

interface ExcelEditorWorkspaceProps {
  file: FileItem;
}

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const SIDECAR_DEBOUNCE_MS = 350;
const HISTORY_LIMIT = 50;

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
  const workspaceMode = useFileStore((s) => s.workspaceMode);
  const workspaceRoot = useFileStore((s) => s.workspaceRoot);

  const adapter = useMemo(
    () =>
      createStorageAdapter({
        mode: workspaceMode,
        disk: { root: workspaceRoot },
      }),
    [workspaceMode, workspaceRoot]
  );

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

  const xlsxBytesRef = useRef<Uint8Array | null>(null);
  const editorStateRef = useRef<ExcelEditorState | null>(null);
  const editingRef = useRef<EditingCell | null>(null);
  const selectionRef = useRef<SelectionRange | null>(null);
  const cellGridRef = useRef<HTMLDivElement>(null);
  const cellInputRef = useRef<HTMLInputElement>(null);
  const formulaInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    editorStateRef.current = editorState;
  }, [editorState]);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

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
        const bytes = await adapter.readBinary!(handle);
        if (cancelled) return;
        xlsxBytesRef.current = bytes;
        const parsed = await fetchExcelWorkbook(bytes, file.name, controller.signal);
        const sidecar = adapter.readExcelEditorState
          ? await adapter.readExcelEditorState(handle).catch(() => null)
          : null;
        if (cancelled) return;
        setWorkbook(parsed);
        setEditorState(sidecar);
        setActiveSheetId(sidecar?.activeSheetId ?? parsed.sheets[0]?.id ?? null);
        setSelection(singleCellRange(0, 0));
        setStatus("ready");
        if (parsed.truncated.sheets) {
          toast.message("Some sheets were hidden", {
            description: "doXmind currently shows the first 64 sheets in a workbook.",
          });
        }
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
  }, [adapter, file.name, file.storageHandle]);

  const activeSheet = useMemo<ExcelSheetDto | null>(() => {
    if (!workbook || !activeSheetId) return null;
    return workbook.sheets.find((s) => s.id === activeSheetId) ?? workbook.sheets[0] ?? null;
  }, [workbook, activeSheetId]);

  // The sheet the renderer reads from = parsed sheet with structural ops
  // applied. Cells, merges, row/col counts and dimension overrides all
  // already use post-op coordinates.
  const displaySheet = useMemo<ExcelSheetDto | null>(() => {
    if (!activeSheet) return null;
    return applyOpsToSheet(activeSheet, editorState?.ops);
  }, [activeSheet, editorState?.ops]);

  // ---------------------------------------------------------------------
  // History-aware editorState mutation
  // ---------------------------------------------------------------------

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
  }, []);

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
  const setAlign = useCallback(
    (textAlign: "left" | "center" | "right") => applyStyleToRange({ textAlign }),
    [applyStyleToRange]
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
        row.push(formatCellValue(cell, patch));
      }
      lines.push(row.join("\t"));
    }
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast.error("Clipboard write was blocked");
    }
    return text;
  }, [selection, displaySheet, cellsByCoord, editsByCoord]);

  const pasteFromClipboardIntoRange = useCallback(async () => {
    if (!selection || !displaySheet) return;
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      toast.error("Clipboard read was blocked");
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
      toast.error("Workbook bytes are not loaded yet");
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
      toast.success("Exported workbook");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to export workbook";
      toast.error(message);
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

  const displayName = getDisplayName(file.name);
  const cellRefLabel = anchor ? `${columnLabel(anchor.col)}${anchor.row + 1}` : "";
  const canUndo = history.length > 0;
  const canRedo = future.length > 0;

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* Top toolbar */}
      <div className="bg-sidebar flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <span className="text-ui-xs flex-1 truncate font-semibold text-foreground/90">
          {displayName}
        </span>
        {isExporting && (
          <span className="text-ui-xs flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Exporting…
          </span>
        )}
        <div className="flex items-center gap-1">
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

          <div className="mx-1 h-5 w-px bg-border/60" />

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

          <div className="mx-1 h-5 w-px bg-border/60" />

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

          <div className="mx-1 h-5 w-px bg-border/60" />

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

          <div className="mx-1 h-5 w-px bg-border/60" />

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

      {/* Formula bar */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-3">
        <div className="text-ui-xs bg-sidebar flex h-7 min-w-12 items-center justify-center rounded-md border border-border/70 px-2 font-mono font-semibold text-muted-foreground">
          {cellRefLabel || "—"}
        </div>
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
        {status === "ready" && displaySheet && (
          <ExcelSheetView
            key={displaySheet.id}
            ref={cellGridRef}
            sheet={displaySheet}
            zoom={zoom}
            cellsByCoord={cellsByCoord}
            editsByCoord={editsByCoord}
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
          />
        )}
      </div>

      {/* Sheet tabs */}
      {workbook && workbook.sheets.length > 0 && (
        <div className="bg-sidebar flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-t border-border/60 px-2">
          {workbook.sheets.map((sheet) => {
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
              >
                {sheet.name}
              </button>
            );
          })}
        </div>
      )}

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

function ContextMenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-border/60" />;
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
