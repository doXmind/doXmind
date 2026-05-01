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
 *      `/api/excel/export-edited` so styles, formulas, charts, and other
 *      openpyxl-preserved features survive even though they aren't
 *      represented in the JSON cell model the renderer uses.
 *
 * Selection + editing live at the workspace level so the format toolbar,
 * formula bar, and context menu can all read / mutate the same cell.
 *
 * Formula recalculation is deliberately not yet wired — user-edited values
 * surface immediately, but cells that depend on them via formulas keep
 * showing whatever cached value the source `.xlsx` had until a Univer-style
 * headless recalc engine is plugged in.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  Italic,
  Loader2,
  Underline,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { getDisplayName } from "@/lib/document-types";
import { exportEditedWorkbook } from "@/lib/excel/export-edited";
import {
  fetchExcelWorkbook,
  type ExcelCellDto,
  type ExcelSheetDto,
  type ExcelWorkbookDto,
} from "@/lib/excel/parse-workbook";
import { createStorageAdapter, type ExcelCellStyle, type ExcelEditorState } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { useFileStore, type FileItem } from "@/stores/file-store";

interface ExcelEditorWorkspaceProps {
  file: FileItem;
}

const DEFAULT_ROW_HEIGHT_PX = 22;
const DEFAULT_COL_WIDTH_PX = 96;
const ROW_HEADER_WIDTH_PX = 44;
const COL_HEADER_HEIGHT_PX = 24;
const POINT_TO_PX = 96 / 72;
const CHAR_UNIT_TO_PX = 7;

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const SIDECAR_DEBOUNCE_MS = 350;

interface CellPatch {
  value?: string | number | boolean | null;
  formula?: string | null;
  numberFormat?: string;
  style?: ExcelCellStyle;
}

interface SelectedCell {
  row: number;
  col: number;
}

interface EditingCell {
  row: number;
  col: number;
  draft: string;
  /**
   * When true the input opens with the cursor at the end and no auto-select,
   * which is what users want when they enter edit mode by typing a fresh
   * character. F2 / double-click set this to `false` so the existing value
   * is selected and easy to overwrite.
   */
  freshDraft: boolean;
  /** Source surface — the in-cell input vs. the formula bar. */
  source: "cell" | "formula-bar";
}

type EditAdvance = { dRow: number; dCol: number };

interface ContextMenuState {
  x: number;
  y: number;
  row: number;
  col: number;
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
  const [selection, setSelection] = useState<SelectedCell | null>(null);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const xlsxBytesRef = useRef<Uint8Array | null>(null);
  const editorStateRef = useRef<ExcelEditorState | null>(null);
  const editingRef = useRef<EditingCell | null>(null);
  const selectionRef = useRef<SelectedCell | null>(null);
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

  // Load workbook + sidecar on mount or when the file id changes.
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
        setSelection(parsed.sheets[0]?.cells[0] ? { row: 0, col: 0 } : null);
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

  // Debounced sidecar persistence.
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

  // Mirror activeSheetId back to the sidecar so reopens land on the right tab.
  useEffect(() => {
    if (!activeSheet) return;
    setEditorState((prev) => {
      const base: ExcelEditorState = prev ?? { version: 1 };
      if (base.activeSheetId === activeSheet.id) return prev;
      return { ...base, version: 1, activeSheetId: activeSheet.id };
    });
  }, [activeSheet]);

  // Reset selection when switching sheets so we don't leave a stale highlight.
  useEffect(() => {
    if (!activeSheet) return;
    setSelection({ row: 0, col: 0 });
    setEditing(null);
    setContextMenu(null);
  }, [activeSheet?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------- Cell-mutation helpers --------

  const updateCell = useCallback(
    (sheetId: string, row: number, col: number, patch: CellPatch | null) => {
      const key = `${sheetId}!${row},${col}`;
      setEditorState((prev) => {
        const base: ExcelEditorState = prev ?? { version: 1 };
        const cells = { ...(base.cells ?? {}) };
        if (patch === null) {
          delete cells[key];
        } else {
          const existing = cells[key];
          if (patch.style && existing?.style) {
            cells[key] = { ...existing, ...patch, style: { ...existing.style, ...patch.style } };
          } else {
            cells[key] = { ...(existing ?? {}), ...patch };
          }
        }
        return { ...base, version: 1, cells };
      });
    },
    []
  );

  const cellsByCoord = useMemo(() => {
    const map = new Map<string, ExcelCellDto>();
    if (!activeSheet) return map;
    for (const cell of activeSheet.cells) {
      map.set(coordKey(cell.row, cell.col), cell);
    }
    return map;
  }, [activeSheet]);

  const editsByCoord = useMemo(() => {
    const map = new Map<string, CellPatch>();
    if (!editorState?.cells || !activeSheet) return map;
    const prefix = `${activeSheet.id}!`;
    for (const [key, patch] of Object.entries(editorState.cells)) {
      if (!key.startsWith(prefix)) continue;
      const [rowStr, colStr] = key.slice(prefix.length).split(",");
      map.set(coordKey(Number(rowStr), Number(colStr)), patch);
    }
    return map;
  }, [editorState?.cells, activeSheet]);

  const effectiveStyleForSelection = useMemo<ExcelCellStyle | undefined>(() => {
    if (!selection) return undefined;
    const cell = cellsByCoord.get(coordKey(selection.row, selection.col));
    const patch = editsByCoord.get(coordKey(selection.row, selection.col));
    return mergeStyle(cell?.style, patch?.style);
  }, [selection, cellsByCoord, editsByCoord]);

  const formulaBarValue = useMemo(() => {
    if (editing) return editing.draft;
    if (!selection) return "";
    const cell = cellsByCoord.get(coordKey(selection.row, selection.col));
    const patch = editsByCoord.get(coordKey(selection.row, selection.col));
    return formulaOrValueAsString(patch ?? cell);
  }, [editing, selection, cellsByCoord, editsByCoord]);

  // -------- Editing flow --------

  const beginEdit = useCallback(
    (target: SelectedCell, options?: { initialChar?: string; source?: "cell" | "formula-bar" }) => {
      const cell = cellsByCoord.get(coordKey(target.row, target.col));
      const patch = editsByCoord.get(coordKey(target.row, target.col));
      const existing = formulaOrValueAsString(patch ?? cell);
      const initialChar = options?.initialChar;
      const draft = initialChar !== undefined ? initialChar : existing;
      setEditing({
        row: target.row,
        col: target.col,
        draft,
        freshDraft: initialChar !== undefined,
        source: options?.source ?? "cell",
      });
      setSelection({ row: target.row, col: target.col });
    },
    [cellsByCoord, editsByCoord]
  );

  const commitEdit = useCallback(
    (advance?: EditAdvance) => {
      if (!activeSheet) return;
      const current = editingRef.current;
      if (!current) return;
      const trimmed = current.draft.trim();
      const patch = parseDraft(trimmed);
      updateCell(activeSheet.id, current.row, current.col, patch);
      setEditing(null);
      const nextRow = advance
        ? clamp(current.row + advance.dRow, 0, activeSheet.rowCount - 1)
        : current.row;
      const nextCol = advance
        ? clamp(current.col + advance.dCol, 0, activeSheet.colCount - 1)
        : current.col;
      setSelection({ row: nextRow, col: nextCol });
      // Return focus to the grid so subsequent arrow keys / shortcuts hit the
      // workspace key handler rather than getting eaten by the in-cell input.
      window.requestAnimationFrame(() => cellGridRef.current?.focus());
    },
    [activeSheet, updateCell]
  );

  const cancelEdit = useCallback(() => {
    setEditing(null);
    window.requestAnimationFrame(() => cellGridRef.current?.focus());
  }, []);

  const updateDraft = useCallback((draft: string) => {
    setEditing((prev) => (prev ? { ...prev, draft, freshDraft: false } : prev));
  }, []);

  const moveSelection = useCallback(
    (deltaRow: number, deltaCol: number) => {
      if (!activeSheet) return;
      setSelection((prev) => {
        const start = prev ?? { row: 0, col: 0 };
        return {
          row: clamp(start.row + deltaRow, 0, activeSheet.rowCount - 1),
          col: clamp(start.col + deltaCol, 0, activeSheet.colCount - 1),
        };
      });
    },
    [activeSheet]
  );

  // -------- Style + structural actions --------

  const applyStylePatch = useCallback(
    (stylePatch: Partial<ExcelCellStyle>) => {
      if (!activeSheet || !selection) return;
      updateCell(activeSheet.id, selection.row, selection.col, { style: stylePatch });
    },
    [activeSheet, selection, updateCell]
  );

  const toggleBold = useCallback(() => {
    applyStylePatch({ bold: !effectiveStyleForSelection?.bold });
  }, [applyStylePatch, effectiveStyleForSelection]);
  const toggleItalic = useCallback(() => {
    applyStylePatch({ italic: !effectiveStyleForSelection?.italic });
  }, [applyStylePatch, effectiveStyleForSelection]);
  const toggleUnderline = useCallback(() => {
    applyStylePatch({ underline: !effectiveStyleForSelection?.underline });
  }, [applyStylePatch, effectiveStyleForSelection]);
  const setAlign = useCallback(
    (textAlign: "left" | "center" | "right") => {
      applyStylePatch({ textAlign });
    },
    [applyStylePatch]
  );

  const clearSelection = useCallback(() => {
    if (!activeSheet || !selection) return;
    updateCell(activeSheet.id, selection.row, selection.col, null);
  }, [activeSheet, selection, updateCell]);

  const copySelection = useCallback(async () => {
    if (!selection) return;
    const cell = cellsByCoord.get(coordKey(selection.row, selection.col));
    const patch = editsByCoord.get(coordKey(selection.row, selection.col));
    const text = formulaOrValueAsString(patch ?? cell);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast.error("Clipboard write was blocked");
    }
  }, [selection, cellsByCoord, editsByCoord]);

  const pasteIntoSelection = useCallback(async () => {
    if (!activeSheet || !selection) return;
    try {
      const text = await navigator.clipboard.readText();
      // Excel-style: when the clipboard contains a tab/newline-separated
      // grid we paste the top-left cell only for now. A full multi-cell
      // paste would need spreading across rows/cols and is a Phase 2 task.
      const firstCell = text.split(/\r?\n/)[0]?.split("\t")[0] ?? "";
      const patch = parseDraft(firstCell);
      updateCell(activeSheet.id, selection.row, selection.col, patch);
    } catch {
      toast.error("Clipboard read was blocked");
    }
  }, [activeSheet, selection, updateCell]);

  // -------- Zoom + export --------

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

  // -------- Workspace-level keyboard handling --------

  const handleGridKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (editing) return;
      if (!activeSheet) return;

      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        if (event.key.toLowerCase() === "b") {
          event.preventDefault();
          toggleBold();
          return;
        }
        if (event.key.toLowerCase() === "i") {
          event.preventDefault();
          toggleItalic();
          return;
        }
        if (event.key.toLowerCase() === "u") {
          event.preventDefault();
          toggleUnderline();
          return;
        }
        if (event.key.toLowerCase() === "c") {
          event.preventDefault();
          void copySelection();
          return;
        }
        if (event.key.toLowerCase() === "v") {
          event.preventDefault();
          void pasteIntoSelection();
          return;
        }
        if (event.key.toLowerCase() === "x") {
          event.preventDefault();
          void copySelection().then(() => clearSelection());
          return;
        }
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = selection ?? { row: 0, col: 0 };

      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-1, 0);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(1, 0);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveSelection(0, -1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveSelection(0, 1);
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
        setSelection(null);
        return;
      }
      if (event.key === "F2") {
        event.preventDefault();
        if (selection) beginEdit(target);
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        if (selection) clearSelection();
        return;
      }
      if (event.key.length === 1) {
        event.preventDefault();
        beginEdit(target, { initialChar: event.key });
      }
    },
    [
      editing,
      activeSheet,
      selection,
      moveSelection,
      beginEdit,
      clearSelection,
      toggleBold,
      toggleItalic,
      toggleUnderline,
      copySelection,
      pasteIntoSelection,
    ]
  );

  // -------- Render --------

  const displayName = getDisplayName(file.name);
  const cellRefLabel = selection ? `${columnLabel(selection.col)}${selection.row + 1}` : "";

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
          <Tooltip content="Bold (⌘B)" side="bottom">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-7 w-7 rounded-md",
                effectiveStyleForSelection?.bold && "bg-foreground/[0.08] text-foreground"
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
                effectiveStyleForSelection?.italic && "bg-foreground/[0.08] text-foreground"
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
                effectiveStyleForSelection?.underline && "bg-foreground/[0.08] text-foreground"
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
                effectiveStyleForSelection?.textAlign === "left" &&
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
                effectiveStyleForSelection?.textAlign === "center" &&
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
                effectiveStyleForSelection?.textAlign === "right" &&
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

          <Tooltip content="Clear cell (Delete)" side="bottom">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md"
              onClick={clearSelection}
              disabled={!selection}
              aria-label="Clear cell"
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
          disabled={!selection}
          spellCheck={false}
          onFocus={() => {
            if (selection && (!editing || editing.source !== "formula-bar")) {
              beginEdit(selection, { source: "formula-bar" });
            }
          }}
          onChange={(event) => {
            if (!editing && selection) {
              beginEdit(selection, { initialChar: event.target.value, source: "formula-bar" });
              return;
            }
            updateDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitEdit({ dRow: event.shiftKey ? -1 : 1, dCol: 0 });
              return;
            }
            if (event.key === "Tab") {
              event.preventDefault();
              commitEdit({ dRow: 0, dCol: event.shiftKey ? -1 : 1 });
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
            if (editing?.source === "formula-bar") commitEdit();
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
        {status === "ready" && activeSheet && (
          <ExcelSheetView
            key={activeSheet.id}
            ref={cellGridRef}
            sheet={activeSheet}
            zoom={zoom}
            cellsByCoord={cellsByCoord}
            editsByCoord={editsByCoord}
            selection={selection}
            editing={editing}
            cellInputRef={cellInputRef}
            onSelectCell={(row, col) => setSelection({ row, col })}
            onBeginEdit={(target, options) => beginEdit(target, options)}
            onUpdateDraft={updateDraft}
            onCommitEdit={commitEdit}
            onCancelEdit={cancelEdit}
            onContextMenu={(payload) => {
              setSelection({ row: payload.row, col: payload.col });
              setContextMenu(payload);
            }}
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

      {/* Right-click context menu */}
      <DropdownMenu
        open={contextMenu !== null}
        onOpenChange={(next) => {
          if (!next) setContextMenu(null);
        }}
        anchorPoint={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
      >
        <DropdownMenuTrigger asChild>
          <span className="hidden" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem
            onClick={() => {
              void copySelection();
              setContextMenu(null);
            }}
          >
            Copy
            <span className="ml-auto text-xs text-muted-foreground">⌘C</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              void copySelection().then(() => clearSelection());
              setContextMenu(null);
            }}
          >
            Cut
            <span className="ml-auto text-xs text-muted-foreground">⌘X</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              void pasteIntoSelection();
              setContextMenu(null);
            }}
          >
            Paste
            <span className="ml-auto text-xs text-muted-foreground">⌘V</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              clearSelection();
              setContextMenu(null);
            }}
          >
            Clear contents
            <span className="ml-auto text-xs text-muted-foreground">⌫</span>
          </DropdownMenuItem>
          <div className="my-1 h-px bg-border/60" />
          <DropdownMenuItem
            onClick={() => {
              toggleBold();
              setContextMenu(null);
            }}
          >
            {effectiveStyleForSelection?.bold ? "Remove bold" : "Bold"}
            <span className="ml-auto text-xs text-muted-foreground">⌘B</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              toggleItalic();
              setContextMenu(null);
            }}
          >
            {effectiveStyleForSelection?.italic ? "Remove italic" : "Italic"}
            <span className="ml-auto text-xs text-muted-foreground">⌘I</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              toggleUnderline();
              setContextMenu(null);
            }}
          >
            {effectiveStyleForSelection?.underline ? "Remove underline" : "Underline"}
            <span className="ml-auto text-xs text-muted-foreground">⌘U</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// =====================================================================
// Sheet view
// =====================================================================

interface ExcelSheetViewProps {
  ref?: React.RefObject<HTMLDivElement | null>;
  sheet: ExcelSheetDto;
  zoom: number;
  cellsByCoord: Map<string, ExcelCellDto>;
  editsByCoord: Map<string, CellPatch>;
  selection: SelectedCell | null;
  editing: EditingCell | null;
  cellInputRef: React.RefObject<HTMLInputElement | null>;
  onSelectCell(row: number, col: number): void;
  onBeginEdit(
    target: SelectedCell,
    options?: { initialChar?: string; source?: "cell" | "formula-bar" }
  ): void;
  onUpdateDraft(draft: string): void;
  onCommitEdit(advance?: EditAdvance): void;
  onCancelEdit(): void;
  onContextMenu(payload: ContextMenuState): void;
  onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void;
}

function ExcelSheetView({
  ref,
  sheet,
  zoom,
  cellsByCoord,
  editsByCoord,
  selection,
  editing,
  cellInputRef,
  onSelectCell,
  onBeginEdit,
  onUpdateDraft,
  onCommitEdit,
  onCancelEdit,
  onContextMenu,
  onKeyDown,
}: ExcelSheetViewProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  const colWidths = useMemo(
    () =>
      Array.from({ length: sheet.colCount }, (_, i) => {
        const override = sheet.colWidths[String(i)];
        const px = override ? override * CHAR_UNIT_TO_PX : DEFAULT_COL_WIDTH_PX;
        return Math.max(40, Math.round(px * zoom));
      }),
    [sheet.colWidths, sheet.colCount, zoom]
  );

  const rowHeights = useMemo(
    () =>
      Array.from({ length: sheet.rowCount }, (_, i) => {
        const override = sheet.rowHeights[String(i)];
        const px = override ? override * POINT_TO_PX : DEFAULT_ROW_HEIGHT_PX;
        return Math.max(16, Math.round(px * zoom));
      }),
    [sheet.rowHeights, sheet.rowCount, zoom]
  );

  const rowVirtualizer = useVirtualizer({
    count: sheet.rowCount,
    getScrollElement: () => scrollerRef.current,
    estimateSize: (index) => rowHeights[index] ?? DEFAULT_ROW_HEIGHT_PX,
    overscan: 8,
  });

  const colVirtualizer = useVirtualizer({
    horizontal: true,
    count: sheet.colCount,
    getScrollElement: () => scrollerRef.current,
    estimateSize: (index) => colWidths[index] ?? DEFAULT_COL_WIDTH_PX,
    overscan: 4,
  });

  useEffect(() => {
    rowVirtualizer.measure();
    colVirtualizer.measure();
  }, [rowVirtualizer, colVirtualizer, zoom, sheet.id]);

  // Keep the selected cell in view when navigation happens via toolbar /
  // formula bar / arrow keys.
  useEffect(() => {
    if (!selection) return;
    rowVirtualizer.scrollToIndex(selection.row, { align: "auto" });
    colVirtualizer.scrollToIndex(selection.col, { align: "auto" });
  }, [selection, rowVirtualizer, colVirtualizer]);

  // Auto-focus the in-cell input when entering cell edit mode.
  useLayoutEffect(() => {
    if (!editing || editing.source !== "cell") return;
    const input = cellInputRef.current;
    if (!input) return;
    input.focus();
    if (editing.freshDraft) {
      const len = input.value.length;
      input.setSelectionRange(len, len);
    } else {
      input.select();
    }
  }, [editing, cellInputRef]);

  const totalWidth = colVirtualizer.getTotalSize();
  const totalHeight = rowVirtualizer.getTotalSize();
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualCols = colVirtualizer.getVirtualItems();

  return (
    <div
      ref={ref}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative flex h-full w-full flex-1 outline-none"
    >
      <div ref={scrollerRef} className="relative h-full w-full overflow-auto bg-background">
        <div
          className="relative"
          style={{
            width: totalWidth + ROW_HEADER_WIDTH_PX,
            minHeight: totalHeight + COL_HEADER_HEIGHT_PX,
          }}
        >
          {/* Top sticky strip = corner + column headers */}
          <div
            className="bg-sidebar sticky top-0 z-20 flex border-b border-border/60"
            style={{ height: COL_HEADER_HEIGHT_PX }}
          >
            <div
              className="bg-sidebar sticky left-0 z-30 shrink-0 border-r border-border/60"
              style={{ width: ROW_HEADER_WIDTH_PX, height: COL_HEADER_HEIGHT_PX }}
            />
            <div
              className="relative shrink-0"
              style={{ width: totalWidth, height: COL_HEADER_HEIGHT_PX }}
            >
              {virtualCols.map((virtualCol) => (
                <div
                  key={virtualCol.key}
                  className={cn(
                    "text-ui-xs absolute top-0 flex items-center justify-center border-r border-border/60 font-medium",
                    selection?.col === virtualCol.index
                      ? "text-foreground"
                      : "text-muted-foreground"
                  )}
                  style={{
                    left: virtualCol.start,
                    width: virtualCol.size,
                    height: COL_HEADER_HEIGHT_PX,
                  }}
                >
                  {columnLabel(virtualCol.index)}
                </div>
              ))}
            </div>
          </div>

          {/* Bottom flex row = sticky row headers + virtualised cell grid */}
          <div className="flex">
            <div
              className="bg-sidebar sticky left-0 z-10 shrink-0 border-r border-border/60"
              style={{ width: ROW_HEADER_WIDTH_PX, height: totalHeight }}
            >
              {virtualRows.map((virtualRow) => (
                <div
                  key={virtualRow.key}
                  className={cn(
                    "text-ui-xs absolute left-0 flex items-center justify-center border-b border-border/60 font-medium",
                    selection?.row === virtualRow.index
                      ? "text-foreground"
                      : "text-muted-foreground"
                  )}
                  style={{
                    top: virtualRow.start,
                    width: ROW_HEADER_WIDTH_PX,
                    height: virtualRow.size,
                  }}
                >
                  {virtualRow.index + 1}
                </div>
              ))}
            </div>

            <div className="relative" style={{ width: totalWidth, height: totalHeight }}>
              {virtualRows.map((virtualRow) =>
                virtualCols.map((virtualCol) => {
                  const row = virtualRow.index;
                  const col = virtualCol.index;
                  const baseCell = cellsByCoord.get(coordKey(row, col));
                  const patch = editsByCoord.get(coordKey(row, col));
                  const isSelected = selection?.row === row && selection.col === col && !editing;
                  const isEditing =
                    editing?.row === row && editing.col === col && editing.source === "cell";
                  return (
                    <ExcelGridCell
                      key={`${virtualRow.key}:${virtualCol.key}`}
                      cell={baseCell}
                      patch={patch}
                      left={virtualCol.start}
                      top={virtualRow.start}
                      width={virtualCol.size}
                      height={virtualRow.size}
                      zoom={zoom}
                      selected={isSelected}
                      editing={isEditing ? editing : null}
                      inputRef={isEditing ? cellInputRef : undefined}
                      onMouseDown={() => onSelectCell(row, col)}
                      onDoubleClick={() => onBeginEdit({ row, col })}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        onContextMenu({ x: event.clientX, y: event.clientY, row, col });
                      }}
                      onDraftChange={onUpdateDraft}
                      onCommit={onCommitEdit}
                      onCancel={onCancelEdit}
                    />
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Grid cell
// =====================================================================

interface ExcelGridCellProps {
  cell: ExcelCellDto | undefined;
  patch: CellPatch | undefined;
  left: number;
  top: number;
  width: number;
  height: number;
  zoom: number;
  selected: boolean;
  editing: EditingCell | null;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onMouseDown(): void;
  onDoubleClick(): void;
  onContextMenu(event: React.MouseEvent<HTMLDivElement>): void;
  onDraftChange(draft: string): void;
  onCommit(advance?: EditAdvance): void;
  onCancel(): void;
}

function ExcelGridCell({
  cell,
  patch,
  left,
  top,
  width,
  height,
  zoom,
  selected,
  editing,
  inputRef,
  onMouseDown,
  onDoubleClick,
  onContextMenu,
  onDraftChange,
  onCommit,
  onCancel,
}: ExcelGridCellProps) {
  const style = mergeStyle(cell?.style, patch?.style);
  const align = style?.textAlign ?? alignFromValue(cell, patch);

  const wrapperStyle: CSSProperties = {
    left,
    top,
    width,
    height,
    background: style?.background,
    color: style?.color,
    fontWeight: style?.bold ? 600 : undefined,
    fontStyle: style?.italic ? "italic" : undefined,
    textDecoration: style?.underline ? "underline" : undefined,
    fontSize: style?.fontSize ? Math.round(style.fontSize * zoom) : Math.round(12 * zoom),
    fontFamily: style?.fontFamily,
    display: "flex",
    alignItems: verticalAlignToFlex(style?.verticalAlign),
    justifyContent: justifyFromAlign(align),
    textAlign: align,
  };

  return (
    <div
      role="gridcell"
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={cn(
        "absolute overflow-hidden border-b border-r border-border/60 px-1.5 py-0.5",
        selected && "z-10 ring-2 ring-inset ring-primary/60"
      )}
      style={wrapperStyle}
    >
      {editing ? (
        <ExcelCellInput
          ref={inputRef}
          align={align}
          value={editing.draft}
          onChange={onDraftChange}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      ) : (
        <ExcelCellLabel cell={cell} patch={patch} />
      )}
    </div>
  );
}

interface ExcelCellInputProps {
  align: "left" | "center" | "right";
  value: string;
  onChange(next: string): void;
  onCommit(advance?: EditAdvance): void;
  onCancel(): void;
}

const ExcelCellInput = ({
  ref,
  align,
  value,
  onChange,
  onCommit,
  onCancel,
}: ExcelCellInputProps & { ref?: React.RefObject<HTMLInputElement | null> }) => (
  <input
    ref={ref}
    type="text"
    value={value}
    onChange={(event) => onChange(event.target.value)}
    onBlur={() => onCommit()}
    onKeyDown={(event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onCommit({ dRow: event.shiftKey ? -1 : 1, dCol: 0 });
      } else if (event.key === "Tab") {
        event.preventDefault();
        onCommit({ dRow: 0, dCol: event.shiftKey ? -1 : 1 });
      } else if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      } else {
        event.stopPropagation();
      }
    }}
    className="h-full w-full bg-background text-foreground outline-none"
    style={{ textAlign: align }}
  />
);

function ExcelCellLabel({
  cell,
  patch,
}: {
  cell: ExcelCellDto | undefined;
  patch: CellPatch | undefined;
}): ReactNode {
  const text = formatCellValue(cell, patch);
  if (!text) return null;
  return <span className="block w-full truncate leading-tight">{text}</span>;
}

// =====================================================================
// Helpers
// =====================================================================

function coordKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function columnLabel(index: number): string {
  let label = "";
  let n = index;
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

function formatCellValue(cell: ExcelCellDto | undefined, patch: CellPatch | undefined): string {
  if (patch) {
    if (patch.formula) return patch.formula;
    if (patch.value === null || patch.value === undefined) return "";
    return String(patch.value);
  }
  if (!cell) return "";
  if (cell.value === null || cell.value === undefined) return "";
  if (typeof cell.value === "number") {
    return cell.value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  if (typeof cell.value === "boolean") return cell.value ? "TRUE" : "FALSE";
  return String(cell.value);
}

function formulaOrValueAsString(source: ExcelCellDto | CellPatch | undefined): string {
  if (!source) return "";
  if ("formula" in source && source.formula) return source.formula;
  const value = "value" in source ? source.value : undefined;
  if (value === null || value === undefined) return "";
  return String(value);
}

function alignFromValue(
  cell: ExcelCellDto | undefined,
  patch: CellPatch | undefined
): "left" | "center" | "right" {
  const value = patch && "value" in patch ? patch.value : cell?.value;
  if (typeof value === "number") return "right";
  if (typeof value === "boolean") return "center";
  return "left";
}

function justifyFromAlign(align: "left" | "center" | "right"): string {
  if (align === "center") return "center";
  if (align === "right") return "flex-end";
  return "flex-start";
}

function verticalAlignToFlex(va: ExcelCellStyle["verticalAlign"]): string {
  if (va === "top") return "flex-start";
  if (va === "bottom") return "flex-end";
  return "center";
}

function mergeStyle(
  base: ExcelCellStyle | undefined,
  overlay: ExcelCellStyle | undefined
): ExcelCellStyle | undefined {
  if (!base && !overlay) return undefined;
  return { ...(base ?? {}), ...(overlay ?? {}) };
}

function parseDraft(draft: string): CellPatch {
  if (draft === "") return { value: null, formula: null };
  if (draft.startsWith("=")) return { formula: draft, value: null };
  if (/^-?\d+(\.\d+)?$/.test(draft)) return { value: Number(draft), formula: null };
  if (draft === "TRUE" || draft === "FALSE") return { value: draft === "TRUE", formula: null };
  return { value: draft, formula: null };
}
