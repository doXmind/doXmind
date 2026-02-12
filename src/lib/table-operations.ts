/**
 * Table Operations
 *
 * Utility functions for Notion-style table interactions.
 * Used by table handles, column/row context menus, and edge + buttons.
 * TipTap table commands operate on "the current cell," so most operations
 * require focusing a cell first via focusCellAt().
 */

import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";

/**
 * Get the DOM <table> element for the table currently under selection.
 */
export function getTableElement(editor: Editor): HTMLTableElement | null {
  const { selection } = editor.state;
  const $pos = selection.$from;

  // Walk up from selection to find a table node
  for (let depth = $pos.depth; depth >= 0; depth--) {
    if ($pos.node(depth).type.name === "table") {
      const dom = editor.view.nodeDOM($pos.before(depth)) as HTMLElement | null;
      if (dom) {
        // nodeDOM might return the wrapper div or the table itself
        return (
          dom.querySelector("table") || (dom.tagName === "TABLE" ? (dom as HTMLTableElement) : null)
        );
      }
    }
  }
  return null;
}

/**
 * Get the ProseMirror position of the table node from the current selection.
 */
export function getTableNodePos(editor: Editor): number | null {
  const { selection } = editor.state;
  const $pos = selection.$from;

  for (let depth = $pos.depth; depth >= 0; depth--) {
    if ($pos.node(depth).type.name === "table") {
      return $pos.before(depth);
    }
  }
  return null;
}

/**
 * Get the number of columns in a table element.
 * Uses colgroup if available, otherwise counts cells in the first row.
 */
export function getColumnCount(tableEl: HTMLTableElement): number {
  // Try colgroup first (always correct even with colspan)
  const colgroup = tableEl.querySelector("colgroup");
  if (colgroup) {
    return colgroup.children.length;
  }

  // Fallback: count cells in first row
  const firstRow = tableEl.querySelector("tr");
  if (firstRow) {
    let count = 0;
    for (const cell of Array.from(firstRow.cells)) {
      count += cell.colSpan || 1;
    }
    return count;
  }
  return 0;
}

/**
 * Get the number of rows in a table element.
 */
export function getRowCount(tableEl: HTMLTableElement): number {
  return tableEl.querySelectorAll("tr").length;
}

/**
 * Place the cursor in a specific cell so that subsequent TipTap table
 * commands (addColumnBefore, deleteRow, etc.) operate on that cell.
 *
 * Walks the ProseMirror document structure: table → tableRow → tableCell/tableHeader
 */
export function focusCellAt(
  editor: Editor,
  tablePos: number,
  rowIndex: number,
  colIndex: number
): boolean {
  try {
    const tableNode = editor.state.doc.nodeAt(tablePos);
    if (!tableNode || tableNode.type.name !== "table") return false;

    let pos = tablePos + 1; // Enter the table node

    // Walk to the target row
    for (let r = 0; r < tableNode.childCount; r++) {
      const row = tableNode.child(r);
      if (r === rowIndex) {
        pos += 1; // Enter the row node

        // Walk to the target column
        for (let c = 0; c < row.childCount; c++) {
          if (c === colIndex) {
            pos += 1; // Enter the cell node
            // Use TextSelection.near() to find the nearest valid text cursor
            // position. pos is inside the cell but before the paragraph —
            // NOT a valid text position. near() resolves into the paragraph.
            const $pos = editor.state.doc.resolve(pos);
            const sel = TextSelection.near($pos);
            editor.view.dispatch(editor.state.tr.setSelection(sel));
            editor.view.focus();
            return true;
          }
          pos += row.child(c).nodeSize;
        }
        return false;
      }
      pos += row.nodeSize;
    }
  } catch {
    // Position out of range
  }
  return false;
}

/**
 * Duplicate a column by adding a column after and copying cell content.
 */
export function duplicateColumn(editor: Editor, tablePos: number, colIndex: number): boolean {
  // Focus the target column first
  if (!focusCellAt(editor, tablePos, 0, colIndex)) return false;

  // Add column after
  editor.chain().focus().addColumnAfter().run();

  // Copy content from the original column to the new one
  // After addColumnAfter, the new column is at colIndex + 1
  const tableNode = editor.state.doc.nodeAt(tablePos);
  if (!tableNode) return true;

  // Get updated table pos (transactions may have changed positions)
  // Re-read the table to copy cell content
  const { tr } = editor.state;
  let pos = tablePos + 1;

  for (let r = 0; r < tableNode.childCount; r++) {
    const row = tableNode.child(r);
    let cellPos = pos + 1; // Enter the row

    for (let c = 0; c < row.childCount; c++) {
      const cell = row.child(c);
      if (c === colIndex) {
        // This is the source column — get its content
        const sourceContent = cell.content;
        // The new column is at colIndex + 1
        // Calculate the destination cell position
        const destCellPos = cellPos + cell.nodeSize;
        const destCell = row.child(c + 1);
        if (destCell && sourceContent.size > 0) {
          // Replace destination cell content
          tr.replaceWith(destCellPos + 1, destCellPos + destCell.content.size + 1, sourceContent);
        }
        break;
      }
      cellPos += cell.nodeSize;
    }
    pos += row.nodeSize;
  }

  editor.view.dispatch(tr);
  return true;
}

/**
 * Duplicate a row by adding a row after and copying cell content.
 */
export function duplicateRow(editor: Editor, tablePos: number, rowIndex: number): boolean {
  // Focus a cell in the target row
  if (!focusCellAt(editor, tablePos, rowIndex, 0)) return false;

  // Add row after
  editor.chain().focus().addRowAfter().run();

  // Copy content from the original row to the new one
  const tableNode = editor.state.doc.nodeAt(tablePos);
  if (!tableNode) return true;

  const { tr } = editor.state;
  let pos = tablePos + 1;

  for (let r = 0; r < tableNode.childCount; r++) {
    const row = tableNode.child(r);
    if (r === rowIndex) {
      // Source row found — the new row is right after it (r + 1)
      const newRow = tableNode.child(r + 1);
      if (!newRow) break;

      const newRowPos = pos + row.nodeSize;
      let dstCellPos = newRowPos + 1;

      for (let c = 0; c < row.childCount && c < newRow.childCount; c++) {
        const srcCell = row.child(c);
        const dstCell = newRow.child(c);

        if (srcCell.content.size > 0) {
          tr.replaceWith(dstCellPos + 1, dstCellPos + dstCell.content.size + 1, srcCell.content);
        }

        dstCellPos += dstCell.nodeSize;
      }
      break;
    }
    pos += row.nodeSize;
  }

  editor.view.dispatch(tr);
  return true;
}

/**
 * Clear all cell contents in a column.
 */
export function clearColumn(editor: Editor, tablePos: number, colIndex: number): boolean {
  const tableNode = editor.state.doc.nodeAt(tablePos);
  if (!tableNode) return false;

  const { tr } = editor.state;
  let pos = tablePos + 1;
  let changed = false;

  for (let r = 0; r < tableNode.childCount; r++) {
    const row = tableNode.child(r);
    let cellPos = pos + 1;

    for (let c = 0; c < row.childCount; c++) {
      const cell = row.child(c);
      if (c === colIndex && cell.content.size > 0) {
        // Replace cell content with an empty paragraph
        const emptyParagraph = editor.state.schema.nodes.paragraph.create();
        tr.replaceWith(cellPos + 1, cellPos + cell.content.size + 1, emptyParagraph);
        changed = true;
      }
      cellPos += cell.nodeSize;
    }
    pos += row.nodeSize;
  }

  if (changed) {
    editor.view.dispatch(tr);
  }
  return changed;
}

/**
 * Clear all cell contents in a row.
 */
export function clearRow(editor: Editor, tablePos: number, rowIndex: number): boolean {
  const tableNode = editor.state.doc.nodeAt(tablePos);
  if (!tableNode) return false;

  const { tr } = editor.state;
  let pos = tablePos + 1;
  let changed = false;

  for (let r = 0; r < tableNode.childCount; r++) {
    const row = tableNode.child(r);
    if (r === rowIndex) {
      let cellPos = pos + 1;
      for (let c = 0; c < row.childCount; c++) {
        const cell = row.child(c);
        if (cell.content.size > 0) {
          const emptyParagraph = editor.state.schema.nodes.paragraph.create();
          tr.replaceWith(cellPos + 1, cellPos + cell.content.size + 1, emptyParagraph);
          changed = true;
        }
        cellPos += cell.nodeSize;
      }
      break;
    }
    pos += row.nodeSize;
  }

  if (changed) {
    editor.view.dispatch(tr);
  }
  return changed;
}

/**
 * Check if the header row is active (first row uses <th> elements).
 * Accepts tablePos directly so it can be called during render without side effects.
 */
export function isHeaderRowActive(editor: Editor, tablePos: number): boolean {
  const tableNode = editor.state.doc.nodeAt(tablePos);
  if (!tableNode || tableNode.childCount === 0) return false;

  const firstRow = tableNode.child(0);
  // Check if all cells in the first row are header cells
  for (let c = 0; c < firstRow.childCount; c++) {
    if (firstRow.child(c).type.name !== "tableHeader") return false;
  }
  return true;
}

/**
 * Check if the header column is active (first cell of each row is <th>).
 * Accepts tablePos directly so it can be called during render without side effects.
 */
export function isHeaderColumnActive(editor: Editor, tablePos: number): boolean {
  const tableNode = editor.state.doc.nodeAt(tablePos);
  if (!tableNode) return false;

  for (let r = 0; r < tableNode.childCount; r++) {
    const row = tableNode.child(r);
    if (row.childCount === 0) continue;
    if (row.child(0).type.name !== "tableHeader") return false;
  }
  return true;
}

/**
 * Get the ProseMirror position of a cell at (rowIndex, colIndex) within a table.
 * Returns the position right before the cell node, suitable for CellSelection.
 */
export function getCellPos(
  editor: Editor,
  tablePos: number,
  rowIndex: number,
  colIndex: number
): number | null {
  try {
    const tableNode = editor.state.doc.nodeAt(tablePos);
    if (!tableNode || tableNode.type.name !== "table") return null;

    let pos = tablePos + 1; // Enter the table

    for (let r = 0; r < tableNode.childCount; r++) {
      const row = tableNode.child(r);
      if (r === rowIndex) {
        pos += 1; // Enter the row
        for (let c = 0; c < row.childCount; c++) {
          if (c === colIndex) {
            return pos; // Position of the cell node
          }
          pos += row.child(c).nodeSize;
        }
        return null;
      }
      pos += row.nodeSize;
    }
  } catch {
    // Position out of range
  }
  return null;
}

/**
 * Select all cells in a column using CellSelection.
 * Anchor = first row's cell, Head = last row's cell.
 */
export function selectColumn(editor: Editor, tablePos: number, colIndex: number): boolean {
  const tableNode = editor.state.doc.nodeAt(tablePos);
  if (!tableNode) return false;

  const rowCount = tableNode.childCount;
  if (rowCount === 0) return false;

  const anchorPos = getCellPos(editor, tablePos, 0, colIndex);
  const headPos = getCellPos(editor, tablePos, rowCount - 1, colIndex);
  if (anchorPos === null || headPos === null) return false;

  try {
    const $anchor = editor.state.doc.resolve(anchorPos);
    const $head = editor.state.doc.resolve(headPos);
    const selection = new CellSelection($anchor, $head);
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    return true;
  } catch {
    return false;
  }
}

/**
 * Select all cells in a row using CellSelection.
 * Anchor = first column's cell, Head = last column's cell.
 */
export function selectRow(editor: Editor, tablePos: number, rowIndex: number): boolean {
  const tableNode = editor.state.doc.nodeAt(tablePos);
  if (!tableNode) return false;

  const row = tableNode.child(rowIndex);
  if (!row) return false;

  const colCount = row.childCount;
  if (colCount === 0) return false;

  const anchorPos = getCellPos(editor, tablePos, rowIndex, 0);
  const headPos = getCellPos(editor, tablePos, rowIndex, colCount - 1);
  if (anchorPos === null || headPos === null) return false;

  try {
    const $anchor = editor.state.doc.resolve(anchorPos);
    const $head = editor.state.doc.resolve(headPos);
    const selection = new CellSelection($anchor, $head);
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    return true;
  } catch {
    return false;
  }
}
