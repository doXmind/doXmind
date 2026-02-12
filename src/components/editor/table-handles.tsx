"use client";

import { useState, useEffect, useRef, useCallback, memo } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { GripVertical, Plus } from "lucide-react";
import { TableColumnMenu } from "./table-column-menu";
import { TableRowMenu } from "./table-row-menu";
import {
  getColumnCount,
  getRowCount,
  focusCellAt,
  selectColumn,
  selectRow,
} from "@/lib/table-operations";

interface TableHandlesProps {
  editor: Editor;
}

interface ActiveTable {
  element: HTMLTableElement;
  wrapper: HTMLElement;
  /** ProseMirror position of the table node */
  pos: number;
}

interface ContextMenu {
  type: "column" | "row";
  index: number;
  anchor: { x: number; y: number };
}

/**
 * TableHandles Component
 *
 * Renders Notion-style column grip handles above the table, row grip handles
 * to the left, and + buttons at the right/bottom edges for adding columns/rows.
 * Handles appear when the cursor is inside a table cell (selection-based).
 * Hidden during scroll, reappear after scroll stops.
 */
export const TableHandles = memo(function TableHandles({ editor }: TableHandlesProps) {
  const [activeTable, setActiveTable] = useState<ActiveTable | null>(null);
  const [activeRowIndex, setActiveRowIndex] = useState<number | null>(null);
  const [activeColIndex, setActiveColIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [colHandleHover, setColHandleHover] = useState<number | null>(null);
  const [rowHandleHover, setRowHandleHover] = useState<number | null>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  // Force re-render on geometry changes
  const [, setTick] = useState(0);

  const isMenuOpenRef = useRef(false);
  const activeTableRef = useRef<ActiveTable | null>(null);
  const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Selection-based table detection ---
  const checkSelection = useCallback(() => {
    if (isMenuOpenRef.current) return;

    const { selection } = editor.state;
    const $pos = selection.$from;

    // Walk up to find table node and determine row/col indices
    let tablePos: number | null = null;
    let tableDepth = -1;
    for (let depth = $pos.depth; depth >= 0; depth--) {
      if ($pos.node(depth).type.name === "table") {
        tablePos = $pos.before(depth);
        tableDepth = depth;
        break;
      }
    }

    if (tablePos !== null && tableDepth >= 0) {
      // $pos.index(tableDepth) = row index within table
      // $pos.index(tableDepth + 1) = col index within row
      const rowIdx = tableDepth <= $pos.depth ? $pos.index(tableDepth) : -1;
      const colIdx = tableDepth + 1 <= $pos.depth ? $pos.index(tableDepth + 1) : -1;

      try {
        const dom = editor.view.nodeDOM(tablePos) as HTMLElement | null;
        if (dom) {
          const wrapper = (dom.closest(".tableWrapper") || dom) as HTMLElement;
          const tableEl = (dom.querySelector("table") ||
            (dom.tagName === "TABLE" ? dom : null)) as HTMLTableElement | null;
          if (tableEl) {
            if (
              activeTableRef.current?.pos !== tablePos ||
              activeTableRef.current?.element !== tableEl
            ) {
              const entry: ActiveTable = { element: tableEl, wrapper, pos: tablePos };
              activeTableRef.current = entry;
              setActiveTable(entry);
            }
            setActiveRowIndex(rowIdx >= 0 ? rowIdx : null);
            setActiveColIndex(colIdx >= 0 ? colIdx : null);
            return;
          }
        }
      } catch {
        // nodeDOM can throw for invalid positions
      }
    }

    // Cursor is not inside a table — hide handles
    if (activeTableRef.current) {
      activeTableRef.current = null;
      setActiveTable(null);
      setActiveRowIndex(null);
      setActiveColIndex(null);
      setColHandleHover(null);
      setRowHandleHover(null);
    }
  }, [editor]);

  // Listen for selection changes + check on mount
  useEffect(() => {
    const handleBlur = () => {
      // Don't hide handles when a context menu is open — clicking a menu item
      // in the portal causes editor blur, but the menu still needs activeTable.
      if (isMenuOpenRef.current) return;

      // Editor lost focus (clicked outside) — hide handles
      if (activeTableRef.current) {
        activeTableRef.current = null;
        setActiveTable(null);
        setActiveRowIndex(null);
        setActiveColIndex(null);
        setColHandleHover(null);
        setRowHandleHover(null);
      }
    };

    editor.on("selectionUpdate", checkSelection);
    editor.on("blur", handleBlur);
    checkSelection();
    return () => {
      editor.off("selectionUpdate", checkSelection);
      editor.off("blur", handleBlur);
    };
  }, [editor, checkSelection]);

  // Recompute geometry on editor transactions (table may resize/change)
  useEffect(() => {
    if (!activeTable) return;

    const updateGeometry = () => {
      if (!activeTableRef.current) return;
      if (!activeTableRef.current.element.isConnected) {
        activeTableRef.current = null;
        setActiveTable(null);
        return;
      }
      setTick((t) => t + 1);
    };

    editor.on("transaction", updateGeometry);
    return () => {
      editor.off("transaction", updateGeometry);
    };
  }, [editor, activeTable]);

  // --- Scroll handling: hide during scroll, re-show after ---
  useEffect(() => {
    const editorDOM = editor.view.dom;

    const handleScroll = () => {
      setIsScrolling(true);
      if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current);
      scrollEndTimerRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 150);
    };

    const scrollParent =
      editorDOM.closest("[data-radix-scroll-area-viewport]") || editorDOM.parentElement;
    scrollParent?.addEventListener("scroll", handleScroll, { passive: true });
    // Only trigger on wheel events inside the editor area — not inside menus/popups
    const handleWheel = (e: WheelEvent) => {
      const target = e.target as Node;
      if (scrollParent?.contains(target) || editorDOM.contains(target)) {
        handleScroll();
      }
    };
    document.addEventListener("wheel", handleWheel, { passive: true });

    return () => {
      scrollParent?.removeEventListener("scroll", handleScroll);
      document.removeEventListener("wheel", handleWheel);
      if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current);
    };
  }, [editor]);

  // --- Column handle click → select column cells + open context menu ---
  const handleColumnHandleClick = useCallback(
    (e: React.MouseEvent, colIndex: number) => {
      e.preventDefault();
      e.stopPropagation();
      // Select all cells in this column (Notion-style highlight)
      if (activeTable) {
        selectColumn(editor, activeTable.pos, colIndex);
      }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setContextMenu({
        type: "column",
        index: colIndex,
        anchor: { x: rect.left, y: rect.bottom + 4 },
      });
      isMenuOpenRef.current = true;
    },
    [editor, activeTable]
  );

  // --- Row handle click → select row cells + open context menu ---
  const handleRowHandleClick = useCallback(
    (e: React.MouseEvent, rowIndex: number) => {
      e.preventDefault();
      e.stopPropagation();
      // Select all cells in this row (Notion-style highlight)
      if (activeTable) {
        selectRow(editor, activeTable.pos, rowIndex);
      }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setContextMenu({ type: "row", index: rowIndex, anchor: { x: rect.right + 4, y: rect.top } });
      isMenuOpenRef.current = true;
    },
    [editor, activeTable]
  );

  // --- Close context menu ---
  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    isMenuOpenRef.current = false;
    // Re-check selection after menu closes (let editor state settle first)
    setTimeout(() => checkSelection(), 0);
  }, [checkSelection]);

  // --- Edge + buttons ---
  const handleAddColumnRight = useCallback(() => {
    if (!activeTable) return;
    const colCount = getColumnCount(activeTable.element);
    if (colCount > 0) {
      focusCellAt(editor, activeTable.pos, 0, colCount - 1);
      editor.chain().focus().addColumnAfter().run();
    }
  }, [editor, activeTable]);

  const handleAddRowBottom = useCallback(() => {
    if (!activeTable) return;
    const rowCount = getRowCount(activeTable.element);
    if (rowCount > 0) {
      focusCellAt(editor, activeTable.pos, rowCount - 1, 0);
      editor.chain().focus().addRowAfter().run();
    }
  }, [editor, activeTable]);

  // --- Column/row highlight via direct DOM class toggle ---
  useEffect(() => {
    if (!activeTable) return;
    const tableEl = activeTable.element;
    const rows = tableEl.querySelectorAll("tr");

    // Clean up previous highlights
    tableEl
      .querySelectorAll(".table-col-highlight")
      .forEach((el) => el.classList.remove("table-col-highlight"));
    tableEl
      .querySelectorAll(".table-row-highlight")
      .forEach((el) => el.classList.remove("table-row-highlight"));

    // Apply column highlight
    if (colHandleHover !== null) {
      rows.forEach((row) => {
        const cell = row.cells[colHandleHover];
        if (cell) cell.classList.add("table-col-highlight");
      });
    }

    // Apply row highlight
    if (rowHandleHover !== null) {
      const row = rows[rowHandleHover];
      if (row) {
        Array.from(row.cells).forEach((cell) => cell.classList.add("table-row-highlight"));
      }
    }

    return () => {
      tableEl
        .querySelectorAll(".table-col-highlight")
        .forEach((el) => el.classList.remove("table-col-highlight"));
      tableEl
        .querySelectorAll(".table-row-highlight")
        .forEach((el) => el.classList.remove("table-row-highlight"));
    };
  }, [activeTable, colHandleHover, rowHandleHover]);

  // --- Render ---
  if (!activeTable || isScrolling) return null;

  const tableRect = activeTable.element.getBoundingClientRect();
  const colCount = getColumnCount(activeTable.element);
  const rowCount = getRowCount(activeTable.element);
  const rows = activeTable.element.querySelectorAll("tr");
  const firstRow = rows[0];

  // Build column handle positions from first row cells
  const colHandles: Array<{ left: number; width: number }> = [];
  if (firstRow) {
    for (let c = 0; c < firstRow.cells.length; c++) {
      const cellRect = firstRow.cells[c].getBoundingClientRect();
      colHandles.push({ left: cellRect.left + cellRect.width / 2, width: cellRect.width });
    }
  }

  // Build row handle positions from each row
  const rowHandles: Array<{ top: number; height: number }> = [];
  rows.forEach((row) => {
    const rowRect = row.getBoundingClientRect();
    rowHandles.push({ top: rowRect.top + rowRect.height / 2, height: rowRect.height });
  });

  // Active column/row handle data
  const activeColHandle = activeColIndex !== null ? colHandles[activeColIndex] : null;
  const activeRowHandle = activeRowIndex !== null ? rowHandles[activeRowIndex] : null;

  return createPortal(
    <div>
      {/* Column handle — only for the selected cell's column */}
      {activeColHandle && activeColIndex !== null && (
        <button
          type="button"
          className="table-col-handle fixed z-30 flex items-center justify-center rounded-[3px] border border-transparent text-muted-foreground/50 transition-all duration-100 hover:border-border hover:bg-muted hover:text-muted-foreground"
          style={{
            left: activeColHandle.left - 12,
            top: tableRect.top - 24,
            width: 24,
            height: 20,
          }}
          onClick={(e) => handleColumnHandleClick(e, activeColIndex)}
          onMouseEnter={() => setColHandleHover(activeColIndex)}
          onMouseLeave={() => setColHandleHover(null)}
          onMouseDown={(e) => e.preventDefault()}
          title={`Column ${activeColIndex + 1}`}
        >
          <GripVertical className="h-3.5 w-3.5 rotate-90" />
        </button>
      )}

      {/* Row handle — only for the selected cell's row */}
      {activeRowHandle && activeRowIndex !== null && (
        <button
          type="button"
          className="table-row-handle fixed z-30 flex items-center justify-center rounded-[3px] border border-transparent text-muted-foreground/50 transition-all duration-100 hover:border-border hover:bg-muted hover:text-muted-foreground"
          style={{
            left: tableRect.left - 28,
            top: activeRowHandle.top - 10,
            width: 24,
            height: 20,
          }}
          onClick={(e) => handleRowHandleClick(e, activeRowIndex)}
          onMouseEnter={() => setRowHandleHover(activeRowIndex)}
          onMouseLeave={() => setRowHandleHover(null)}
          onMouseDown={(e) => e.preventDefault()}
          title={`Row ${activeRowIndex + 1}`}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Edge + button: add column (right edge) */}
      <button
        type="button"
        className="table-edge-plus fixed z-30 flex items-center justify-center rounded-full border border-border/50 bg-background text-muted-foreground/50 shadow-sm transition-all duration-100 hover:border-border hover:bg-muted hover:text-muted-foreground"
        style={{
          left: tableRect.right + 4,
          top: tableRect.top + tableRect.height / 2 - 10,
          width: 20,
          height: 20,
        }}
        onClick={handleAddColumnRight}
        onMouseDown={(e) => e.preventDefault()}
        title="Add column"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>

      {/* Edge + button: add row (bottom edge) */}
      <button
        type="button"
        className="table-edge-plus fixed z-30 flex items-center justify-center rounded-full border border-border/50 bg-background text-muted-foreground/50 shadow-sm transition-all duration-100 hover:border-border hover:bg-muted hover:text-muted-foreground"
        style={{
          left: tableRect.left + tableRect.width / 2 - 10,
          top: tableRect.bottom + 4,
          width: 20,
          height: 20,
        }}
        onClick={handleAddRowBottom}
        onMouseDown={(e) => e.preventDefault()}
        title="Add row"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>

      {/* Context Menus */}
      {contextMenu?.type === "column" && activeTable && (
        <TableColumnMenu
          editor={editor}
          tablePos={activeTable.pos}
          colIndex={contextMenu.index}
          position={contextMenu.anchor}
          colCount={colCount}
          onClose={closeContextMenu}
        />
      )}
      {contextMenu?.type === "row" && activeTable && (
        <TableRowMenu
          editor={editor}
          tablePos={activeTable.pos}
          rowIndex={contextMenu.index}
          position={contextMenu.anchor}
          rowCount={rowCount}
          onClose={closeContextMenu}
        />
      )}
    </div>,
    document.body
  );
});
