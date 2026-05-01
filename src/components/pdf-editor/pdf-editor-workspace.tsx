"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Highlighter,
  Italic,
  Loader2,
  MousePointer2,
  Plus,
  Save,
  Trash2,
  Type,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { createStorageAdapter, type PdfEditorState } from "@/lib/storage";
import { getDisplayName } from "@/lib/document-types";
import { getPdfjs } from "@/lib/pdf/pdfjs";
import { cn } from "@/lib/utils";
import { useFileStore, type FileItem } from "@/stores/file-store";

interface PdfTextBox {
  id: string;
  pageIndex: number;
  text: string;
  originalText: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  originalFontSize?: number;
  fontName?: string;
  fontFamily?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  styleRanges?: PdfTextStyleRange[];
}

interface PdfFreeTextBox {
  id: string;
  pageIndex: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  textAlign?: "left" | "center" | "right";
  styleRanges?: PdfTextStyleRange[];
}

interface PdfHighlightBox {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  opacity?: number;
}

interface PageSize {
  width: number;
  height: number;
}

interface PdfTextStyleRange {
  start: number;
  end: number;
  color?: string;
  highlightColor?: string;
  bold?: boolean;
  italic?: boolean;
}

interface PdfEditorWorkspaceProps {
  file: FileItem;
}

type Rect = { left: number; top: number; width: number; height: number };
type SnapCandidate = { value: number; range: [number, number] };
type PdfTool = "select" | "add-text";
type ActiveObject =
  | { kind: "text"; id: string }
  | { kind: "free-text"; id: string }
  | { kind: "highlight"; id: string };
type HighlightDraft = { startX: number; startY: number; box: PdfHighlightBox };
type ActiveTextSelection = { objectId: string; start: number; end: number; rect: Rect } | null;
type TextStyleSnapshot = {
  color: string;
  highlightColor?: string;
  bold: boolean;
  italic: boolean;
};

const TEXT_COLOR_SWATCHES = [
  "#111111",
  "#52525b",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0891b2",
  "#2563eb",
  "#7c3aed",
  "#db2777",
];
const HIGHLIGHT_COLOR_SWATCHES = [
  "#fde68a",
  "#fed7aa",
  "#fecaca",
  "#fbcfe8",
  "#ddd6fe",
  "#bfdbfe",
  "#a7f3d0",
  "#d9f99d",
  "#e5e7eb",
  "#ffe66d",
];

export function PdfEditorWorkspace({ file }: PdfEditorWorkspaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageContainerRef = useRef<HTMLDivElement>(null);
  const textEditsRef = useRef<Record<string, PdfTextBox>>({});
  const legacyEditsRef = useRef<Record<string, { text: string }>>({});
  const isDraggingBlockRef = useRef(false);
  const deleteActiveObjectRef = useRef<() => void>(() => undefined);
  const workspaceMode = useFileStore((s) => s.workspaceMode);
  const workspaceRoot = useFileStore((s) => s.workspaceRoot);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [pageSize, setPageSize] = useState<PageSize>({ width: 0, height: 0 });
  const [pageCount, setPageCount] = useState(0);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [textBoxes, setTextBoxes] = useState<PdfTextBox[]>([]);
  const [textEdits, setTextEdits] = useState<Record<string, PdfTextBox>>({});
  const [legacyEdits, setLegacyEdits] = useState<Record<string, { text: string }>>({});
  const [freeTextBoxes, setFreeTextBoxes] = useState<PdfFreeTextBox[]>([]);
  const [highlightBoxes, setHighlightBoxes] = useState<PdfHighlightBox[]>([]);
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [activeObject, setActiveObject] = useState<ActiveObject | null>(null);
  const [activeTextSelection, setActiveTextSelection] = useState<ActiveTextSelection>(null);
  const [pendingSelectionRestore, setPendingSelectionRestore] = useState<{
    objectId: string;
    start: number;
    end: number;
  } | null>(null);
  const [highlightDraft, setHighlightDraft] = useState<HighlightDraft | null>(null);
  const [scale, setScale] = useState(1.2);
  const [tool, setTool] = useState<PdfTool>("select");
  const [activeRenderedBlock, setActiveRenderedBlock] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [isDraggingBlock, setIsDraggingBlock] = useState(false);
  const [dragGuides, setDragGuides] = useState<{
    vertical: Array<{ x: number; y0: number; y1: number }>;
    horizontal: Array<{ y: number; x0: number; x1: number }>;
  } | null>(null);

  const adapter = useMemo(
    () =>
      createStorageAdapter({
        mode: workspaceMode,
        disk: { root: workspaceRoot },
      }),
    [workspaceMode, workspaceRoot]
  );

  const pageFreeTextBoxes = freeTextBoxes.filter((box) => box.pageIndex === currentPageIndex);
  const pageHighlightBoxes = highlightBoxes.filter((box) => box.pageIndex === currentPageIndex);
  const activeTextBox =
    activeObject?.kind === "text"
      ? (textBoxes.find((box) => box.id === activeObject.id) ?? null)
      : null;
  const activeFreeTextBox =
    activeObject?.kind === "free-text"
      ? (freeTextBoxes.find((box) => box.id === activeObject.id) ?? null)
      : null;
  const activeHighlightBox =
    activeObject?.kind === "highlight"
      ? (highlightBoxes.find((box) => box.id === activeObject.id) ?? null)
      : null;
  const activeTextLike = activeTextBox ?? activeFreeTextBox;
  const selectedTextStyle = activeTextLike
    ? textStyleForSelection(activeTextLike, activeTextSelection)
    : null;

  useEffect(() => {
    textEditsRef.current = textEdits;
  }, [textEdits]);

  useEffect(() => {
    legacyEditsRef.current = legacyEdits;
  }, [legacyEdits]);

  // Clear text-range selection when active object changes away from a text-like
  useEffect(() => {
    if (
      activeTextSelection &&
      (!activeObject ||
        (activeObject.kind !== "text" && activeObject.kind !== "free-text") ||
        activeObject.id !== activeTextSelection.objectId)
    ) {
      setActiveTextSelection(null);
    }
  }, [activeObject, activeTextSelection]);

  // Sync native browser selection -> activeTextSelection.
  // This is the single source of truth: no parallel custom anchor system.
  useEffect(() => {
    if (!activeObject || (activeObject.kind !== "text" && activeObject.kind !== "free-text")) {
      return;
    }
    const handler = () => {
      if (isDraggingBlockRef.current) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setActiveTextSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const node =
        range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
          ? (range.commonAncestorContainer as Element)
          : range.commonAncestorContainer.parentElement;
      const editable = node?.closest<HTMLElement>("[data-pdf-editable-id]");
      if (!editable || editable.dataset.pdfEditableId !== activeObject.id) {
        setActiveTextSelection(null);
        return;
      }
      const offsets = selectionOffsetsInElement(editable, sel);
      if (!offsets) {
        setActiveTextSelection(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setActiveTextSelection({
        objectId: activeObject.id,
        start: offsets.start,
        end: offsets.end,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      });
    };
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, [activeObject]);

  useEffect(() => {
    let cancelled = false;

    async function loadPdfShell() {
      if (!adapter.readBinary || !file.storageHandle) {
        setStatus("error");
        return;
      }

      setStatus("loading");
      setActiveObject(null);

      try {
        const pdfjs = getPdfjs();
        const bytes = await adapter.readBinary(file.storageHandle);
        const editorState = adapter.readPdfEditorState
          ? await adapter.readPdfEditorState(file.storageHandle)
          : null;
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
        if (cancelled) return;

        const normalized = normalizePdfEditorState(editorState);
        setSourceBytes(new Uint8Array(bytes));
        setPageCount(pdf.numPages);
        setCurrentPageIndex((pageIndex) => clampPageIndex(pageIndex, pdf.numPages));
        setTextEdits(normalized.textEdits);
        setLegacyEdits(normalized.legacyEdits);
        setFreeTextBoxes(normalized.freeText);
        setHighlightBoxes(normalized.highlights);
      } catch (error) {
        console.error(error);
        if (!cancelled) setStatus("error");
      }
    }

    void loadPdfShell();

    return () => {
      cancelled = true;
    };
  }, [adapter, file.storageHandle]);

  useEffect(() => {
    let cancelled = false;

    async function renderCurrentPage() {
      if (!sourceBytes) return;
      setStatus("loading");
      setActiveObject(null);

      try {
        const pdfjs = getPdfjs();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(sourceBytes) }).promise;
        const page = await pdf.getPage(currentPageIndex + 1);
        const baseViewport = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context || cancelled) return;
        const outputScale = Math.max(window.devicePixelRatio || 1, 1);

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.clearRect(0, 0, canvas.width, canvas.height);

        await page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
        }).promise;

        const textContent = await page.getTextContent();
        const migratedEdits: Record<string, PdfTextBox> = {};
        const currentTextEdits = textEditsRef.current ?? {};
        const currentLegacyEdits = legacyEditsRef.current ?? {};
        const boxes = textContent.items.flatMap((item, index) => {
          if (!isPdfTextItem(item)) return [];
          const tx = pdfjs.Util.transform(baseViewport.transform, item.transform);
          const fontSize = Math.max(Math.abs(tx[3]), item.height, 8);
          const width = Math.max(item.width, 8);
          const height = Math.max(fontSize * 1.15, 10);
          const style = item.fontName ? textContent.styles[item.fontName] : undefined;
          const id = `p${currentPageIndex}-t${index}`;
          const originalBox: PdfTextBox = {
            id,
            pageIndex: currentPageIndex,
            text: item.str,
            originalText: item.str,
            x: tx[4],
            y: tx[5] - height * 0.78,
            width,
            height,
            fontSize,
            originalFontSize: fontSize,
            fontName: item.fontName,
            fontFamily: isPdfTextStyle(style) ? style.fontFamily : undefined,
          };
          const legacyText = currentLegacyEdits[id]?.text;
          if (!currentTextEdits[id] && legacyText && legacyText !== originalBox.text) {
            migratedEdits[id] = { ...originalBox, text: legacyText };
          }
          const storedEdit = currentTextEdits[id];
          return [
            {
              ...originalBox,
              ...storedEdit,
              id,
              pageIndex: currentPageIndex,
              originalText: originalBox.originalText,
              originalFontSize: storedEdit?.originalFontSize ?? originalBox.fontSize,
              text: storedEdit?.text ?? legacyText ?? originalBox.text,
            },
          ];
        });

        if (cancelled) return;
        setPageSize({ width: baseViewport.width, height: baseViewport.height });
        setTextBoxes(boxes);
        if (Object.keys(migratedEdits).length > 0) {
          setTextEdits((edits) => ({ ...edits, ...migratedEdits }));
          setLegacyEdits((edits) => {
            const next = { ...edits };
            for (const id of Object.keys(migratedEdits)) {
              delete next[id];
            }
            return next;
          });
        }
        setStatus("ready");
      } catch (error) {
        console.error(error);
        if (!cancelled) setStatus("error");
      }
    }

    void renderCurrentPage();

    return () => {
      cancelled = true;
    };
  }, [currentPageIndex, scale, sourceBytes]);

  const commitTextBoxEdit = (box: PdfTextBox) => {
    setTextEdits((edits) => {
      const next = { ...edits };
      if (!isTextBoxEdited(box)) {
        delete next[box.id];
      } else {
        next[box.id] = box;
      }
      return next;
    });
  };

  const updateTextBox = (id: string, patch: Partial<PdfTextBox>) => {
    let updatedBox: PdfTextBox | null = null;
    setTextBoxes((boxes) =>
      boxes.map((box) => {
        if (box.id !== id) return box;
        updatedBox = { ...box, ...patch };
        return updatedBox;
      })
    );
    if (updatedBox) commitTextBoxEdit(updatedBox);
  };

  const updateTextBoxText = (id: string, text: string) => {
    const box = textBoxes.find((item) => item.id === id);
    updateTextBox(id, { text, styleRanges: normalizeStyleRanges(box?.styleRanges, text.length) });
  };

  const updateFreeText = (id: string, text: string) => {
    setFreeTextBoxes((boxes) =>
      boxes.map((box) =>
        box.id === id
          ? { ...box, text, styleRanges: normalizeStyleRanges(box.styleRanges, text.length) }
          : box
      )
    );
  };

  const updateFreeTextBox = (id: string, patch: Partial<PdfFreeTextBox>) => {
    setFreeTextBoxes((boxes) => boxes.map((box) => (box.id === id ? { ...box, ...patch } : box)));
  };

  const applyTextSelectionStyle = (style: Partial<Omit<PdfTextStyleRange, "start" | "end">>) => {
    if (!activeObject || (activeObject.kind !== "text" && activeObject.kind !== "free-text"))
      return;
    const selection =
      activeTextSelection && activeTextSelection.objectId === activeObject.id
        ? { start: activeTextSelection.start, end: activeTextSelection.end }
        : null;

    if (activeObject.kind === "text") {
      const box = textBoxes.find((item) => item.id === activeObject.id);
      if (!box) return;
      updateTextBox(box.id, {
        styleRanges: applyStyleToTextRange(box.styleRanges, box.text.length, selection, style),
      });
    } else {
      const box = freeTextBoxes.find((item) => item.id === activeObject.id);
      if (!box) return;
      updateFreeTextBox(box.id, {
        styleRanges: applyStyleToTextRange(box.styleRanges, box.text.length, selection, style),
      });
    }

    if (selection) {
      setPendingSelectionRestore({
        objectId: activeObject.id,
        start: selection.start,
        end: selection.end,
      });
    }
  };

  const updateHighlightBox = (id: string, patch: Partial<PdfHighlightBox>) => {
    setHighlightBoxes((boxes) => boxes.map((box) => (box.id === id ? { ...box, ...patch } : box)));
  };

  const deleteActiveObject = useCallback(() => {
    setActiveObject((current) => {
      if (!current) return current;
      if (current.kind === "text") {
        setTextBoxes((boxes) => {
          const original = boxes.find((box) => box.id === current.id);
          if (original) {
            const originalFontSize = original.originalFontSize ?? original.fontSize;
            const reset = {
              ...original,
              text: original.originalText,
              fontSize: originalFontSize,
              originalFontSize,
              color: undefined,
              bold: undefined,
              italic: undefined,
              styleRanges: undefined,
            };
            commitTextBoxEdit(reset);
            return boxes.map((box) => (box.id === current.id ? reset : box));
          }
          return boxes;
        });
      }
      if (current.kind === "free-text") {
        setFreeTextBoxes((boxes) => boxes.filter((box) => box.id !== current.id));
      }
      if (current.kind === "highlight") {
        setHighlightBoxes((boxes) => boxes.filter((box) => box.id !== current.id));
      }
      return null;
    });
  }, []);

  useEffect(() => {
    deleteActiveObjectRef.current = deleteActiveObject;
  }, [deleteActiveObject]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!activeObject) return;

      if (event.key === "Escape") {
        setActiveObject(null);
        return;
      }

      if (event.key !== "Backspace" && event.key !== "Delete") return;
      const target = event.target as HTMLElement | null;
      const isEditingText = Boolean(target?.isContentEditable);

      if (activeObject.kind === "highlight" || !isEditingText) {
        event.preventDefault();
        deleteActiveObjectRef.current();
        return;
      }

      if (activeObject.kind === "free-text" && activeFreeTextBox?.text.length === 0) {
        event.preventDefault();
        deleteActiveObjectRef.current();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeFreeTextBox?.text.length, activeObject]);

  const startBlockDrag = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      base: { x: number; y: number },
      bounds: { width: number; height: number },
      apply: (next: { x: number; y: number }) => void,
      dragKey: string
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const startClientX = event.clientX;
      const startClientY = event.clientY;
      isDraggingBlockRef.current = true;
      setIsDraggingBlock(true);
      document.body.style.userSelect = "none";

      const xCandidates: SnapCandidate[] = [
        { value: 0, range: [0, pageSize.height] },
        { value: pageSize.width / 2, range: [0, pageSize.height] },
        { value: pageSize.width, range: [0, pageSize.height] },
      ];
      const yCandidates: SnapCandidate[] = [
        { value: 0, range: [0, pageSize.width] },
        { value: pageSize.height / 2, range: [0, pageSize.width] },
        { value: pageSize.height, range: [0, pageSize.width] },
      ];
      const pushCandidates = (key: string, bx: number, by: number, bw: number, bh: number) => {
        if (key === dragKey) return;
        xCandidates.push(
          { value: bx, range: [by, by + bh] },
          { value: bx + bw / 2, range: [by, by + bh] },
          { value: bx + bw, range: [by, by + bh] }
        );
        yCandidates.push(
          { value: by, range: [bx, bx + bw] },
          { value: by + bh / 2, range: [bx, bx + bw] },
          { value: by + bh, range: [bx, bx + bw] }
        );
      };
      for (const b of textBoxes) {
        if (b.pageIndex !== currentPageIndex) continue;
        pushCandidates(`text-${b.id}`, b.x, b.y, textBoxSelectionWidth(b), b.height);
      }
      for (const b of freeTextBoxes) {
        if (b.pageIndex !== currentPageIndex) continue;
        pushCandidates(`free-text-${b.id}`, b.x, b.y, freeTextSelectionWidth(b), b.height);
      }
      for (const b of highlightBoxes) {
        if (b.pageIndex !== currentPageIndex) continue;
        pushCandidates(`highlight-${b.id}`, b.x, b.y, b.width, b.height);
      }

      const SNAP_THRESHOLD = 4;

      const handleMove = (moveEvent: PointerEvent) => {
        const dx = (moveEvent.clientX - startClientX) / scale;
        const dy = (moveEvent.clientY - startClientY) / scale;
        const maxX = Math.max(0, pageSize.width - bounds.width);
        const maxY = Math.max(0, pageSize.height - bounds.height);
        const rawX = Math.max(0, Math.min(maxX, base.x + dx));
        const rawY = Math.max(0, Math.min(maxY, base.y + dy));

        const xs = snapAxis(rawX, bounds.width, xCandidates, SNAP_THRESHOLD);
        const ys = snapAxis(rawY, bounds.height, yCandidates, SNAP_THRESHOLD);
        const nextX = Math.max(0, Math.min(maxX, xs.snappedStart));
        const nextY = Math.max(0, Math.min(maxY, ys.snappedStart));

        const guides: {
          vertical: Array<{ x: number; y0: number; y1: number }>;
          horizontal: Array<{ y: number; x0: number; x1: number }>;
        } = { vertical: [], horizontal: [] };
        if (xs.guide) {
          const draggedY0 = nextY;
          const draggedY1 = nextY + bounds.height;
          guides.vertical.push({
            x: xs.guide.coord,
            y0: Math.min(draggedY0, xs.guide.range[0]),
            y1: Math.max(draggedY1, xs.guide.range[1]),
          });
        }
        if (ys.guide) {
          const draggedX0 = nextX;
          const draggedX1 = nextX + bounds.width;
          guides.horizontal.push({
            y: ys.guide.coord,
            x0: Math.min(draggedX0, ys.guide.range[0]),
            x1: Math.max(draggedX1, ys.guide.range[1]),
          });
        }
        setDragGuides(guides.vertical.length || guides.horizontal.length ? guides : null);
        apply({ x: nextX, y: nextY });
      };
      const handleUp = () => {
        isDraggingBlockRef.current = false;
        setIsDraggingBlock(false);
        setDragGuides(null);
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [
      pageSize.height,
      pageSize.width,
      scale,
      textBoxes,
      freeTextBoxes,
      highlightBoxes,
      currentPageIndex,
    ]
  );

  const handlePagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Page-level pointerdown: handles tool actions on empty area.
    if (event.target !== event.currentTarget) {
      // If user clicked an inner overlay, that handler already ran.
      return;
    }
    const point = pagePointFromPointer(event, scale);
    if (!point) {
      setActiveObject(null);
      return;
    }

    if (tool === "add-text") {
      const box: PdfFreeTextBox = {
        id: `ft-${Date.now()}`,
        pageIndex: currentPageIndex,
        text: "New text",
        x: point.x,
        y: point.y,
        width: 120,
        height: 22,
        fontSize: 14,
        fontFamily: '"Times New Roman", Times, serif',
        color: "#111111",
      };
      setFreeTextBoxes((boxes) => [...boxes, box]);
      setActiveObject({ kind: "free-text", id: box.id });
      setTool("select");
      return;
    }

    if (event.shiftKey) {
      // Shift+drag on empty area creates a freeform highlight rectangle.
      const box: PdfHighlightBox = {
        id: `hl-${Date.now()}`,
        pageIndex: currentPageIndex,
        x: point.x,
        y: point.y,
        width: 1,
        height: 1,
        color: "#ffe66d",
        opacity: 0.45,
      };
      setHighlightDraft({ startX: point.x, startY: point.y, box });
      setActiveObject({ kind: "highlight", id: box.id });
      return;
    }

    setActiveObject(null);
    setActiveTextSelection(null);
  };

  const handlePagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!highlightDraft) return;
    const point = pagePointFromPointer(event, scale);
    if (!point) return;
    setHighlightDraft((draft) => {
      if (!draft) return null;
      return { ...draft, box: highlightBoxFromDrag(draft, point.x, point.y) };
    });
  };

  const commitHighlightDraft = () => {
    setHighlightDraft((draft) => {
      if (!draft) return null;
      const highlight =
        draft.box.width < 6 || draft.box.height < 6
          ? { ...draft.box, width: 150, height: 22 }
          : draft.box;
      setHighlightBoxes((boxes) =>
        boxes.some((box) => box.id === highlight.id) ? boxes : [...boxes, highlight]
      );
      setActiveObject({ kind: "highlight", id: highlight.id });
      return null;
    });
  };

  const handleSave = () => {
    const changedTextEdits = Object.fromEntries(
      Object.entries(textEdits).filter(([, box]) => isTextBoxEdited(box))
    );
    const hasChanges =
      Object.keys(changedTextEdits).length > 0 ||
      freeTextBoxes.length > 0 ||
      highlightBoxes.length > 0;
    if (!hasChanges) {
      toast.message("No PDF changes yet");
      return;
    }

    const state = pdfEditorStateFromData(changedTextEdits, freeTextBoxes, highlightBoxes);
    const persistState =
      adapter.writePdfEditorState && file.storageHandle
        ? adapter.writePdfEditorState(file.storageHandle, state)
        : Promise.resolve();

    toast.promise(
      persistState.then(() =>
        exportEditedPdf(sourceBytes, changedTextEdits, freeTextBoxes, highlightBoxes, file.name)
      ),
      {
        loading: "Exporting edited PDF...",
        success: "Edited PDF exported",
        error: "Failed to export edited PDF",
      }
    );
  };

  useLayoutEffect(() => {
    if (!activeObject) {
      setActiveRenderedBlock(null);
      return;
    }

    const compute = () => {
      const page = pageContainerRef.current;
      if (!page) return;

      let next: { x: number; y: number; width: number; height: number } | null = null;

      if (activeObject.kind === "highlight") {
        const box = highlightBoxes.find((b) => b.id === activeObject.id);
        if (box) next = { x: box.x, y: box.y, width: box.width, height: box.height };
      } else {
        const el = page.querySelector<HTMLElement>(`[data-pdf-editable-id="${activeObject.id}"]`);
        if (el) {
          const elRect = el.getBoundingClientRect();
          const pageRect = page.getBoundingClientRect();
          next = {
            x: (elRect.left - pageRect.left) / scale,
            y: (elRect.top - pageRect.top) / scale,
            width: elRect.width / scale,
            height: elRect.height / scale,
          };
        }
      }

      setActiveRenderedBlock((prev) => {
        if (!prev && !next) return prev;
        if (!prev || !next) return next;
        if (
          Math.abs(prev.x - next.x) < 0.5 &&
          Math.abs(prev.y - next.y) < 0.5 &&
          Math.abs(prev.width - next.width) < 0.5 &&
          Math.abs(prev.height - next.height) < 0.5
        ) {
          return prev;
        }
        return next;
      });
    };

    compute();

    let frame: number | null = null;
    const handler = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(compute);
    };
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [activeObject, scale, highlightBoxes, freeTextBoxes, textBoxes]);

  const floatingToolbarRect = computeFloatingToolbarRect({
    activeTextSelection,
    activeObject,
    activeRenderedBlock,
    pageContainerRef,
    scale,
  });

  return (
    <div
      className="relative flex min-h-0 flex-1 bg-muted/40 text-foreground"
      onPointerDown={() => {
        // background click clears selection
        setActiveObject(null);
        setActiveTextSelection(null);
      }}
    >
      <PdfToolRail tool={tool} onToolChange={setTool} onSave={handleSave} />

      <aside
        className="bg-sidebar hidden w-[148px] shrink-0 border-r border-border/60 md:flex md:flex-col"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="text-ui-xs flex h-10 items-center border-b border-border/60 px-3 font-semibold text-muted-foreground">
          Pages
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          {Array.from({ length: Math.max(pageCount, 1) }, (_, pageIndex) => (
            <button
              key={pageIndex}
              className={cn(
                "flex w-full flex-col items-center gap-1 rounded-md border p-1.5 text-muted-foreground transition-colors",
                pageIndex === currentPageIndex
                  ? "border-primary/55 bg-primary/5 text-primary"
                  : "border-border/70 bg-card hover:border-primary/30"
              )}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setCurrentPageIndex(pageIndex)}
            >
              <PdfPageThumbnail
                sourceBytes={sourceBytes}
                pageIndex={pageIndex}
                active={pageIndex === currentPageIndex}
              />
              <span className="text-ui-xs font-semibold">{pageIndex + 1}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div
          className="bg-sidebar flex h-10 shrink-0 items-center justify-center gap-1 border-b border-border/60 px-3"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Tooltip content="Previous page" side="bottom">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md"
              disabled={currentPageIndex <= 0}
              onClick={() => setCurrentPageIndex((pageIndex) => Math.max(0, pageIndex - 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <div className="text-ui-xs flex h-7 min-w-16 items-center justify-center rounded-md border border-border/70 bg-background px-2 font-semibold text-muted-foreground">
            {currentPageIndex + 1} / {Math.max(pageCount, 1)}
          </div>
          <Tooltip content="Next page" side="bottom">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md"
              disabled={pageCount <= 0 || currentPageIndex >= pageCount - 1}
              onClick={() =>
                setCurrentPageIndex((pageIndex) => Math.min(pageCount - 1, pageIndex + 1))
              }
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <div className="mx-2 h-5 w-px bg-border" />
          <Tooltip content="Zoom out" side="bottom">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md"
              onClick={() => setScale((value) => Math.max(0.75, value - 0.1))}
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <div className="text-ui-xs flex h-7 min-w-16 items-center justify-center rounded-md border border-border/70 bg-background px-2 font-semibold text-muted-foreground">
            {Math.round(scale * 100)}%
          </div>
          <Tooltip content="Zoom in" side="bottom">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md"
              onClick={() => setScale((value) => Math.min(2, value + 0.1))}
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <div className="mx-2 h-5 w-px bg-border" />
          <span className="text-ui-xs truncate font-medium text-muted-foreground">
            {getDisplayName(file.name)}
          </span>
          <div className="text-ui-xs ml-auto text-muted-foreground/70">
            {tool === "add-text" ? "Click on page to add text" : "Shift-drag for highlight"}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <div className="flex min-h-full justify-center px-8 py-10">
            <div
              ref={pageContainerRef}
              className={cn(
                "relative bg-white shadow-[0_18px_60px_rgba(15,23,42,0.16)] ring-1 ring-black/10",
                tool === "add-text" && "cursor-crosshair"
              )}
              style={{
                width: pageSize.width ? pageSize.width * scale : 720,
                height: pageSize.height ? pageSize.height * scale : 960,
              }}
              onPointerDown={handlePagePointerDown}
              onPointerMove={handlePagePointerMove}
              onPointerUp={commitHighlightDraft}
              onPointerLeave={commitHighlightDraft}
            >
              <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" />

              {status === "ready" && (
                <>
                  {pageHighlightBoxes.map((box) => (
                    <HighlightObject
                      key={box.id}
                      box={box}
                      scale={scale}
                      active={activeObject?.kind === "highlight" && activeObject.id === box.id}
                      onSelect={() => setActiveObject({ kind: "highlight", id: box.id })}
                    />
                  ))}
                  {highlightDraft && (
                    <HighlightObject
                      box={highlightDraft.box}
                      scale={scale}
                      active
                      drafting
                      onSelect={() => undefined}
                    />
                  )}
                  {textBoxes.map((box) => (
                    <PdfExistingText
                      key={box.id}
                      box={box}
                      scale={scale}
                      active={activeObject?.kind === "text" && activeObject.id === box.id}
                      onSelect={() => setActiveObject({ kind: "text", id: box.id })}
                      onChange={(text) => updateTextBoxText(box.id, text)}
                      onClear={() => setActiveObject(null)}
                      pendingSelectionRestore={pendingSelectionRestore}
                      onSelectionRestored={() => setPendingSelectionRestore(null)}
                    />
                  ))}
                  {pageFreeTextBoxes.map((box) => (
                    <FreeTextObject
                      key={box.id}
                      box={box}
                      scale={scale}
                      active={activeObject?.kind === "free-text" && activeObject.id === box.id}
                      onSelect={() => setActiveObject({ kind: "free-text", id: box.id })}
                      onChange={updateFreeText}
                      pendingSelectionRestore={pendingSelectionRestore}
                      onSelectionRestored={() => setPendingSelectionRestore(null)}
                    />
                  ))}
                  {(() => {
                    const blockBox = activeRenderedBlock;
                    if (!blockBox || !activeObject) return null;
                    const draggable =
                      activeObject.kind === "free-text" || activeObject.kind === "highlight";
                    const onStartDrag = (event: ReactPointerEvent<HTMLElement>) => {
                      if (activeObject.kind === "free-text" && activeFreeTextBox) {
                        startBlockDrag(
                          event,
                          { x: activeFreeTextBox.x, y: activeFreeTextBox.y },
                          {
                            width: freeTextSelectionWidth(activeFreeTextBox),
                            height: activeFreeTextBox.height,
                          },
                          (next) => updateFreeTextBox(activeFreeTextBox.id, next),
                          `free-text-${activeFreeTextBox.id}`
                        );
                        return;
                      }
                      if (activeObject.kind === "highlight" && activeHighlightBox) {
                        startBlockDrag(
                          event,
                          { x: activeHighlightBox.x, y: activeHighlightBox.y },
                          {
                            width: activeHighlightBox.width,
                            height: activeHighlightBox.height,
                          },
                          (next) => updateHighlightBox(activeHighlightBox.id, next),
                          `highlight-${activeHighlightBox.id}`
                        );
                      }
                    };
                    return (
                      <BlockSelectionOverlay
                        block={blockBox}
                        scale={scale}
                        draggable={draggable}
                        onStartDrag={onStartDrag}
                      />
                    );
                  })()}
                  {dragGuides && (
                    <div className="pointer-events-none absolute inset-0 z-40">
                      {dragGuides.vertical.map((g, i) => (
                        <div
                          key={`v-${i}`}
                          className="absolute bg-pink-500/90 shadow-[0_0_0_0.5px_rgba(255,255,255,0.6)]"
                          style={{
                            left: g.x * scale - 0.5,
                            top: g.y0 * scale,
                            width: 1,
                            height: Math.max(1, (g.y1 - g.y0) * scale),
                          }}
                        />
                      ))}
                      {dragGuides.horizontal.map((g, i) => (
                        <div
                          key={`h-${i}`}
                          className="absolute bg-pink-500/90 shadow-[0_0_0_0.5px_rgba(255,255,255,0.6)]"
                          style={{
                            left: g.x0 * scale,
                            top: g.y * scale - 0.5,
                            width: Math.max(1, (g.x1 - g.x0) * scale),
                            height: 1,
                          }}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}

              {status === "loading" && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/80">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}

              {status === "error" && (
                <div className="absolute inset-0 flex items-center justify-center bg-background p-8 text-center">
                  <div>
                    <p className="text-sm font-semibold">Could not open this PDF</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      The file is visible in doXmind, but the local binary reader failed.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {floatingToolbarRect && !isDraggingBlock && (
        <FloatingToolbar
          rect={floatingToolbarRect}
          activeTextBox={activeTextBox}
          activeFreeTextBox={activeFreeTextBox}
          activeHighlightBox={activeHighlightBox}
          activeTextSelection={activeTextSelection}
          selectedTextStyle={selectedTextStyle}
          onApplyTextStyle={applyTextSelectionStyle}
          onUpdateTextBox={updateTextBox}
          onUpdateFreeTextBox={updateFreeTextBox}
          onUpdateHighlightBox={updateHighlightBox}
          onDelete={() => deleteActiveObjectRef.current()}
        />
      )}
    </div>
  );
}

function computeFloatingToolbarRect({
  activeTextSelection,
  activeObject,
  activeRenderedBlock,
  pageContainerRef,
  scale,
}: {
  activeTextSelection: ActiveTextSelection;
  activeObject: ActiveObject | null;
  activeRenderedBlock: { x: number; y: number; width: number; height: number } | null;
  pageContainerRef: React.RefObject<HTMLDivElement | null>;
  scale: number;
}): Rect | null {
  if (
    activeTextSelection &&
    activeObject &&
    activeTextSelection.objectId === activeObject.id &&
    activeTextSelection.end > activeTextSelection.start &&
    activeTextSelection.rect.width > 0 &&
    activeTextSelection.rect.height > 0
  ) {
    return activeTextSelection.rect;
  }

  const pageEl = pageContainerRef.current;
  if (!pageEl || !activeRenderedBlock) return null;
  const pageRect = pageEl.getBoundingClientRect();

  return {
    left: pageRect.left + activeRenderedBlock.x * scale,
    top: pageRect.top + activeRenderedBlock.y * scale,
    width: Math.max(40, activeRenderedBlock.width * scale),
    height: Math.max(20, activeRenderedBlock.height * scale),
  };
}

function PdfExistingText({
  box,
  scale,
  active,
  onSelect,
  onChange,
  onClear,
  pendingSelectionRestore,
  onSelectionRestored,
}: {
  box: PdfTextBox;
  scale: number;
  active: boolean;
  onSelect: () => void;
  onChange: (text: string) => void;
  onClear: () => void;
  pendingSelectionRestore: { objectId: string; start: number; end: number } | null;
  onSelectionRestored: () => void;
}) {
  const editableRef = useRef<HTMLSpanElement>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const visible = isTextBoxEdited(box) || active;

  useEffect(() => {
    if (active && editableRef.current && document.activeElement !== editableRef.current) {
      editableRef.current.focus();
    }
  }, [active]);

  useLayoutEffect(() => {
    const target = pendingCaretRef.current;
    if (target === null) return;
    pendingCaretRef.current = null;
    const node = editableRef.current;
    if (node && document.activeElement === node) {
      setCaretOffsetWithin(node, target);
    }
  });

  useLayoutEffect(() => {
    if (!pendingSelectionRestore || pendingSelectionRestore.objectId !== box.id) return;
    const node = editableRef.current;
    if (!node) {
      onSelectionRestored();
      return;
    }
    if (document.activeElement !== node) node.focus();
    setRangeSelectionWithin(node, pendingSelectionRestore.start, pendingSelectionRestore.end);
    onSelectionRestored();
  }, [pendingSelectionRestore, box.id, box.styleRanges, box.text, onSelectionRestored]);

  return (
    <div
      className={cn(
        "group absolute m-0 bg-transparent p-0 text-left outline-none",
        visible ? "z-20 overflow-visible" : "overflow-hidden"
      )}
      style={scaledBoxStyle(box, scale)}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      {visible && (
        <div
          className="pointer-events-none absolute z-0 bg-white"
          style={textBoxCoverStyle(box, scale)}
        />
      )}
      <span
        ref={editableRef}
        data-pdf-editable-id={box.id}
        contentEditable
        suppressContentEditableWarning
        className={cn(
          "relative z-10 inline-block min-h-full whitespace-pre outline-none",
          visible ? "text-black" : "text-transparent"
        )}
        style={textSpanStyle(box, visible)}
        onFocus={onSelect}
        onInput={(event) => {
          const node = event.currentTarget;
          pendingCaretRef.current = getCaretOffsetWithin(node);
          onChange(node.textContent ?? "");
        }}
        onBlur={(event) => onChange(event.currentTarget.textContent ?? "")}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClear();
          }
        }}
      >
        {renderStyledTextRuns(box.text, box.styleRanges, {
          color: visible ? (box.color ?? "#111111") : "transparent",
          bold: Boolean(box.bold),
          italic: Boolean(box.italic),
        })}
      </span>
    </div>
  );
}

function FreeTextObject({
  box,
  scale,
  active,
  onSelect,
  onChange,
  pendingSelectionRestore,
  onSelectionRestored,
}: {
  box: PdfFreeTextBox;
  scale: number;
  active: boolean;
  onSelect: () => void;
  onChange: (id: string, text: string) => void;
  pendingSelectionRestore: { objectId: string; start: number; end: number } | null;
  onSelectionRestored: () => void;
}) {
  const editableRef = useRef<HTMLSpanElement>(null);
  const pendingCaretRef = useRef<number | null>(null);

  useEffect(() => {
    if (active && editableRef.current && document.activeElement !== editableRef.current) {
      editableRef.current.focus();
    }
  }, [active]);

  useLayoutEffect(() => {
    const target = pendingCaretRef.current;
    if (target === null) return;
    pendingCaretRef.current = null;
    const node = editableRef.current;
    if (node && document.activeElement === node) {
      setCaretOffsetWithin(node, target);
    }
  });

  useLayoutEffect(() => {
    if (!pendingSelectionRestore || pendingSelectionRestore.objectId !== box.id) return;
    const node = editableRef.current;
    if (!node) {
      onSelectionRestored();
      return;
    }
    if (document.activeElement !== node) node.focus();
    setRangeSelectionWithin(node, pendingSelectionRestore.start, pendingSelectionRestore.end);
    onSelectionRestored();
  }, [pendingSelectionRestore, box.id, box.styleRanges, box.text, onSelectionRestored]);

  return (
    <div
      className={cn(
        "group absolute z-30 m-0 overflow-visible bg-transparent p-0 text-left outline-none"
      )}
      style={scaledFreeTextStyle(box, scale)}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <span
        ref={editableRef}
        data-pdf-editable-id={box.id}
        contentEditable={active}
        suppressContentEditableWarning
        className="inline-block min-h-full whitespace-pre outline-none"
        style={freeTextSpanStyle(box)}
        onFocus={onSelect}
        onInput={(event) => {
          const node = event.currentTarget;
          pendingCaretRef.current = getCaretOffsetWithin(node);
          onChange(box.id, node.textContent ?? "");
        }}
        onBlur={(event) => onChange(box.id, event.currentTarget.textContent ?? "")}
      >
        {renderStyledTextRuns(box.text, box.styleRanges, {
          color: box.color ?? "#111111",
          bold: Boolean(box.bold),
          italic: Boolean(box.italic),
        })}
      </span>
    </div>
  );
}

function HighlightObject({
  box,
  scale,
  drafting,
  onSelect,
}: {
  box: PdfHighlightBox;
  scale: number;
  active: boolean;
  drafting?: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={cn("absolute z-10", drafting && "pointer-events-none")}
      style={{
        left: box.x * scale,
        top: box.y * scale,
        width: box.width * scale,
        height: box.height * scale,
        backgroundColor: hexToRgba(box.color ?? "#ffe66d", box.opacity ?? 0.45),
      }}
      onPointerDown={(event) => {
        if (drafting) return;
        event.stopPropagation();
        onSelect();
      }}
    />
  );
}

function BlockSelectionOverlay({
  block,
  scale,
  draggable,
  onStartDrag,
}: {
  block: { x: number; y: number; width: number; height: number };
  scale: number;
  draggable: boolean;
  onStartDrag: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  return (
    <div
      className="pointer-events-none absolute z-[60]"
      style={{
        left: block.x * scale,
        top: block.y * scale,
        width: block.width * scale,
        height: block.height * scale,
      }}
    >
      <div className="pointer-events-none absolute -inset-[3px] rounded-[3px] border-2 border-dashed border-[#2f80ed]" />
      {draggable && (
        <button
          type="button"
          className="pointer-events-auto absolute -left-7 top-1/2 flex h-5 w-5 -translate-y-1/2 cursor-grab items-center justify-center rounded-md border border-[#1f6fd9] bg-[#2f80ed] text-white shadow-md hover:bg-[#1f6fd9] active:cursor-grabbing"
          onPointerDown={(event) => {
            event.stopPropagation();
            onStartDrag(event);
          }}
          aria-label="Drag block"
        >
          <GripVertical className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function PdfPageThumbnail({
  sourceBytes,
  pageIndex,
  active,
}: {
  sourceBytes: Uint8Array | null;
  pageIndex: number;
  active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function renderThumbnail() {
      if (!sourceBytes) return;
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;

      try {
        const pdfjs = getPdfjs();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(sourceBytes) }).promise;
        const page = await pdf.getPage(pageIndex + 1);
        const baseViewport = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 86 / baseViewport.width });
        const outputScale = Math.max(window.devicePixelRatio || 1, 1);

        if (cancelled) return;
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.clearRect(0, 0, canvas.width, canvas.height);

        await page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
        }).promise;
      } catch (error) {
        console.error(error);
      }
    }

    void renderThumbnail();

    return () => {
      cancelled = true;
    };
  }, [pageIndex, sourceBytes]);

  return (
    <div
      className={cn(
        "flex aspect-[0.72] w-20 items-center justify-center rounded border bg-white shadow-sm",
        active ? "border-primary/40" : "border-border"
      )}
    >
      <canvas ref={canvasRef} className="max-h-full max-w-full" />
    </div>
  );
}

function PdfToolRail({
  tool,
  onToolChange,
  onSave,
}: {
  tool: PdfTool;
  onToolChange: (tool: PdfTool) => void;
  onSave: () => void;
}) {
  return (
    <div
      className="bg-sidebar flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border/60 py-2"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ToolButton
        active={tool === "select"}
        label="Select & edit"
        onClick={() => onToolChange("select")}
      >
        <MousePointer2 className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        active={tool === "add-text"}
        label="Add text"
        onClick={() => onToolChange("add-text")}
      >
        <Plus className="h-4 w-4" />
      </ToolButton>
      <div className="flex-1" />
      <ToolButton active={false} label="Export edited PDF" onClick={onSave}>
        <Save className="h-4 w-4" />
      </ToolButton>
    </div>
  );
}

function ToolButton({
  active,
  label,
  onClick,
  children,
  disabled,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Tooltip content={label} side="right">
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-9 w-9 rounded-lg text-muted-foreground hover:bg-[var(--sidebar-hover)] hover:text-foreground",
          active &&
            "bg-[var(--sidebar-active)] text-foreground ring-1 ring-[var(--sidebar-active-border)]"
        )}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        aria-label={label}
      >
        {children}
      </Button>
    </Tooltip>
  );
}

function FloatingToolbar({
  rect,
  activeTextBox,
  activeFreeTextBox,
  activeHighlightBox,
  activeTextSelection,
  selectedTextStyle,
  onApplyTextStyle,
  onUpdateTextBox,
  onUpdateFreeTextBox,
  onUpdateHighlightBox,
  onDelete,
}: {
  rect: Rect;
  activeTextBox: PdfTextBox | null;
  activeFreeTextBox: PdfFreeTextBox | null;
  activeHighlightBox: PdfHighlightBox | null;
  activeTextSelection: ActiveTextSelection;
  selectedTextStyle: TextStyleSnapshot | null;
  onApplyTextStyle: (style: Partial<Omit<PdfTextStyleRange, "start" | "end">>) => void;
  onUpdateTextBox: (id: string, patch: Partial<PdfTextBox>) => void;
  onUpdateFreeTextBox: (id: string, patch: Partial<PdfFreeTextBox>) => void;
  onUpdateHighlightBox: (id: string, patch: Partial<PdfHighlightBox>) => void;
  onDelete: () => void;
}) {
  const activeTextLike = activeTextBox ?? activeFreeTextBox;
  const hasRangeSelection = Boolean(
    activeTextLike &&
    activeTextSelection?.objectId === activeTextLike.id &&
    activeTextSelection.end > activeTextSelection.start
  );
  const fontSize = activeTextLike?.fontSize ?? null;

  const setFontSize = (value: number) => {
    if (!activeTextLike) return;
    const next = Math.min(96, Math.max(6, Math.round(value)));
    if (activeTextBox) onUpdateTextBox(activeTextBox.id, { fontSize: next });
    if (activeFreeTextBox) onUpdateFreeTextBox(activeFreeTextBox.id, { fontSize: next });
  };

  const left = clamp(rect.left + rect.width / 2, 120, window.innerWidth - 120);
  const top = Math.max(12, rect.top - 52);
  const baseStyle: CSSProperties = { left, top };

  const containerRef = useRef<HTMLDivElement>(null);
  const [openPopover, setOpenPopover] = useState<string | null>(null);

  useEffect(() => {
    setOpenPopover(null);
  }, [activeTextBox?.id, activeFreeTextBox?.id, activeHighlightBox?.id]);

  useEffect(() => {
    if (!openPopover) return;
    const handler = (event: PointerEvent) => {
      const node = containerRef.current;
      if (!node) return;
      if (!node.contains(event.target as Node)) {
        setOpenPopover(null);
      }
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [openPopover]);

  const requestPopover = (id: string) => {
    setOpenPopover((current) => (current === id ? null : id));
  };

  return (
    <div
      ref={containerRef}
      className="animate-in fade-in-0 zoom-in-95 fixed z-[70] flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-border/60 bg-popover p-1 text-popover-foreground shadow-lg"
      style={baseStyle}
      onPointerDown={(event) => {
        event.stopPropagation();
        if ((event.target as HTMLElement).tagName !== "INPUT") {
          event.preventDefault();
        }
      }}
    >
      {activeTextLike && (
        <>
          <ToolbarIconButton
            label="Bold"
            active={Boolean(selectedTextStyle?.bold)}
            onClick={() => onApplyTextStyle({ bold: !selectedTextStyle?.bold })}
          >
            <Bold className="h-3.5 w-3.5" />
          </ToolbarIconButton>
          <ToolbarIconButton
            label="Italic"
            active={Boolean(selectedTextStyle?.italic)}
            onClick={() => onApplyTextStyle({ italic: !selectedTextStyle?.italic })}
          >
            <Italic className="h-3.5 w-3.5" />
          </ToolbarIconButton>

          <ToolbarDivider />

          <FontSizeStepper
            value={fontSize ? Math.round(fontSize) : 14}
            onChange={setFontSize}
            disabled={hasRangeSelection}
          />

          {activeFreeTextBox && !hasRangeSelection && (
            <>
              <ToolbarDivider />
              <ToolbarIconButton
                label="Align left"
                active={activeFreeTextBox.textAlign === "left" || !activeFreeTextBox.textAlign}
                onClick={() => onUpdateFreeTextBox(activeFreeTextBox.id, { textAlign: "left" })}
              >
                <AlignLeft className="h-3.5 w-3.5" />
              </ToolbarIconButton>
              <ToolbarIconButton
                label="Align center"
                active={activeFreeTextBox.textAlign === "center"}
                onClick={() => onUpdateFreeTextBox(activeFreeTextBox.id, { textAlign: "center" })}
              >
                <AlignCenter className="h-3.5 w-3.5" />
              </ToolbarIconButton>
              <ToolbarIconButton
                label="Align right"
                active={activeFreeTextBox.textAlign === "right"}
                onClick={() => onUpdateFreeTextBox(activeFreeTextBox.id, { textAlign: "right" })}
              >
                <AlignRight className="h-3.5 w-3.5" />
              </ToolbarIconButton>
            </>
          )}

          <ToolbarDivider />

          <ToolbarColorButton
            label="Text color"
            popoverId="text-color"
            open={openPopover === "text-color"}
            onRequestOpen={requestPopover}
            color={selectedTextStyle?.color ?? "#111111"}
            palette={TEXT_COLOR_SWATCHES}
            onSelect={(color) => onApplyTextStyle({ color })}
            icon={<Type className="h-3.5 w-3.5" />}
          />
          <ToolbarColorButton
            label="Highlight"
            popoverId="highlight-color"
            open={openPopover === "highlight-color"}
            onRequestOpen={requestPopover}
            color={selectedTextStyle?.highlightColor ?? "#ffe66d"}
            palette={HIGHLIGHT_COLOR_SWATCHES}
            onSelect={(highlightColor) => onApplyTextStyle({ highlightColor })}
            icon={<Highlighter className="h-3.5 w-3.5" />}
          />
        </>
      )}

      {activeHighlightBox && (
        <>
          <ToolbarColorButton
            label="Highlight color"
            popoverId="region-highlight-color"
            open={openPopover === "region-highlight-color"}
            onRequestOpen={requestPopover}
            color={activeHighlightBox.color ?? "#ffe66d"}
            palette={HIGHLIGHT_COLOR_SWATCHES}
            onSelect={(color) => color && onUpdateHighlightBox(activeHighlightBox.id, { color })}
            icon={<Highlighter className="h-3.5 w-3.5" />}
          />
          <ToolbarDivider />
          <div className="flex items-center gap-2 px-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Opacity
            </span>
            <input
              type="range"
              min={0.15}
              max={0.8}
              step={0.05}
              value={activeHighlightBox.opacity ?? 0.45}
              className="h-1 w-24 cursor-pointer accent-foreground"
              onChange={(event) =>
                onUpdateHighlightBox(activeHighlightBox.id, {
                  opacity: Number(event.target.value),
                })
              }
              aria-label="Highlight opacity"
            />
            <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">
              {Math.round((activeHighlightBox.opacity ?? 0.45) * 100)}%
            </span>
          </div>
        </>
      )}

      {(activeFreeTextBox ||
        activeHighlightBox ||
        (activeTextBox && isTextBoxEdited(activeTextBox))) && (
        <>
          <ToolbarDivider />
          <ToolbarIconButton
            label={activeTextBox ? "Reset to original" : "Delete"}
            onClick={onDelete}
            danger
          >
            <Trash2 className="h-3.5 w-3.5" />
          </ToolbarIconButton>
        </>
      )}
    </div>
  );
}

function ToolbarDivider() {
  return <div className="mx-1 h-5 w-px bg-border/60" aria-hidden />;
}

function FontSizeStepper({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-8 items-center overflow-hidden rounded-md bg-muted",
        disabled && "opacity-50"
      )}
    >
      <button
        type="button"
        className="flex h-full w-7 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:hover:bg-transparent"
        onClick={() => onChange(value - 1)}
        disabled={disabled}
        aria-label="Decrease font size"
      >
        <span className="text-base leading-none">−</span>
      </button>
      <input
        className="h-full w-9 bg-transparent text-center text-[12px] font-semibold tabular-nums text-foreground outline-none"
        value={value}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (!Number.isNaN(parsed)) onChange(parsed);
        }}
        disabled={disabled}
        aria-label="Font size"
      />
      <button
        type="button"
        className="flex h-full w-7 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:hover:bg-transparent"
        onClick={() => onChange(value + 1)}
        disabled={disabled}
        aria-label="Increase font size"
      >
        <span className="text-base leading-none">+</span>
      </button>
    </div>
  );
}

function ToolbarIconButton({
  label,
  active,
  onClick,
  danger,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label} side="top">
      <button
        type="button"
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent",
          active && "bg-accent",
          danger && "hover:bg-destructive/15 hover:text-destructive"
        )}
        onClick={onClick}
        aria-label={label}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function ToolbarColorButton({
  label,
  popoverId,
  open,
  onRequestOpen,
  color,
  palette,
  onSelect,
  icon,
}: {
  label: string;
  popoverId: string;
  open: boolean;
  onRequestOpen: (id: string) => void;
  color: string;
  palette: string[];
  onSelect: (color: string) => void;
  icon?: ReactNode;
}) {
  const triggerButton = (
    <button
      type="button"
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-md px-2 text-foreground transition-colors hover:bg-accent",
        open && "bg-accent"
      )}
      onClick={() => onRequestOpen(popoverId)}
      aria-label={label}
      aria-expanded={open}
    >
      {icon ?? <Type className="h-3.5 w-3.5" />}
      <span className="h-[3px] w-3.5 rounded-sm" style={{ backgroundColor: color }} aria-hidden />
    </button>
  );
  return (
    <div className="relative">
      {open ? (
        triggerButton
      ) : (
        <Tooltip content={label} side="top">
          {triggerButton}
        </Tooltip>
      )}
      {open && (
        <div
          className="animate-in fade-in-0 zoom-in-95 absolute bottom-[calc(100%+8px)] left-1/2 z-10 origin-bottom -translate-x-1/2"
          role="dialog"
          aria-label={label}
        >
          <div
            className="absolute -bottom-[5px] left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-b border-r border-border/60 bg-popover"
            aria-hidden
          />
          <div className="relative grid grid-cols-[repeat(5,1.5rem)] gap-2 rounded-lg border border-border/60 bg-popover p-2.5 shadow-lg">
            {palette.map((swatch) => {
              const selected = swatch.toLowerCase() === color.toLowerCase();
              return (
                <button
                  key={swatch}
                  type="button"
                  className={cn(
                    "relative h-6 w-6 rounded-full ring-1 ring-inset ring-black/15 transition-transform hover:scale-110",
                    selected && "ring-2 ring-foreground ring-offset-2 ring-offset-popover"
                  )}
                  style={{ backgroundColor: swatch }}
                  onClick={() => {
                    onSelect(swatch);
                    onRequestOpen(popoverId);
                  }}
                  aria-label={`${label} ${swatch}`}
                  aria-pressed={selected}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function snapAxis(
  draggedStart: number,
  draggedSize: number,
  candidates: SnapCandidate[],
  threshold: number
): {
  snappedStart: number;
  guide: { coord: number; range: [number, number] } | null;
} {
  const edges = [
    { offset: 0, value: draggedStart },
    { offset: draggedSize / 2, value: draggedStart + draggedSize / 2 },
    { offset: draggedSize, value: draggedStart + draggedSize },
  ];
  let best: {
    snappedStart: number;
    coord: number;
    range: [number, number];
    delta: number;
  } | null = null;
  for (const c of candidates) {
    for (const e of edges) {
      const d = Math.abs(c.value - e.value);
      if (d <= threshold && (best === null || d < best.delta)) {
        best = {
          snappedStart: c.value - e.offset,
          coord: c.value,
          range: c.range,
          delta: d,
        };
      }
    }
  }
  if (!best) return { snappedStart: draggedStart, guide: null };
  return {
    snappedStart: best.snappedStart,
    guide: { coord: best.coord, range: best.range },
  };
}

function isPdfTextItem(item: unknown): item is {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName?: string;
} {
  if (!item || typeof item !== "object") return false;
  const candidate = item as Record<string, unknown>;
  return (
    typeof candidate.str === "string" &&
    candidate.str.length > 0 &&
    Array.isArray(candidate.transform) &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number"
  );
}

function isPdfTextStyle(style: unknown): style is { fontFamily: string } {
  if (!style || typeof style !== "object") return false;
  return typeof (style as Record<string, unknown>).fontFamily === "string";
}

function normalizePdfEditorState(state: PdfEditorState | null): {
  textEdits: Record<string, PdfTextBox>;
  legacyEdits: Record<string, { text: string }>;
  freeText: PdfFreeTextBox[];
  highlights: PdfHighlightBox[];
} {
  const textEdits: Record<string, PdfTextBox> = {};
  for (const [id, edit] of Object.entries(state?.textEdits ?? {})) {
    if (edit.width > 0 && edit.height > 0 && edit.fontSize > 0) {
      textEdits[id] = { id, originalFontSize: edit.originalFontSize ?? edit.fontSize, ...edit };
    }
  }
  const legacyEdits: Record<string, { text: string }> = {};
  for (const [id, edit] of Object.entries(state?.edits ?? {})) {
    if (textEdits[id]) continue;
    legacyEdits[id] = edit;
  }

  return {
    textEdits,
    legacyEdits,
    freeText: state?.freeText ?? [],
    highlights: state?.highlights ?? [],
  };
}

function pdfEditorStateFromData(
  textEdits: Record<string, PdfTextBox>,
  freeText: PdfFreeTextBox[],
  highlights: PdfHighlightBox[]
): PdfEditorState {
  return {
    version: 1,
    edits: Object.fromEntries(
      Object.entries(textEdits).map(([id, box]) => [id, { text: box.text }])
    ),
    textEdits: Object.fromEntries(
      Object.entries(textEdits).map(([id, box]) => [
        id,
        {
          pageIndex: box.pageIndex,
          text: box.text,
          originalText: box.originalText,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          fontSize: box.fontSize,
          originalFontSize: box.originalFontSize,
          fontName: box.fontName,
          fontFamily: box.fontFamily,
          color: box.color,
          bold: box.bold,
          italic: box.italic,
          styleRanges: box.styleRanges,
        },
      ])
    ),
    freeText,
    highlights,
  };
}

function clampPageIndex(pageIndex: number, pageCount: number): number {
  return Math.min(Math.max(pageIndex, 0), Math.max(pageCount - 1, 0));
}

function pagePointFromPointer(
  event: ReactPointerEvent<HTMLDivElement>,
  scale: number
): { x: number; y: number } | null {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / scale,
    y: (event.clientY - rect.top) / scale,
  };
}

function scaledBoxStyle(box: PdfTextBox, scale: number): CSSProperties {
  return {
    left: box.x * scale,
    top: box.y * scale,
    width: textBoxSelectionWidth(box) * scale,
    minHeight: box.height * scale,
    fontSize: box.fontSize * scale,
    fontFamily: textBoxFontFamily(box),
    lineHeight: `${box.height * scale}px`,
  };
}

function scaledFreeTextStyle(box: PdfFreeTextBox, scale: number): CSSProperties {
  return {
    left: box.x * scale,
    top: box.y * scale,
    width: freeTextSelectionWidth(box) * scale,
    minHeight: box.height * scale,
    fontSize: box.fontSize * scale,
    fontFamily: box.fontFamily ?? '"Times New Roman", Times, serif',
    lineHeight: `${box.height * scale}px`,
    color: box.color ?? "#111111",
    textAlign: box.textAlign ?? "left",
  };
}

function textSpanStyle(box: PdfTextBox, visible: boolean): CSSProperties {
  return {
    color: visible ? (box.color ?? "#111111") : "transparent",
    fontWeight: textBoxFontWeight(box),
    fontStyle: box.italic ? "italic" : undefined,
  };
}

function textBoxFontFamily(box: PdfTextBox): string {
  if (box.fontFamily) {
    return box.fontFamily;
  }
  return shouldUseSerif(box) ? '"Times New Roman", Times, serif' : "Arial, Helvetica, sans-serif";
}

function freeTextSpanStyle(box: PdfFreeTextBox): CSSProperties {
  return {
    fontWeight: box.bold ? 700 : shouldUseSerif(box.fontFamily) ? 500 : 400,
    fontStyle: box.italic ? "italic" : undefined,
  };
}

function textBoxSelectionWidth(box: PdfTextBox): number {
  return Math.max(measurePdfText(box.text, box), 10);
}

function freeTextSelectionWidth(box: PdfFreeTextBox): number {
  return Math.max(
    measureText(
      box.text,
      box.fontSize,
      box.fontFamily,
      box.bold ? 700 : shouldUseSerif(box.fontFamily) ? 500 : 400
    ),
    20
  );
}

function textBoxCoverWidth(box: PdfTextBox): number {
  return Math.max(
    box.width,
    measurePdfText(box.originalText, box),
    measurePdfText(box.text, box),
    10
  );
}

function textBoxCoverStyle(box: PdfTextBox, scale: number): CSSProperties {
  const padX = Math.max(3, box.fontSize * 0.18) * scale;
  const padY = Math.max(4, box.fontSize * 0.38) * scale;
  return {
    left: -padX,
    top: -padY,
    width: textBoxCoverWidth(box) * scale + padX * 2,
    height: box.height * scale + padY * 2,
  };
}

function measurePdfText(text: string, box: PdfTextBox): number {
  return measureText(text, box.fontSize, textBoxFontFamily(box), textBoxFontWeight(box));
}

function measureText(
  text: string,
  fontSize: number,
  fontFamily = '"Times New Roman", Times, serif',
  fontWeight: CSSProperties["fontWeight"] = 400
): number {
  if (typeof document === "undefined") {
    return text.length * fontSize * 0.55;
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    return text.length * fontSize * 0.55;
  }
  context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  return Math.ceil(context.measureText(text || " ").width) + 2;
}

function textBoxFontWeight(box: PdfTextBox): CSSProperties["fontWeight"] {
  if (box.bold) return 700;
  const fontName = `${box.fontFamily ?? ""} ${box.fontName ?? ""}`.toLowerCase();
  if (/black|heavy/.test(fontName)) return 900;
  if (/bold/.test(fontName)) return 700;
  if (/semibold|demibold/.test(fontName)) return 600;
  if (/medium/.test(fontName)) return 500;
  if (/light|thin/.test(fontName)) return 300;
  return 400;
}

function isTextBoxEdited(box: PdfTextBox): boolean {
  return (
    box.text !== box.originalText ||
    box.fontSize !== (box.originalFontSize ?? box.fontSize) ||
    Boolean(box.color) ||
    Boolean(box.bold) ||
    Boolean(box.italic) ||
    Boolean(box.styleRanges?.length)
  );
}

function normalizeStyleRanges(
  ranges: PdfTextStyleRange[] | undefined,
  textLength: number
): PdfTextStyleRange[] | undefined {
  const normalized = (ranges ?? [])
    .map((range) => ({
      ...range,
      start: Math.max(0, Math.min(textLength, range.start)),
      end: Math.max(0, Math.min(textLength, range.end)),
    }))
    .filter((range) => range.end > range.start);
  return normalized.length ? normalized : undefined;
}

function applyStyleToTextRange(
  ranges: PdfTextStyleRange[] | undefined,
  textLength: number,
  selection: { start: number; end: number } | null,
  style: Partial<Omit<PdfTextStyleRange, "start" | "end">>
): PdfTextStyleRange[] | undefined {
  const target =
    selection && selection.end > selection.start
      ? selection
      : { start: 0, end: Math.max(0, textLength) };
  if (target.end <= target.start) return normalizeStyleRanges(ranges, textLength);
  return normalizeStyleRanges(
    [...(ranges ?? []), { start: target.start, end: target.end, ...style }],
    textLength
  );
}

function selectionOffsetsInElement(element: HTMLElement, selection: Selection) {
  if (selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.commonAncestorContainer)) return null;
  const preSelectionRange = range.cloneRange();
  preSelectionRange.selectNodeContents(element);
  preSelectionRange.setEnd(range.startContainer, range.startOffset);
  const start = preSelectionRange.toString().length;
  const selectedLength = range.toString().length;
  return selectedLength > 0 ? { start, end: start + selectedLength } : null;
}

function getCaretOffsetWithin(element: HTMLElement): number | null {
  const selection = typeof window !== "undefined" ? window.getSelection() : null;
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.endContainer)) return null;
  const preRange = range.cloneRange();
  preRange.selectNodeContents(element);
  preRange.setEnd(range.endContainer, range.endOffset);
  return preRange.toString().length;
}

function setRangeSelectionWithin(element: HTMLElement, start: number, end: number) {
  const selection = typeof window !== "undefined" ? window.getSelection() : null;
  if (!selection) return;
  const range = document.createRange();
  let counter = 0;
  let placedStart = false;
  let placedEnd = false;
  const walk = (node: Node) => {
    if (placedStart && placedEnd) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node as Text).data.length;
      if (!placedStart && start <= counter + len) {
        range.setStart(node, Math.max(0, start - counter));
        placedStart = true;
      }
      if (!placedEnd && end <= counter + len) {
        range.setEnd(node, Math.max(0, end - counter));
        placedEnd = true;
      }
      counter += len;
      return;
    }
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  walk(element);
  if (!placedStart) range.setStart(element, 0);
  if (!placedEnd) {
    range.selectNodeContents(element);
    if (placedStart) range.setStart(range.startContainer, range.startOffset);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function setCaretOffsetWithin(element: HTMLElement, offset: number) {
  const selection = typeof window !== "undefined" ? window.getSelection() : null;
  if (!selection) return;
  const range = document.createRange();
  let remaining = Math.max(0, offset);
  let placed = false;
  const walk = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node as Text).data.length;
      if (remaining <= len) {
        range.setStart(node, remaining);
        range.collapse(true);
        placed = true;
        return true;
      }
      remaining -= len;
      return false;
    }
    for (let i = 0; i < node.childNodes.length; i += 1) {
      if (walk(node.childNodes[i])) return true;
    }
    return false;
  };
  walk(element);
  if (!placed) {
    range.selectNodeContents(element);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function renderStyledTextRuns(
  text: string,
  ranges: PdfTextStyleRange[] | undefined,
  baseStyle: { color: string; bold: boolean; italic: boolean }
) {
  const segments = textSegmentsFromRanges(text, ranges, baseStyle);
  return segments.map((segment, index) => (
    <span
      key={`${segment.start}-${segment.end}-${index}`}
      style={{
        color: segment.color,
        backgroundColor: segment.highlightColor,
        fontWeight: segment.bold ? 700 : undefined,
        fontStyle: segment.italic ? "italic" : undefined,
      }}
    >
      {segment.text}
    </span>
  ));
}

function textSegmentsFromRanges(
  text: string,
  ranges: PdfTextStyleRange[] | undefined,
  baseStyle: { color: string; bold: boolean; italic: boolean }
) {
  const normalized = normalizeStyleRanges(ranges, text.length) ?? [];
  const boundaries = new Set([0, text.length]);
  for (const range of normalized) {
    boundaries.add(range.start);
    boundaries.add(range.end);
  }
  const points = Array.from(boundaries).sort((a, b) => a - b);
  return points.flatMap((start, index) => {
    const end = points[index + 1];
    if (end === undefined || end <= start) return [];
    const styles = normalized.filter((range) => range.start < end && range.end > start);
    const merged = styles.reduce(
      (acc, style) => ({
        color: style.color ?? acc.color,
        highlightColor: style.highlightColor ?? acc.highlightColor,
        bold: style.bold ?? acc.bold,
        italic: style.italic ?? acc.italic,
      }),
      {
        color: baseStyle.color,
        highlightColor: undefined as string | undefined,
        bold: baseStyle.bold,
        italic: baseStyle.italic,
      }
    );
    return [{ ...merged, start, end, text: text.slice(start, end) }];
  });
}

function textStyleForSelection(
  box: PdfTextBox | PdfFreeTextBox,
  selection: ActiveTextSelection
): TextStyleSnapshot {
  const base: TextStyleSnapshot = {
    color: box.color ?? "#111111",
    bold: Boolean(box.bold),
    italic: Boolean(box.italic),
  };
  if (!selection || selection.objectId !== box.id || selection.end <= selection.start) {
    return base;
  }
  return (normalizeStyleRanges(box.styleRanges, box.text.length) ?? [])
    .filter((range) => range.start < selection.end && range.end > selection.start)
    .reduce(
      (acc, range) => ({
        color: range.color ?? acc.color,
        highlightColor: range.highlightColor ?? acc.highlightColor,
        bold: range.bold ?? acc.bold,
        italic: range.italic ?? acc.italic,
      }),
      base
    );
}

function highlightBoxFromDrag(draft: HighlightDraft, x: number, y: number): PdfHighlightBox {
  const left = Math.min(draft.startX, x);
  const top = Math.min(draft.startY, y);
  return {
    ...draft.box,
    x: left,
    y: top,
    width: Math.abs(x - draft.startX),
    height: Math.abs(y - draft.startY),
  };
}

async function exportEditedPdf(
  sourceBytes: Uint8Array | null,
  textEdits: Record<string, PdfTextBox>,
  freeTextBoxes: PdfFreeTextBox[],
  highlightBoxes: PdfHighlightBox[],
  fileName: string
) {
  if (!sourceBytes) {
    throw new Error("PDF bytes are not loaded");
  }

  const pdfDoc = await PDFDocument.load(new Uint8Array(sourceBytes));
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helveticaItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const helveticaBoldItalic = await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);
  const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const timesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const timesItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  const timesBoldItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic);

  for (const highlight of highlightBoxes) {
    const page = pdfDoc.getPage(highlight.pageIndex);
    const { height: pageHeight } = page.getSize();
    page.drawRectangle({
      x: highlight.x,
      y: pageHeight - highlight.y - highlight.height,
      width: highlight.width,
      height: highlight.height,
      color: hexToRgb(highlight.color ?? "#ffe66d"),
      opacity: highlight.opacity ?? 0.45,
    });
  }

  for (const box of Object.values(textEdits)) {
    const page = pdfDoc.getPage(box.pageIndex);
    const { height: pageHeight } = page.getSize();

    page.drawRectangle({
      x: box.x - 1,
      y: pageHeight - box.y - box.height - 1,
      width: textBoxCoverWidth(box) + 2,
      height: box.height + 2,
      color: rgb(1, 1, 1),
    });

    drawStyledPdfText(page, box, pageHeight, {
      helvetica,
      helveticaBold,
      helveticaItalic,
      helveticaBoldItalic,
      timesRoman,
      timesBold,
      timesItalic,
      timesBoldItalic,
    });
  }

  for (const box of freeTextBoxes) {
    const page = pdfDoc.getPage(box.pageIndex);
    const { height: pageHeight } = page.getSize();
    drawStyledPdfText(page, box, pageHeight, {
      helvetica,
      helveticaBold,
      helveticaItalic,
      helveticaBoldItalic,
      timesRoman,
      timesBold,
      timesItalic,
      timesBoldItalic,
    });
  }

  const editedBytes = await pdfDoc.save();
  downloadBytes(editedBytes, editedFileName(fileName), "application/pdf");
}

function shouldUseSerif(boxOrFontName?: PdfTextBox | string): boolean {
  const fontName =
    typeof boxOrFontName === "string"
      ? boxOrFontName
      : [boxOrFontName?.fontFamily, boxOrFontName?.fontName].filter(Boolean).join(" ");
  return /serif|times|georgia|roman/i.test(fontName);
}

function drawStyledPdfText(
  page: PDFPage,
  box: PdfTextBox | PdfFreeTextBox,
  pageHeight: number,
  fonts: {
    helvetica: PDFFont;
    helveticaBold: PDFFont;
    helveticaItalic: PDFFont;
    helveticaBoldItalic: PDFFont;
    timesRoman: PDFFont;
    timesBold: PDFFont;
    timesItalic: PDFFont;
    timesBoldItalic: PDFFont;
  }
) {
  const segments = textSegmentsFromRanges(box.text, box.styleRanges, {
    color: box.color ?? "#111111",
    bold: Boolean(box.bold),
    italic: Boolean(box.italic),
  });
  const baselineY = pageHeight - box.y - box.height + Math.max(1, box.height * 0.18);
  let offsetX = 0;
  for (const segment of segments) {
    const segmentBox = {
      ...box,
      text: segment.text,
      color: segment.color,
      bold: segment.bold,
      italic: segment.italic,
    };
    const width = measureText(
      segment.text,
      box.fontSize,
      "fontFamily" in box ? box.fontFamily : undefined,
      segment.bold
        ? 700
        : shouldUseSerif("fontFamily" in box ? box.fontFamily : undefined)
          ? 500
          : 400
    );
    if (segment.highlightColor) {
      page.drawRectangle({
        x: box.x + offsetX,
        y: pageHeight - box.y - box.height,
        width,
        height: box.height,
        color: hexToRgb(segment.highlightColor),
        opacity: 0.45,
      });
    }
    page.drawText(segment.text, {
      x: box.x + offsetX,
      y: baselineY,
      size: Math.max(4, box.fontSize),
      font: selectExportFont(segmentBox, fonts),
      color: hexToRgb(segment.color ?? "#111111"),
      lineHeight: box.fontSize * 1.15,
    });
    offsetX += width;
  }
}

function selectExportFont(
  box: Pick<PdfTextBox, "fontFamily" | "fontName" | "bold" | "italic"> | PdfFreeTextBox,
  fonts: {
    helvetica: PDFFont;
    helveticaBold: PDFFont;
    helveticaItalic: PDFFont;
    helveticaBoldItalic: PDFFont;
    timesRoman: PDFFont;
    timesBold: PDFFont;
    timesItalic: PDFFont;
    timesBoldItalic: PDFFont;
  }
): PDFFont {
  const serif = shouldUseSerif(
    "fontName" in box ? [box.fontFamily, box.fontName].filter(Boolean).join(" ") : box.fontFamily
  );
  if (serif) {
    if (box.bold && box.italic) return fonts.timesBoldItalic;
    if (box.bold) return fonts.timesBold;
    if (box.italic) return fonts.timesItalic;
    return fonts.timesRoman;
  }
  if (box.bold && box.italic) return fonts.helveticaBoldItalic;
  if (box.bold) return fonts.helveticaBold;
  if (box.italic) return fonts.helveticaItalic;
  return fonts.helvetica;
}

function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean.length === 3 ? expandShortHex(clean) : clean, 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const expanded = clean.length === 3 ? expandShortHex(clean) : clean;
  const value = Number.parseInt(expanded, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function expandShortHex(hex: string): string {
  return hex
    .split("")
    .map((char) => `${char}${char}`)
    .join("");
}

function editedFileName(fileName: string): string {
  const base = getDisplayName(fileName);
  return `${base} edited.pdf`;
}

function downloadBytes(bytes: Uint8Array, fileName: string, mimeType: string) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
