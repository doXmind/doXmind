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
  Italic,
  Link as LinkIcon,
  Loader2,
  Merge,
  PaintBucket,
  Paintbrush,
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
  type ExcelCellStyle,
  type ExcelEditorState,
  type ExcelStructuralOp,
  type ExcelWorkbookOp,
} from "@/lib/storage";
import { cn } from "@/lib/utils";
import { useFileStore, type FileItem } from "@/stores/file-store";

interface ExcelEditorWorkspaceProps {
  file: FileItem;
}

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const SIDECAR_DEBOUNCE_MS = 350;
const HISTORY_LIMIT = 50;

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48] as const;
const DEFAULT_FONT_SIZE = 11;

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

  // Right-click context menu over a sheet tab — separate from the main
  // grid context menu so the surface enums don't collide.
  const [tabContextMenu, setTabContextMenu] = useState<{
    x: number;
    y: number;
    sheetId: string;
  } | null>(null);

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
    (sheetId: string) => {
      if (!displayWorkbook) return;
      const sheet = displayWorkbook.sheets.find((s) => s.id === sheetId);
      if (!sheet) return;
      // For the spike we lean on `prompt` instead of building a modal —
      // gets us inline editing semantics for free, and matches Excel's
      // own modal flow closely enough.
      const next = window.prompt("Rename sheet", sheet.name);
      if (!next) return;
      const trimmed = next.trim();
      if (!trimmed || trimmed === sheet.name) return;
      const taken = displayWorkbook.sheets.some(
        (s) => s.id !== sheetId && s.name.toLowerCase() === trimmed.toLowerCase()
      );
      if (taken) {
        toast.error("A sheet with that name already exists");
        return;
      }
      applyWorkbookOpAndPersist({ type: "renameSheet", sheetId, name: trimmed });
    },
    [displayWorkbook, applyWorkbookOpAndPersist]
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
    (sheetId: string) => {
      if (!displayWorkbook) return;
      if (displayWorkbook.sheets.length <= 1) {
        toast.error("A workbook must have at least one sheet");
        return;
      }
      const sheet = displayWorkbook.sheets.find((s) => s.id === sheetId);
      if (!sheet) return;
      const ok = window.confirm(`Delete "${sheet.name}"? This can't be undone after saving.`);
      if (!ok) return;
      applyWorkbookOpAndPersist({ type: "deleteSheet", sheetId });
    },
    [displayWorkbook, applyWorkbookOpAndPersist]
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
      consider(cell.row, cell.col, formatCellValue(cell, patch));
    }
    // Cells that exist only in the patch overlay (user-typed into a
    // previously empty cell).
    for (const [key, patch] of editsByCoord.entries()) {
      if (visited.has(key)) continue;
      const [rowStr, colStr] = key.split(":");
      const row = Number(rowStr);
      const col = Number(colStr);
      consider(row, col, formatCellValue(undefined, patch));
    }
    matches.sort((a, b) => a.row - b.row || a.col - b.col);
    return matches;
  }, [findOpen, displaySheet, findQuery, findMatchCase, findWholeCell, editsByCoord]);

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
      const text = formatCellValue(cell, patch);
      if (text) setFindQuery(text);
    }
  }, [anchor, findQuery, cellsByCoord, editsByCoord]);

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
    const currentText = formatCellValue(cell, patch);
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
  ]);

  const replaceAllMatches = useCallback(() => {
    if (!displaySheet || findMatches.length === 0) return;
    const updates: CellUpdate[] = [];
    for (const match of findMatches) {
      const cell = cellsByCoord.get(coordKey(match.row, match.col));
      const patch = editsByCoord.get(coordKey(match.row, match.col));
      if (patch?.formula || cell?.formula) continue;
      const currentText = formatCellValue(cell, patch);
      const nextText = findWholeCell
        ? findReplace
        : replaceInString(currentText, findQuery, findReplace, findMatchCase);
      if (nextText === currentText) continue;
      updates.push({ row: match.row, col: match.col, patch: parseDraft(nextText) });
    }
    if (updates.length === 0) return;
    applyCellUpdates(updates);
    toast.success(`Replaced ${updates.length} ${updates.length === 1 ? "match" : "matches"}`);
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
  const toggleWrapText = useCallback(
    () => applyStyleToRange({ wrapText: !effectiveStyleForAnchor?.wrapText }),
    [applyStyleToRange, effectiveStyleForAnchor]
  );
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
        toast.error("No empty cell adjacent to the selection — extend the sheet first");
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
        toast.message("Select more than one row to sort");
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
      const formulaRowCount = rows.filter((r) => r.hasFormula).length;
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
      if (formulaRowCount > 0) {
        toast.message(`Sorted ${updates.length / (b.right - b.left + 1)} rows`, {
          description: `${formulaRowCount} row(s) with formulas were left in place.`,
        });
      }
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
      toast.message("Select a cell with formatting first");
      return;
    }
    setPaintStyle({ ...effectiveStyleForAnchor });
    toast.message("Format painter armed", {
      description: "Click or drag to paint the captured style. Esc to cancel.",
    });
  }, [paintStyle, effectiveStyleForAnchor]);

  // -------------------------------------------------------------------
  // Insert link ⌘K — wraps the cell value as a hyperlink. The link itself
  // lives in `style.hyperlink`; the renderer styles the cell as a link
  // (underline + primary color) and the backend writes it via openpyxl's
  // `cell.hyperlink`. Empty input clears the existing link.
  // -------------------------------------------------------------------
  const promptInsertLink = useCallback(() => {
    if (!displaySheet || !anchor) return;
    const cell = cellsByCoord.get(coordKey(anchor.row, anchor.col));
    const patch = editsByCoord.get(coordKey(anchor.row, anchor.col));
    const currentLink = patch?.style?.hyperlink ?? cell?.style?.hyperlink ?? "";
    const next = window.prompt("Link URL (leave empty to remove)", currentLink);
    if (next === null) return; // user cancelled
    const trimmed = next.trim();
    applyCellUpdates([
      {
        row: anchor.row,
        col: anchor.col,
        patch: { style: { hyperlink: trimmed.length > 0 ? trimmed : undefined } },
      },
    ]);
  }, [displaySheet, anchor, cellsByCoord, editsByCoord, applyCellUpdates]);

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

  const displayName = getDisplayName(file.name);
  const cellRefLabel = anchor ? `${columnLabel(anchor.col)}${anchor.row + 1}` : "";
  const canUndo = history.length > 0;
  const canRedo = future.length > 0;

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* Top toolbar — packed cluster matching Sheets / Excel. Allowed to
          horizontally scroll on narrow displays so we never have to hide
          actions behind a "more" overflow menu. */}
      <div className="bg-sidebar flex h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-border/60 px-3">
        <span className="text-ui-xs max-w-[160px] shrink truncate font-semibold text-foreground/90">
          {displayName}
        </span>
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

          {/* Wrap text */}
          <Tooltip content="Wrap text" side="bottom">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-7 w-7 rounded-md",
                effectiveStyleForAnchor?.wrapText && "bg-foreground/[0.08] text-foreground"
              )}
              onClick={toggleWrapText}
              disabled={!selection}
              aria-label="Wrap text"
            >
              <WrapText className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>

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

          <ToolbarSeparator />

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
          <Tooltip content={paintStyle ? "Cancel format painter" : "Format painter"} side="bottom">
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

function ContextMenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-border/60" />;
}

function ToolbarSeparator() {
  return <div className="mx-1 h-5 w-px shrink-0 bg-border/60" aria-hidden />;
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
