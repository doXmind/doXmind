"use client";

import { GripHorizontal, GripVertical } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { projectMarkdownInline } from "@/editor/markdown-block/markdown-inline-projection";
import { SemanticInlineEditor } from "@/editor/markdown-block/semantic-inline-editor";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  markdownTableCellSourceOffset,
  markdownTableCellText,
  markdownTableClearColumn,
  markdownTableClearRow,
  markdownTableDeleteColumn,
  markdownTableDeleteRow,
  markdownTableDuplicateColumn,
  markdownTableDuplicateRow,
  markdownTableInsertColumn,
  markdownTableInsertRow,
  markdownTableSetColumnAlignment,
  type MarkdownTableAlignment,
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
  readonly onCellKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  readonly renderCell: (text: string) => ReactNode;
}

export interface TableCellAddress {
  readonly row: number;
  readonly column: number;
}

/** The active cell, plus where its caret should land when the editor mounts. */
interface ActiveCell extends TableCellAddress {
  /** `"start"`, `"end"`, or an offset into the cell's payload source. */
  readonly caret: "start" | "end" | number | null;
}

/**
 * Offset of a point within an element's rendered text, skipping decoration.
 *
 * A press has to land the caret on the character under it, in a cell as much as in a paragraph.
 * Without this the caret went to the start of whichever cell was pressed, so clicking the end of a
 * word put you before the first letter of it.
 */
function visibleOffsetAtPoint(element: HTMLElement, x: number, y: number): number | null {
  const host = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = host.caretPositionFromPoint?.(x, y);
  const range = position ? null : host.caretRangeFromPoint?.(x, y);
  const node = position ? position.offsetNode : (range?.startContainer ?? null);
  const offset = position ? position.offset : (range?.startOffset ?? 0);
  if (!node || node.nodeType !== Node.TEXT_NODE || !element.contains(node)) return null;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (candidate) =>
      candidate.parentElement?.closest('[aria-hidden="true"]')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  let total = 0;
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current === node) return total + offset;
    total += (current.nodeValue ?? "").length;
  }
  return null;
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
  const [active, setActive] = useState<ActiveCell | null>(null);
  // The cell a press landed on, recorded before the Block is active.
  //
  // A press activates the Block, but `editable` is still false while it is being handled, so a
  // handler guarded on it records nothing and activation falls back to the first cell: clicking any
  // cell of an unfocused table put the caret in the header. A ref rather than state, because it must
  // survive the render that activation triggers without causing one of its own.
  /**
   * The row and column under the pointer, and the axis whose menu is open.
   *
   * Revealing every handle at once whenever the pointer was anywhere in the table put a dot on every
   * row and every column simultaneously, which is nothing like the reference product: there, the
   * handle belongs to the one row or column you are on, and pressing it outlines that row or column.
   */
  const [hovered, setHovered] = useState<{ row: number; column: number } | null>(null);
  const [openAxis, setOpenAxis] = useState<{ axis: "row" | "column"; index: number } | null>(null);
  const pendingCellRef = useRef<TableCellAddress | null>(null);
  const pendingCaretOffsetRef = useRef<ActiveCell["caret"]>(null);

  // A Block that is active must always own an editing surface: the runtime, the tests and the
  // caret-restore machinery all look for one. Landing on the first cell is the equivalent of a
  // paragraph taking a caret when it is activated with no click position.
  useEffect(() => {
    if (!editable) {
      setActive(null);
      return;
    }
    if (active !== null) return;
    const pending = pendingCellRef.current;
    const caret = pendingCaretOffsetRef.current;
    pendingCellRef.current = null;
    pendingCaretOffsetRef.current = null;
    setActive({ row: pending?.row ?? 0, column: pending?.column ?? 0, caret });
  }, [editable, active]);

  // An address outside the drawn grid is indistinguishable from having no editing surface: the row
  // still reports itself active while nothing holds focus. The effect above cannot catch it, because
  // it returns early whenever there is already an address. Clamped on every render instead, so no
  // route to a stale address — a Tab, a deleted column, a re-parse that narrows the table — can leave
  // the Block without the one editor the contract requires it to have.
  useEffect(() => {
    if (!editable || active === null) return;
    const row = Math.min(active.row, Math.max(geometry.rowCount - 1, 0));
    const column = Math.min(active.column, Math.max(geometry.alignments.length - 1, 0));
    if (row === active.row && column === active.column) return;
    setActive({ row, column, caret: active.caret });
  }, [editable, active, geometry.rowCount, geometry.alignments.length]);

  // The caret directive is one-shot. It is a prop, so leaving it set re-applied it on every render —
  // and a render happens on every keystroke, which pinned the caret to the position the press landed
  // on and made typing come out backwards: "xyz" reached the file as "zyx".
  useEffect(() => {
    if (active === null || active.caret === null) return;
    setActive({ row: active.row, column: active.column, caret: null });
  }, [active]);

  // Focus follows the active cell without any help here: moving cells mounts a different editor at a
  // different position in the tree, and it takes focus itself. The caret it should land on is passed
  // as a selection rather than set imperatively afterwards, so there is no frame where the cell is
  // focused with the caret still at the wrong end.

  const cellAt = (row: number, column: number): MarkdownTableCell | undefined =>
    geometry.cells.find((candidate) => candidate.row === row && candidate.column === column);

  const commit = (next: string | null) => {
    if (next === null || next === source) return;
    onChange?.(blockId, next);
  };

  /**
   * Replace one cell's text, leaving the padding either side of it exactly as the user aligned it.
   */
  const commitCell = (cell: MarkdownTableCell, text: string) => {
    commit(source.slice(0, cell.from) + text + source.slice(cell.to));
  };

  /**
   * Record which cell a press landed on, and where in it.
   *
   * The offset is measured against the cell's *rendered* text and mapped back through the payload's
   * own inline projection, so a press inside `**bold**` lands on the character shown rather than
   * somewhere inside the delimiters that are not.
   */
  const pressCell = (
    event: PointerEvent,
    element: HTMLElement,
    address: TableCellAddress,
    cell: MarkdownTableCell | undefined
  ) => {
    if (!cell) return;
    // A press already inside an editing surface belongs to that surface: it is how the caret is
    // placed and how a drag-selection starts, and taking it over here would break both.
    if ((event.target as HTMLElement | null)?.closest("[data-native-block-editor]")) return;
    // A `<td>` cannot hold focus, so the browser's default action walks up to the row's `tabindex`
    // and focuses *that* — after this handler has already moved the editor to the pressed cell. The
    // editor would mount, focus itself, and then lose focus to the row in the same gesture, leaving
    // a Block that looks focused with every keystroke going to the document. Placing the caret is
    // this handler's job, so the default focus is not wanted.
    event.preventDefault();
    let caret: ActiveCell["caret"] = null;
    const visible = visibleOffsetAtPoint(element, event.clientX, event.clientY);
    if (visible !== null) {
      const text = source.slice(cell.from, cell.to);
      // Measured against the text as it is rendered — escaped pipes resolved — and mapped back to
      // the source through both of the things that shorten it: the table's own escape, then the
      // inline syntax the projection hides.
      const rendered = markdownTableCellText(text);
      caret = markdownTableCellSourceOffset(
        text,
        projectMarkdownInline(rendered).visibleOffsetToSource(
          Math.min(visible, rendered.length),
          "forward"
        )
      );
    }
    pendingCellRef.current = address;
    pendingCaretOffsetRef.current = caret;
    if (editable) setActive({ ...address, caret });
  };

  const moveTo = (row: number, column: number, caret: "start" | "end") => {
    if (!cellAt(row, column)) return false;
    setActive({ row, column, caret });
    return true;
  };

  /** The next or previous cell in reading order, wrapping across row boundaries. */
  const step = (from: TableCellAddress, direction: -1 | 1): boolean => {
    // Only cells the grid draws. A ragged row — more pipes than the delimiter declares columns, which
    // the parser keeps rather than discarding the user's text — leaves extra cells in `geometry` that
    // no `<tr>` renders, because both map over `alignments`. Tab used to walk into one: the address
    // moved, no editor mounted at it, and focus fell to `<body>` with the row still marked active, so
    // every keystroke after that went nowhere until the table was clicked again.
    const ordered = geometry.cells
      .filter((candidate) => candidate.column < geometry.alignments.length)
      .sort((a, b) => a.row - b.row || a.column - b.column);
    const index = ordered.findIndex(
      (candidate) => candidate.row === from.row && candidate.column === from.column
    );
    const next = ordered[index + direction];
    if (!next) return false;
    return moveTo(next.row, next.column, direction === 1 ? "end" : "end");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>, address: TableCellAddress) => {
    if (event.key === "Tab") {
      event.preventDefault();
      // Tab out of the last cell appends a row, the way a spreadsheet does, rather than escaping the
      // Block and leaving the user to find the gutter menu.
      if (!step(address, event.shiftKey ? -1 : 1) && !event.shiftKey) {
        const next = markdownTableInsertRow(source, geometry, geometry.rowCount - 1, "below");
        if (next) {
          setActive({ row: geometry.rowCount, column: 0, caret: "end" });
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
          setActive({ row: geometry.rowCount, column: address.column, caret: "end" });
          commit(next);
        }
      }
      return;
    }
    // Bare arrows only. A modifier turns these into something else entirely — Cmd+Up is
    // start-of-field, Alt+Up moves the Block — and treating them as cell navigation moved the caret
    // a row up instead, so pressing Cmd+Up in a body cell landed in the header.
    const plainArrow = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    if (plainArrow && event.key === "ArrowDown" && moveTo(address.row + 1, address.column, "end")) {
      event.preventDefault();
      return;
    }
    if (plainArrow && event.key === "ArrowUp" && moveTo(address.row - 1, address.column, "end")) {
      event.preventDefault();
      return;
    }
    // Everything the grid does not own belongs to the Block.
    onCellKeyDown?.(event);
  };

  /** A ring on every cell of the row or column whose menu is open, drawn with no layout cost. */
  const axisOutline = (row: number, column: number) => {
    if (!openAxis) return "";
    const inAxis = openAxis.axis === "row" ? openAxis.index === row : openAxis.index === column;
    return inAxis ? "ring-2 ring-inset ring-primary/70" : "";
  };

  const handleVisible = (axis: "row" | "column", index: number) => {
    if (openAxis && openAxis.axis === axis && openAxis.index === index) return true;
    if (!hovered) return false;
    return axis === "row" ? hovered.row === index : hovered.column === index;
  };

  /**
   * How a column's cells are to be aligned, as a signal a stylesheet can act on.
   *
   * The utility class on its own does not decide it: `.markdown-page th, .markdown-page td` in
   * editor.css sets `text-align` through an element selector, which outranks a lone class, so a
   * column the delimiter row centres was still drawn left-aligned inside the grid while the preview
   * and the export honoured it. The attribute is written on every cell, header cells included, so
   * the rule that reads it never has to guess which column a `<th>` belongs to.
   */
  const alignment = (column: number): "left" | "center" | "right" => {
    const declared = geometry.alignments[column];
    if (declared === "center") return "center";
    if (declared === "right") return "right";
    return "left";
  };

  const alignmentClass = (column: number) => {
    const value = alignment(column);
    if (value === "center") return "text-center";
    if (value === "right") return "text-right";
    return "text-left";
  };

  const renderBody = (cell: MarkdownTableCell | undefined, address: TableCellAddress) => {
    if (!cell) return null;
    const isActive = editable && active?.row === address.row && active?.column === address.column;
    if (!isActive) return renderCell(markdownTableCellText(source.slice(cell.from, cell.to)));
    return (
      <SemanticInlineEditor
        label="Table cell"
        // The cell's text, without the padding that surrounds it in the source. Holding the padding
        // instead made it visible the instant a cell was clicked: the line gained a leading space and
        // shifted almost six pixels sideways, which is the first thing anyone notices.
        //
        // The reason the padding was there was to keep a typed trailing space from disappearing. That
        // was the wrong trade: a pipe table cannot express trailing whitespace at all — `| a  |` and
        // `| a |` are the same cell to every reader of the format — so there is nothing to preserve,
        // and paying for it with a visible jump on every click was never worth it.
        source={source.slice(cell.from, cell.to)}
        selection={cellSelection(active?.caret ?? null, cell)}
        autoFocus
        className="native-block-editor-surface block w-full whitespace-pre-wrap break-words bg-transparent outline-none"
        onSourceChange={(next) => commitCell(cell, sanitiseCellPayload(next))}
        onKeyDown={(event) => handleKeyDown(event, address)}
        onPasteText={(text, selection) => {
          // A pipe row is one line, so pasted newlines are flattened here rather than left to break
          // the row apart, and a pasted pipe is escaped so it cannot invent a column.
          //
          // Returning `true` is not optional. Without it the editor treats the paste as unhandled and
          // runs its own insert as well, so one ⌘V produced two commits and two undo steps — the
          // first of which appended to the end of the cell regardless of where the caret was, so the
          // undo in between showed a string that had never been on screen.
          const current = source.slice(cell.from, cell.to);
          const from = Math.min(selection.anchor, selection.head);
          const to = Math.max(selection.anchor, selection.head);
          commitCell(cell, sanitiseCellPayload(current.slice(0, from) + text + current.slice(to)));
          return true;
        }}
      />
    );
  };

  const bodyRows = Array.from(
    { length: Math.max(geometry.rowCount - 1, 0) },
    (_, index) => index + 1
  );

  return (
    <div className="min-h-9 overflow-x-auto py-1 pl-3 pt-3">
      <table
        aria-label="Markdown table"
        className="w-full border-collapse text-left text-sm"
        onPointerLeave={() => setHovered(null)}
      >
        <thead>
          <tr>
            {geometry.alignments.map((_, column) => {
              const cell = cellAt(0, column);
              return (
                <th
                  key={`header-${column}`}
                  data-table-cell={cell ? `${cell.from}` : undefined}
                  data-align={alignment(column)}
                  className={`relative border border-border bg-muted/50 px-2 py-1.5 font-medium ${alignmentClass(column)} ${axisOutline(0, column)}`}
                  onPointerEnter={() => setHovered({ row: 0, column })}
                  onPointerDown={(event) =>
                    pressCell(event.nativeEvent, event.currentTarget, { row: 0, column }, cell)
                  }
                >
                  <span className="relative block">
                    <span className="pointer-events-none absolute inset-0">
                      <TableAxisMenu
                        enabled={editable}
                        axis="column"
                        label={`Column ${column + 1} actions`}
                        visible={handleVisible("column", column)}
                        onOpenChange={(open) =>
                          setOpenAxis(open ? { axis: "column", index: column } : null)
                        }
                        canDelete={geometry.columnCount > 1}
                        alignment={geometry.alignments[column] ?? null}
                        onSetAlignment={(next) =>
                          commit(markdownTableSetColumnAlignment(source, geometry, column, next))
                        }
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
                    </span>
                    {renderBody(cell, { row: 0, column })}
                  </span>
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
                    data-align={alignment(column)}
                    className={`relative border border-border px-2 py-1.5 ${alignmentClass(column)} ${axisOutline(row, column)}`}
                    onPointerEnter={() => setHovered({ row, column })}
                    onPointerDown={(event) =>
                      pressCell(event.nativeEvent, event.currentTarget, { row, column }, cell)
                    }
                  >
                    <span className="relative block">
                      {column === 0 ? (
                        <TableAxisMenu
                          enabled={editable}
                          axis="row"
                          label={`Row ${row + 1} actions`}
                          visible={handleVisible("row", row)}
                          onOpenChange={(open) =>
                            setOpenAxis(open ? { axis: "row", index: row } : null)
                          }
                          canDelete
                          onInsertBefore={() =>
                            commit(markdownTableInsertRow(source, geometry, row, "above"))
                          }
                          onInsertAfter={() =>
                            commit(markdownTableInsertRow(source, geometry, row, "below"))
                          }
                          onDuplicate={() =>
                            commit(markdownTableDuplicateRow(source, geometry, row))
                          }
                          onClear={() => commit(markdownTableClearRow(source, geometry, row))}
                          onDelete={() => commit(markdownTableDeleteRow(source, geometry, row))}
                        />
                      ) : null}
                      {renderBody(cell, { row, column })}
                    </span>
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
/** Where the caret goes when a cell's editor mounts, in the payload's own source offsets. */
function cellSelection(
  caret: ActiveCell["caret"],
  cell: MarkdownTableCell
): { anchor: number; head: number } | undefined {
  const length = cell.to - cell.from;
  if (caret === "end") return { anchor: length, head: length };
  if (caret === "start") return { anchor: 0, head: 0 };
  if (typeof caret === "number") {
    const at = Math.max(0, Math.min(caret, length));
    return { anchor: at, head: at };
  }
  return undefined;
}

function sanitiseCellPayload(value: string): string {
  // Each pipe is judged on its own. The previous pattern matched the character *before* a pipe and so
  // consumed it, which meant a run escaped only every other one: `a || b` came back `a \\|| b`, and
  // that surviving pipe ended the cell and gave the row a column the delimiter never declared.
  return value.replace(/\r\n|\n|\r/g, " ").replace(/(?<!\\)\|/g, "\\|");
}

/**
 * The handle and menu for one row or column.
 *
 * It lives inside the cell's own padding rather than in a reserved gutter: the grid scrolls
 * horizontally, so anything positioned outside it would be clipped, and reserving space would shift
 * the table relative to the body text around it.
 */
function TableAxisMenu({
  enabled,
  visible,
  onOpenChange,
  axis,
  label,
  canDelete,
  alignment,
  onSetAlignment,
  canInsertBefore = true,
  onInsertBefore,
  onInsertAfter,
  onDuplicate,
  onClear,
  onDelete,
}: {
  /**
   * Whether the handle can be used. It is always *mounted*: rendering it only while the Block is
   * active changed the gutter row's height on activation, which is the grow-on-focus this component
   * exists to prevent. The same tree in both states is the only way to be sure.
   */
  enabled: boolean;
  /** Whether this row's or column's handle is the one the pointer is on. */
  visible: boolean;
  onOpenChange: (open: boolean) => void;
  axis: "row" | "column";
  label: string;
  canDelete: boolean;
  /**
   * Only a column has an alignment. Passing nothing leaves the group out entirely rather than showing
   * a disabled one on a row, where the idea does not apply.
   */
  alignment?: MarkdownTableAlignment;
  onSetAlignment?: (next: MarkdownTableAlignment) => void;
  /** A pipe table's first line is its header, so nothing can go above it. */
  canInsertBefore?: boolean;
  onInsertBefore: () => void;
  onInsertAfter: () => void;
  onDuplicate: () => void;
  onClear: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          disabled={!enabled}
          tabIndex={enabled ? 0 : -1}
          data-axis-handle
          // Absolutely positioned so the handle cannot contribute height or width. Mounting it in
          // flow grew the gutter row from 13px to 37px the moment the Block was activated — the same
          // grow-on-focus this whole component exists to make impossible.
          className={`pointer-events-auto absolute flex items-center justify-center rounded-[3px] text-white transition-opacity duration-[20ms] ease-in focus-visible:opacity-100 ${
            visible ? "opacity-100" : "opacity-0"
          }`}
          // Inline rather than utility classes, and measured rather than derived. The offsets have to
          // be exact for the pill to sit in the margin instead of over the cell's first characters,
          // and a class assembled at runtime can silently fail to generate and drop it back into the
          // text — which is the whole complaint. Derivation does not work either: the containing block
          // is the overlay inside the cell's padding, not the cell, so arithmetic from the cell's own
          // box is off by the padding and the border, and the column pill landed 11.5px *below* the
          // cell's top edge, on top of the header text, until it was measured in the running app.
          //
          // The blue is the one the Block selection fill uses, which is the reference product's
          // measured accent; `bg-primary` is near-black in this theme and read as a smudge.
          style={
            axis === "row"
              ? {
                  top: "50%",
                  left: -14,
                  width: 9,
                  height: 22,
                  transform: "translateY(-50%)",
                  backgroundColor: "rgb(35, 131, 226)",
                }
              : {
                  left: "50%",
                  top: -29,
                  height: 9,
                  width: 22,
                  transform: "translateX(-50%)",
                  backgroundColor: "rgb(35, 131, 226)",
                }
          }
          onPointerDown={(event) => event.stopPropagation()}
        >
          {/* No text inside: a visually hidden label here would be real text inside the cell, and the
              caret mapping counts it — every press in that column then lands several characters off.
              The accessible name is on the button itself. */}
          {axis === "row" ? (
            <GripVertical className="h-3 w-3" aria-hidden="true" />
          ) : (
            <GripHorizontal className="h-3 w-3" aria-hidden="true" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        aria-label={label}
        className="w-48 rounded-xl border-border/80 bg-popover/95 p-1.5 shadow-xl backdrop-blur-xl"
      >
        <DropdownMenuItem
          className="h-8 rounded-lg px-2.5"
          disabled={!canInsertBefore}
          onClick={onInsertBefore}
        >
          {axis === "row" ? "Insert above" : "Insert left"}
        </DropdownMenuItem>
        <DropdownMenuItem className="h-8 rounded-lg px-2.5" onClick={onInsertAfter}>
          {axis === "row" ? "Insert below" : "Insert right"}
        </DropdownMenuItem>
        {onSetAlignment ? (
          <>
            <DropdownMenuSeparator />
            {/* The grid has always honoured `:--`, `:-:` and `--:`; nothing could write one, so the
                only way to align a column was to edit the file somewhere else. The current one is
                ticked rather than hidden, so the menu says what the column already is. */}
            {(
              [
                ["left", "Align left"],
                ["center", "Align centre"],
                ["right", "Align right"],
                [null, "Default alignment"],
              ] as [MarkdownTableAlignment, string][]
            ).map(([value, text]) => (
              <DropdownMenuItem
                key={text}
                className="h-8 rounded-lg px-2.5"
                onClick={() => onSetAlignment(value)}
              >
                <span className="w-4 shrink-0 text-muted-foreground" aria-hidden="true">
                  {alignment === value ? "✓" : ""}
                </span>
                {text}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        ) : null}
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
