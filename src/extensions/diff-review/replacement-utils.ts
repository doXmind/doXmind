/**
 * Utility functions for calculating replacement ranges and handling
 * cross-block content replacement in ProseMirror documents.
 */

import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

export interface ReplacementRange {
  actualStart: number;
  actualEnd: number;
  isCrossBlock: boolean;
  shouldExpandToBlock: boolean;
  fromBlockType: string;
  toBlockType: string;
}

/**
 * Calculate the actual replacement range when content spans multiple blocks.
 * This ensures that when old_str contains content from multiple blocks (e.g., heading + list),
 * we replace from the START of the first block to the END of the last block.
 *
 * @param doc - The ProseMirror document
 * @param from - The starting position of the match
 * @param to - The ending position of the match
 * @param $from - Resolved position at 'from'
 * @param $to - Resolved position at 'to'
 * @returns ReplacementRange object with actual start/end positions and metadata
 */
export function calculateReplacementRange(
  doc: PMNode,
  from: number,
  to: number,
  $from: ResolvedPos,
  $to: ResolvedPos
): ReplacementRange {
  // Get the block-level nodes containing from and to
  const fromBlockType = $from.parent.type.name;
  const toBlockType = $to.parent.type.name;

  // Check if from and to are in different block-level nodes
  // We compare the block boundaries, not just the parent type
  const fromBlockStart = $from.start($from.depth);
  const fromBlockEnd = $from.end($from.depth);
  const toBlockStart = $to.start($to.depth);
  const toBlockEnd = $to.end($to.depth);

  // Content spans multiple blocks if:
  // 1. from and to are in different blocks (different start positions), OR
  // 2. to extends beyond the block containing from
  const isCrossBlock = fromBlockStart !== toBlockStart || to > fromBlockEnd;

  // Should expand to block boundaries if content doesn't fill the entire block
  // This is useful for detecting partial block selections that should be expanded
  const shouldExpandToBlock = from > fromBlockStart || to < toBlockEnd;

  if (isCrossBlock) {
    // Find the actual boundaries:
    // - actualStart: the start of the block containing 'from'
    // - actualEnd: the end of the block containing 'to'

    // For the start, we want to include the full first block
    let actualStart = fromBlockStart;

    // Walk up to find the top-level block if we're nested
    // (e.g., if from is in a paragraph inside a list item, we want the list item boundary)
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      // Stop at block-level nodes that are direct children of the document
      // or at certain container types
      if (
        d === 1 || // Top-level block
        ["heading", "paragraph", "codeBlock", "blockquote", "table"].includes(node.type.name)
      ) {
        actualStart = $from.before(d);
        break;
      }
    }

    // For the end, we want to include the full last block
    let actualEnd = toBlockEnd;

    // Walk up to find the top-level block containing 'to'
    for (let d = $to.depth; d > 0; d--) {
      const node = $to.node(d);
      if (
        d === 1 ||
        ["heading", "paragraph", "codeBlock", "blockquote", "table"].includes(node.type.name)
      ) {
        actualEnd = $to.after(d);
        break;
      }
    }

    // Ensure actualEnd is at least as large as 'to'
    actualEnd = Math.max(actualEnd, to);

    return {
      actualStart,
      actualEnd,
      isCrossBlock: true,
      shouldExpandToBlock,
      fromBlockType,
      toBlockType,
    };
  }

  // Not cross-block, return original positions
  return {
    actualStart: from,
    actualEnd: to,
    isCrossBlock: false,
    shouldExpandToBlock,
    fromBlockType,
    toBlockType,
  };
}

/**
 * Normalize table HTML for TipTap compatibility.
 *
 * TipTap's table extension doesn't parse <thead>/<tbody>/<colgroup> wrappers.
 * Since all content now comes as Markdown (converted by marked), the HTML structure is:
 * - <thead><tr><th>...</th></tr></thead> for header row
 * - <tbody><tr><td>...</td></tr></tbody> for body rows
 *
 * We simply unwrap thead/tbody and remove colgroup, preserving the correct <th>/<td> tags.
 */
export function normalizeTableHtml(element: HTMLElement): void {
  const tables = element.querySelectorAll("table");

  tables.forEach((table) => {
    // Remove <colgroup> - TipTap regenerates column structure
    table.querySelectorAll("colgroup").forEach((cg) => cg.remove());

    // Collect rows from thead and tbody in correct order
    const headerRows = Array.from(table.querySelectorAll("thead > tr"));
    const bodyRows = Array.from(table.querySelectorAll("tbody > tr"));

    // Remove thead and tbody wrappers (but keep the rows)
    table.querySelectorAll("thead").forEach((thead) => thead.remove());
    table.querySelectorAll("tbody").forEach((tbody) => tbody.remove());

    // Append rows directly to table in correct order
    headerRows.forEach((row) => table.appendChild(row));
    bodyRows.forEach((row) => table.appendChild(row));
  });
}

/**
 * Handle table replacement with proper boundary detection.
 * When replacing with a table, we need to find and replace the entire containing table node.
 */
export function handleTableReplacement(
  tr: Transaction,
  state: EditorState,
  from: number,
  to: number,
  $from: ResolvedPos,
  $to: ResolvedPos,
  firstChild: PMNode,
  parsedDoc: PMNode
): void {
  // Find all tables that contain our selection range
  let tableStart: number | null = null;
  let tableEnd: number | null = null;

  // Check if 'from' is inside a table
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "table") {
      tableStart = $from.before(d);
      const tempEnd = $from.after(d);

      // Check if 'to' is beyond this table
      if (to <= tempEnd) {
        tableEnd = tempEnd;
      } else {
        // 'to' extends beyond this table - find where it ends
        for (let d2 = $to.depth; d2 > 0; d2--) {
          const node2 = $to.node(d2);
          if (node2.type.name === "table") {
            tableEnd = $to.after(d2);
            break;
          }
        }
        if (tableEnd === null) {
          tableEnd = tempEnd;
        }
      }
      break;
    }
  }

  if (tableStart !== null && tableEnd !== null) {
    const nodeAtStart = state.doc.nodeAt(tableStart);
    const actualTableEnd = nodeAtStart ? tableStart + nodeAtStart.nodeSize : tableEnd;
    tr.replaceWith(tableStart, actualTableEnd, parsedDoc.content);
  } else {
    // Not inside a table, use standard replacement
    tr.replaceWith(from, to, parsedDoc.content);
  }
}
