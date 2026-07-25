/**
 * Pipe-table geometry, measured against the Block's own source.
 *
 * A rendered table is not editable on its own; to put the caret in the cell the user clicked, or to
 * move it to the next one, something has to know where each cell's text lives in the source. That is
 * all this does — it never rewrites the table, so a table with ragged pipes or padding keeps its
 * exact bytes.
 */

export type MarkdownTableAlignment = "left" | "center" | "right" | null;

export interface MarkdownTableCell {
  /** Row index, where 0 is the header. The delimiter row is not a row. */
  readonly row: number;
  readonly column: number;
  /** Source range of the cell's text, excluding the surrounding pipes and padding. */
  readonly from: number;
  readonly to: number;
}

export interface MarkdownTableGeometry {
  readonly cells: readonly MarkdownTableCell[];
  readonly alignments: readonly MarkdownTableAlignment[];
  readonly columnCount: number;
  readonly rowCount: number;
  /** Source offset just past the last row's line ending, where a new row is appended. */
  readonly appendAt: number;
  readonly lineEnding: "\r\n" | "\n" | "\r";
}

const DELIMITER_CELL = /^\s*:?-{1,}:?\s*$/;

/**
 * Split a pipe table into cells with source ranges, or null when the source is not one.
 *
 * Deliberately tolerant: a table whose rows disagree on column count still parses, because the file
 * is the user's and a ragged table is still a table they can edit.
 */
export function parseMarkdownTableSource(source: string): MarkdownTableGeometry | null {
  const lineEnding = source.includes("\r\n") ? "\r\n" : source.includes("\r") ? "\r" : "\n";
  const lines: { text: string; from: number }[] = [];
  let offset = 0;
  for (const raw of source.split(/\r\n|\n|\r/)) {
    lines.push({ text: raw, from: offset });
    offset += raw.length + lineEnding.length;
  }
  while (lines.length > 0 && lines[lines.length - 1].text.trim() === "") lines.pop();
  if (lines.length < 2) return null;
  if (!lines[0].text.includes("|")) return null;

  const delimiterCells = splitRow(lines[1].text, lines[1].from);
  if (delimiterCells.length === 0) return null;
  for (const cell of delimiterCells) {
    if (
      !DELIMITER_CELL.test(lines[1].text.slice(cell.from - lines[1].from, cell.to - lines[1].from))
    ) {
      return null;
    }
  }

  const alignments = delimiterCells.map((cell): MarkdownTableAlignment => {
    const text = lines[1].text.slice(cell.from - lines[1].from, cell.to - lines[1].from).trim();
    const left = text.startsWith(":");
    const right = text.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });

  const cells: MarkdownTableCell[] = [];
  let row = 0;
  for (const [index, line] of lines.entries()) {
    if (index === 1) continue;
    for (const [column, span] of splitRow(line.text, line.from).entries()) {
      cells.push({ row, column, from: span.from, to: span.to });
    }
    row += 1;
  }
  if (cells.length === 0) return null;

  const last = lines[lines.length - 1];
  return {
    cells,
    alignments,
    columnCount: alignments.length,
    rowCount: row,
    appendAt: last.from + last.text.length,
    lineEnding,
  };
}

/** Source range of the cell's trimmed text for every cell on one table line. */
function splitRow(text: string, lineFrom: number): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  let cursor = 0;
  // A leading pipe is optional in GFM, and so is a trailing one.
  if (text.trimStart().startsWith("|")) cursor = text.indexOf("|") + 1;
  let cellStart = cursor;
  let escaped = false;
  for (let index = cursor; index <= text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|" || index === text.length) {
      const raw = text.slice(cellStart, index);
      // An unpadded trailing pipe produces an empty final cell, which is not a column.
      if (!(index === text.length && raw.trim() === "" && spans.length > 0)) {
        const trimmed = raw.trim();
        // An all-whitespace cell is a point, not an inverted range: counting leading and trailing
        // padding separately would put `from` past `to`. One space of padding is where a caret
        // belongs in `|  |`.
        const start = trimmed
          ? cellStart + (raw.length - raw.trimStart().length)
          : cellStart + Math.min(1, raw.length);
        spans.push({ from: lineFrom + start, to: lineFrom + start + trimmed.length });
      }
      cellStart = index + 1;
    }
  }
  return spans;
}

/**
 * The cell the caret sits in, or the nearest one before it.
 *
 * Used to answer "which cell is Tab leaving?" without the caller needing the geometry.
 */
export function markdownTableCellAt(
  geometry: MarkdownTableGeometry,
  offset: number
): MarkdownTableCell | null {
  let best: MarkdownTableCell | null = null;
  for (const cell of geometry.cells) {
    if (offset >= cell.from && offset <= cell.to) return cell;
    if (cell.to < offset && (!best || cell.to > best.to)) best = cell;
  }
  // Before the first cell — on the opening pipe — the answer is the first cell, not "nowhere".
  return best ?? geometry.cells[0] ?? null;
}

/** The cell one step forward or back in reading order, or null at either end. */
export function markdownTableNeighbourCell(
  geometry: MarkdownTableGeometry,
  cell: MarkdownTableCell,
  direction: -1 | 1
): MarkdownTableCell | null {
  const index = geometry.cells.findIndex(
    (candidate) => candidate.row === cell.row && candidate.column === cell.column
  );
  if (index < 0) return null;
  return geometry.cells[index + direction] ?? null;
}

/** A blank row with the table's column count, ready to append at `appendAt`. */
export function markdownTableBlankRow(geometry: MarkdownTableGeometry): string {
  const cells = Array.from({ length: Math.max(geometry.columnCount, 1) }, () => "  ").join("|");
  return `${geometry.lineEnding}|${cells}|`;
}
