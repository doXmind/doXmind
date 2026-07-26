"use client";

import { ChevronDown, GripVertical } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  markdownTableClearColumn,
  markdownTableClearRow,
  markdownTableDeleteColumn,
  markdownTableDeleteRow,
  markdownTableDuplicateColumn,
  markdownTableDuplicateRow,
  markdownTableInsertColumn,
  markdownTableInsertRow,
  type MarkdownTableCell,
  type MarkdownTableGeometry,
} from "@/editor/markdown-block/markdown-table";

export interface MarkdownTableBlockProps {
  readonly blockId: string;
  readonly source: string;
  readonly geometry: MarkdownTableGeometry;
  /** True only for the Block that is being edited; a nested or printed table is read-only. */
  readonly editable: boolean;
  readonly onChange?: (blockId: string, nextSource: string) => void;
  /**
   * Keys the grid does not own, handed back to the Block.
   *
   * A cell editor that swallowed everything would cut the table off from every Block-level shortcut
   * the rest of the editor has — Escape to select the Block, undo, the Block menu — and leave the
   * only table in a Page unreachable by keyboard once the caret was inside it.
   */
  readonly onCellKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly renderCell: (text: string) => ReactNode;
}

export interface TableCellAddress {
  readonly row: number;
  readonly column: number;
}

/**
 * A pipe table rendered as a grid in both states, with one cell editable at a time.
 *
 * The whole point is that this component sits at the same position in the row's tree whether or not
 * the Block is active, so React keeps one instance and the `<table>` is never unmounted. Activation
 * used to replace the grid with a single textarea holding the raw pipe source: the row lost 23px,
 * every border disappeared, and the alignment row wrapped across two lines. None of those can recur
 * as separate bugs once the element they belonged to stops being torn down.
 *
 * A cell is addressed by row and column, never by offset. Offsets shift for every later cell as soon
 * as one grows by a character, so an offset-addressed "active cell" would drift onto its neighbour
 * mid-word; the geometry is re-derived from the source on each render and the address stays valid.
 */
export function MarkdownTableBlock({
  blockId,
  source,
  geometry,
  editable,
  onChange,
  onCellKeyDown,
  renderCell,
}: MarkdownTableBlockProps) {
  const [active, setActive] = useState<TableCellAddress | null>(null);
  // The cell a press landed on, recorded before the Block is active.
  //
  // A press activates the Block, but `editable` is still false while it is being handled, so a
  // handler guarded on it records nothing and activation falls back to the first cell: clicking any
  // cell of an unfocused table put the caret in the header. A ref rather than state, because it must
  // survive the render that activation triggers without causing one of its own.
  const pendingCellRef = useRef<TableCellAddress | null>(null);
  const pendingCaretRef = useRef<"start" | "end" | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  // A Block that is active must always own an editing surface: the runtime, the tests and the
  // caret-restore machinery all look for one. Landing on the first cell is the equivalent of a
  // paragraph taking a caret when it is activated with no click position.
  useEffect(() => {
    if (!editable) {
      setActive(null);
      return;
    }
    if (active !== null) return;
    setActive(pendingCellRef.current ?? { row: 0, column: 0 });
    pendingCellRef.current = null;
  }, [editable, active]);

  // Focus follows the active cell. A Block that is active but whose surface holds no focus is the
  // worst of both states — it renders as if it were being edited while every keystroke goes to the
  // document — and it is what the rest of the editor assumes cannot happen.
  //
  // Keyed on the address rather than the source, so a keystroke does not re-run this and fight the
  // caret the user is moving.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (document.activeElement !== editor) editor.focus();
    if (pendingCaretRef.current !== null) {
      const at = pendingCaretRef.current === "start" ? 0 : editor.value.length;
      editor.setSelectionRange(at, at);
      pendingCaretRef.current = null;
    }
  }, [active]);

  const cellAt = (row: number, column: number): MarkdownTableCell | undefined =>
    geometry.cells.find((candidate) => candidate.row === row && candidate.column === column);

  const commit = (next: string | null) => {
    if (next === null || next === source) return;
    onChange?.(blockId, next);
  };

  /** Replace one cell's payload, which is a verbatim splice into the Block's source. */
  const commitCell = (cell: MarkdownTableCell, payload: string) => {
    commit(source.slice(0, cell.payloadFrom) + payload + source.slice(cell.payloadTo));
  };

  const moveTo = (row: number, column: number, caret: "start" | "end") => {
    if (!cellAt(row, column)) return false;
    pendingCaretRef.current = caret;
    setActive({ row, column });
    return true;
  };

  /** The next or previous cell in reading order, wrapping across row boundaries. */
  const step = (from: TableCellAddress, direction: -1 | 1): boolean => {
    const ordered = [...geometry.cells].sort((a, b) => a.row - b.row || a.column - b.column);
    const index = ordered.findIndex(
      (candidate) => candidate.row === from.row && candidate.column === from.column
    );
    const next = ordered[index + direction];
    if (!next) return false;
    return moveTo(next.row, next.column, direction === 1 ? "end" : "end");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, address: TableCellAddress) => {
    if (event.key === "Tab") {
      event.preventDefault();
      // Tab out of the last cell appends a row, the way a spreadsheet does, rather than escaping the
      // Block and leaving the user to find the gutter menu.
      if (!step(address, event.shiftKey ? -1 : 1) && !event.shiftKey) {
        const next = markdownTableInsertRow(source, geometry, geometry.rowCount - 1, "below");
        if (next) {
          pendingCaretRef.current = "end";
          setActive({ row: geometry.rowCount, column: 0 });
          commit(next);
        }
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      // A pipe row is one line, so a newline cannot go in a cell. Down-one-cell is what a grid does
      // with Enter, and it is the only reading of the key that does not corrupt the table.
      event.preventDefault();
      if (!moveTo(address.row + 1, address.column, "end")) {
        const next = markdownTableInsertRow(source, geometry, geometry.rowCount - 1, "below");
        if (next) {
          pendingCaretRef.current = "end";
          setActive({ row: geometry.rowCount, column: address.column });
          commit(next);
        }
      }
      return;
    }
    if (event.key === "ArrowDown" && moveTo(address.row + 1, address.column, "end")) {
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowUp" && moveTo(address.row - 1, address.column, "end")) {
      event.preventDefault();
      return;
    }
    // Everything the grid does not own belongs to the Block.
    onCellKeyDown?.(event);
  };

  const alignmentClass = (column: number) => {
    const alignment = geometry.alignments[column];
    if (alignment === "center") return "text-center";
    if (alignment === "right") return "text-right";
    return "text-left";
  };

  const renderBody = (cell: MarkdownTableCell | undefined, address: TableCellAddress) => {
    if (!cell) return null;
    const isActive = editable && active?.row === address.row && active?.column === address.column;
    if (!isActive) return renderCell(source.slice(cell.from, cell.to));
    return (
      <textarea
        ref={editorRef}
        data-native-block-editor
        data-native-table-cell-editor
        aria-label="Table cell"
        rows={1}
        // The payload, padding and all. See `MarkdownTableCell.payloadFrom` for why a trimmed value
        // makes the caret lie.
        value={source.slice(cell.payloadFrom, cell.payloadTo)}
        className="native-block-textarea block w-full resize-none bg-transparent outline-none"
        onChange={(event) => commitCell(cell, sanitiseCellPayload(event.target.value))}
        onKeyDown={(event) => handleKeyDown(event, address)}
      />
    );
  };

  const bodyRows = Array.from(
    { length: Math.max(geometry.rowCount - 1, 0) },
    (_, index) => index + 1
  );

  return (
    <div className="min-h-9 overflow-x-auto py-1">
      <table aria-label="Markdown table" className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {geometry.alignments.map((_, column) => {
              const cell = cellAt(0, column);
              return (
                <th
                  key={`header-${column}`}
                  data-table-cell={cell ? `${cell.from}` : undefined}
                  className={`relative border border-border bg-muted/50 px-2 py-1.5 font-medium ${alignmentClass(column)}`}
                  onPointerDown={() => {
                    pendingCellRef.current = { row: 0, column };
                    if (editable) setActive({ row: 0, column });
                  }}
                >
                  {editable ? (
                    <TableAxisMenu
                      axis="column"
                      label={`Column ${column + 1} actions`}
                      canDelete={geometry.columnCount > 1}
                      onInsertBefore={() =>
                        commit(markdownTableInsertColumn(source, geometry, column, "left"))
                      }
                      onInsertAfter={() =>
                        commit(markdownTableInsertColumn(source, geometry, column, "right"))
                      }
                      onDuplicate={() =>
                        commit(markdownTableDuplicateColumn(source, geometry, column))
                      }
                      onClear={() => commit(markdownTableClearColumn(source, geometry, column))}
                      onDelete={() => commit(markdownTableDeleteColumn(source, geometry, column))}
                    />
                  ) : null}
                  {renderBody(cell, { row: 0, column })}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row) => (
            <tr key={`row-${row}`}>
              {geometry.alignments.map((_, column) => {
                const cell = cellAt(row, column);
                return (
                  <td
                    key={`cell-${row}-${column}`}
                    data-table-cell={cell ? `${cell.from}` : undefined}
                    className={`relative border border-border px-2 py-1.5 ${alignmentClass(column)}`}
                    onPointerDown={() => {
                      if (!cell) return;
                      pendingCellRef.current = { row, column };
                      if (editable) setActive({ row, column });
                    }}
                  >
                    {editable && column === 0 ? (
                      <TableAxisMenu
                        axis="row"
                        label={`Row ${row + 1} actions`}
                        canDelete
                        onInsertBefore={() =>
                          commit(markdownTableInsertRow(source, geometry, row, "above"))
                        }
                        onInsertAfter={() =>
                          commit(markdownTableInsertRow(source, geometry, row, "below"))
                        }
                        onDuplicate={() => commit(markdownTableDuplicateRow(source, geometry, row))}
                        onClear={() => commit(markdownTableClearRow(source, geometry, row))}
                        onDelete={() => commit(markdownTableDeleteRow(source, geometry, row))}
                      />
                    ) : null}
                    {renderBody(cell, { row, column })}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The two characters a pipe-table cell cannot hold literally.
 *
 * An unescaped `|` would end the cell and add a column to that row alone, and a newline would end
 * the row: both turn one keystroke into a structural change nobody asked for. Escaping and flattening
 * keeps what the user typed visible in the cell where they typed it.
 */
function sanitiseCellPayload(value: string): string {
  return value.replace(/\r\n|\n|\r/g, " ").replace(/(^|[^\\])\|/g, "$1\\|");
}

/**
 * The handle and menu for one row or column.
 *
 * It lives inside the cell's own padding rather than in a reserved gutter: the grid scrolls
 * horizontally, so anything positioned outside it would be clipped, and reserving space would shift
 * the table relative to the body text around it.
 */
function TableAxisMenu({
  axis,
  label,
  canDelete,
  onInsertBefore,
  onInsertAfter,
  onDuplicate,
  onClear,
  onDelete,
}: {
  axis: "row" | "column";
  label: string;
  canDelete: boolean;
  onInsertBefore: () => void;
  onInsertAfter: () => void;
  onDuplicate: () => void;
  onClear: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={`absolute z-10 flex items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity duration-[20ms] ease-in hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/native-block:opacity-100 ${
            axis === "row"
              ? "left-0 top-1/2 h-5 w-3 -translate-y-1/2"
              : "left-1/2 top-0 h-3 w-5 -translate-x-1/2"
          }`}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {axis === "row" ? (
            <GripVertical className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        aria-label={label}
        className="w-48 rounded-xl border-border/80 bg-popover/95 p-1.5 shadow-xl backdrop-blur-xl"
      >
        <DropdownMenuItem className="h-8 rounded-lg px-2.5" onClick={onInsertBefore}>
          {axis === "row" ? "Insert above" : "Insert left"}
        </DropdownMenuItem>
        <DropdownMenuItem className="h-8 rounded-lg px-2.5" onClick={onInsertAfter}>
          {axis === "row" ? "Insert below" : "Insert right"}
        </DropdownMenuItem>
        <DropdownMenuItem className="h-8 rounded-lg px-2.5" onClick={onDuplicate}>
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem className="h-8 rounded-lg px-2.5" onClick={onClear}>
          Clear contents
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="h-8 rounded-lg px-2.5"
          disabled={!canDelete}
          onClick={onDelete}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
