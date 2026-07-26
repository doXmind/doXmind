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
  /**
   * Source range of everything between this cell's pipes, padding included.
   *
   * For the structural operations, which rewrite whole rows and columns and so have to know where
   * each cell's slot begins and ends, not just where its text sits.
   *
   * The cell editor deliberately shows the trimmed range instead: a payload value put the padding on
   * screen the instant a cell was clicked, shifting the line sideways. The round-trip is stable
   * anyway, because the editor's content is keyed by the trimmed text — committing `| a  |` reparses
   * to the same `a`, so React never rewrites the field and a just-typed trailing space survives in
   * the DOM until it becomes real text.
   */
  readonly payloadFrom: number;
  readonly payloadTo: number;
}

/** One physical line of the table, including the delimiter line that is not a row. */
export interface MarkdownTableLine {
  readonly from: number;
  readonly to: number;
  /** Payload spans between the pipes, in column order. */
  readonly payloads: readonly { readonly from: number; readonly to: number }[];
}

export interface MarkdownTableGeometry {
  readonly cells: readonly MarkdownTableCell[];
  readonly alignments: readonly MarkdownTableAlignment[];
  readonly columnCount: number;
  readonly rowCount: number;
  /** Every line in source order. `lines[1]` is always the delimiter. */
  readonly lines: readonly MarkdownTableLine[];
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
    // Read the terminator that actually follows this line rather than assuming the file's dominant
    // one: a table with mixed endings would otherwise shift every offset after the first oddity by a
    // character, and every offset here is something a caret is placed by.
    offset += raw.length + (source.startsWith("\r\n", offset + raw.length) ? 2 : 1);
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
  const geometryLines: MarkdownTableLine[] = [];
  let row = 0;
  for (const [index, line] of lines.entries()) {
    const spans = splitRow(line.text, line.from);
    geometryLines.push({
      from: line.from,
      to: line.from + line.text.length,
      payloads: spans.map((span) => ({ from: span.payloadFrom, to: span.payloadTo })),
    });
    if (index === 1) continue;
    for (const [column, span] of spans.entries()) {
      cells.push({
        row,
        column,
        from: span.from,
        to: span.to,
        payloadFrom: span.payloadFrom,
        payloadTo: span.payloadTo,
      });
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
    lines: geometryLines,
    appendAt: last.from + last.text.length,
    lineEnding,
  };
}

interface CellSpan {
  readonly from: number;
  readonly to: number;
  readonly payloadFrom: number;
  readonly payloadTo: number;
}

/** Trimmed and untrimmed source ranges for every cell on one table line. */
function splitRow(text: string, lineFrom: number): CellSpan[] {
  const spans: CellSpan[] = [];
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
        spans.push({
          from: lineFrom + start,
          to: lineFrom + start + trimmed.length,
          payloadFrom: lineFrom + cellStart,
          payloadTo: lineFrom + index,
        });
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

/**
 * A line taken apart at its pipes, so a column can be added or removed without reformatting.
 *
 * `leading` is everything before the first payload and `trailing` everything after the last, which
 * is how a table that omits its outer pipes, or pads them unevenly, keeps its exact shape through a
 * column edit. Rebuilding a line as `"| " + cells.join(" | ") + " |"` would be far simpler and would
 * silently reformat every row of a table the user had aligned by hand.
 */
interface TableLineParts {
  readonly leading: string;
  readonly payloads: string[];
  readonly trailing: string;
}

function lineParts(source: string, line: MarkdownTableLine): TableLineParts | null {
  const first = line.payloads[0];
  const last = line.payloads[line.payloads.length - 1];
  if (!first || !last) return null;
  return {
    leading: source.slice(line.from, first.from),
    payloads: line.payloads.map((payload) => source.slice(payload.from, payload.to)),
    trailing: source.slice(last.to, line.to),
  };
}

function renderLine(parts: TableLineParts): string {
  const text = parts.leading + parts.payloads.join("|") + parts.trailing;
  // GFM lets a row omit its outer pipes, but such a row cannot express an *empty* first cell: with
  // no leading pipe the parser reads leading whitespace as indentation before the first pipe it
  // finds. Clearing the first cell of `c | d` therefore produced `  | d`, which reads as the single
  // cell `d` — the row silently lost a column while every other row kept it. A line that has just
  // acquired a blank first cell gets the pipe it now needs; one that never had a leading pipe and
  // still has content keeps its shape.
  if (!parts.leading.includes("|") && parts.payloads[0]?.trim() === "") return `|${text}`;
  return text;
}

/** Rewrite whole lines in place, from the end so earlier offsets stay valid. */
function replaceLines(
  source: string,
  lines: readonly MarkdownTableLine[],
  next: readonly (string | null)[]
): string {
  let result = source;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const text = next[index];
    if (text === null || text === undefined) continue;
    result = result.slice(0, lines[index].from) + text + result.slice(lines[index].to);
  }
  return result;
}

/** The delimiter cell for a new column, carrying an alignment when one is being copied. */
function delimiterPayload(alignment: MarkdownTableAlignment): string {
  if (alignment === "center") return " :-: ";
  if (alignment === "right") return " --: ";
  if (alignment === "left") return " :-- ";
  return " --- ";
}

/** Line index of a row, skipping the delimiter that sits between the header and the body. */
function lineIndexForRow(row: number): number {
  return row === 0 ? 0 : row + 1;
}

/**
 * Apply a transform to one column across every line, delimiter included.
 *
 * Every column operation has to touch the delimiter line or the table stops being a table: `marked`
 * needs the delimiter's cell count to match the header's, and one short delimiter turns the whole
 * Block back into a paragraph of pipes.
 */
function mapColumn(
  source: string,
  geometry: MarkdownTableGeometry,
  transform: (payloads: string[], isDelimiter: boolean) => boolean
): string | null {
  const next: (string | null)[] = [];
  let changed = false;
  for (const [index, line] of geometry.lines.entries()) {
    const parts = lineParts(source, line);
    if (!parts) {
      next.push(null);
      continue;
    }
    const payloads = [...parts.payloads];
    if (!transform(payloads, index === 1)) {
      next.push(null);
      continue;
    }
    changed = true;
    next.push(renderLine({ ...parts, payloads }));
  }
  return changed ? replaceLines(source, geometry.lines, next) : null;
}

export function markdownTableInsertColumn(
  source: string,
  geometry: MarkdownTableGeometry,
  at: number,
  where: "left" | "right"
): string | null {
  const target = where === "left" ? at : at + 1;
  return mapColumn(source, geometry, (payloads, isDelimiter) => {
    // A ragged line can be shorter than the header. Appending there rather than refusing keeps the
    // column count moving in the same direction on every line, which is what makes the table legal
    // again rather than more ragged.
    payloads.splice(
      Math.min(target, payloads.length),
      0,
      isDelimiter ? delimiterPayload(null) : "  "
    );
    return true;
  });
}

export function markdownTableDuplicateColumn(
  source: string,
  geometry: MarkdownTableGeometry,
  at: number
): string | null {
  const alignment = geometry.alignments[at] ?? null;
  return mapColumn(source, geometry, (payloads, isDelimiter) => {
    if (at >= payloads.length) return false;
    payloads.splice(at + 1, 0, isDelimiter ? delimiterPayload(alignment) : payloads[at]);
    return true;
  });
}

export function markdownTableClearColumn(
  source: string,
  geometry: MarkdownTableGeometry,
  at: number
): string | null {
  return mapColumn(source, geometry, (payloads, isDelimiter) => {
    // The delimiter is structure, not content: clearing a column must not blank the alignment row.
    if (isDelimiter || at >= payloads.length) return false;
    payloads[at] = "  ";
    return true;
  });
}

export function markdownTableDeleteColumn(
  source: string,
  geometry: MarkdownTableGeometry,
  at: number
): string | null {
  // A table with no columns is not a table. The caller disables the command, and this refuses too so
  // a keyboard route cannot get around it.
  if (geometry.columnCount <= 1) return null;
  return mapColumn(source, geometry, (payloads) => {
    if (at >= payloads.length) return false;
    payloads.splice(at, 1);
    return true;
  });
}

/** A blank body line shaped like the table's own rows. */
function blankRowLine(source: string, geometry: MarkdownTableGeometry): string | null {
  const model = geometry.lines[geometry.lines.length - 1] ?? geometry.lines[0];
  const parts = lineParts(source, model);
  if (!parts) return null;
  return renderLine({
    ...parts,
    payloads: Array.from({ length: Math.max(geometry.columnCount, 1) }, () => "  "),
  });
}

export function markdownTableInsertRow(
  source: string,
  geometry: MarkdownTableGeometry,
  atRow: number,
  where: "above" | "below"
): string | null {
  // A pipe table's first line *is* its header. There is no way to express a row above it, so the
  // command is refused rather than quietly inserting a second header.
  if (atRow === 0 && where === "above") return null;
  const line = blankRowLine(source, geometry);
  if (line === null) return null;
  const anchorIndex = lineIndexForRow(atRow);
  // Below the header means below the delimiter, never between the two.
  const insertAfter = where === "below" ? Math.max(anchorIndex, 1) : anchorIndex - 1;
  const anchor = geometry.lines[insertAfter];
  if (!anchor) return null;
  return source.slice(0, anchor.to) + geometry.lineEnding + line + source.slice(anchor.to);
}

export function markdownTableDuplicateRow(
  source: string,
  geometry: MarkdownTableGeometry,
  atRow: number
): string | null {
  const index = lineIndexForRow(atRow);
  const line = geometry.lines[index];
  if (!line) return null;
  const text = source.slice(line.from, line.to);
  // A duplicated header would leave two header lines and one delimiter, so the copy goes into the
  // body where a copy of that text is still a legal row.
  const anchor = atRow === 0 ? geometry.lines[1] : line;
  if (!anchor) return null;
  return source.slice(0, anchor.to) + geometry.lineEnding + text + source.slice(anchor.to);
}

export function markdownTableClearRow(
  source: string,
  geometry: MarkdownTableGeometry,
  atRow: number
): string | null {
  const index = lineIndexForRow(atRow);
  const line = geometry.lines[index];
  if (!line) return null;
  const parts = lineParts(source, line);
  if (!parts) return null;
  const cleared = renderLine({ ...parts, payloads: parts.payloads.map(() => "  ") });
  return source.slice(0, line.from) + cleared + source.slice(line.to);
}

export function markdownTableDeleteRow(
  source: string,
  geometry: MarkdownTableGeometry,
  atRow: number
): string | null {
  // Removing the header would leave the delimiter first, and the Block would stop parsing as a
  // table at all — the rest of the document would absorb it as a paragraph of pipes.
  if (atRow === 0) return null;
  const index = lineIndexForRow(atRow);
  const line = geometry.lines[index];
  if (!line) return null;
  const previous = geometry.lines[index - 1];
  // Take the line together with one terminator: the preceding one when this is the last line, so no
  // blank line is left behind at the end of the table.
  const from = index === geometry.lines.length - 1 && previous ? previous.to : line.from;
  const to =
    index === geometry.lines.length - 1 ? line.to : (geometry.lines[index + 1]?.from ?? line.to);
  return source.slice(0, from) + source.slice(to);
}

/** A blank row with the table's column count, ready to append at `appendAt`. */
export function markdownTableBlankRow(geometry: MarkdownTableGeometry): string {
  const cells = Array.from({ length: Math.max(geometry.columnCount, 1) }, () => "  ").join("|");
  return `${geometry.lineEnding}|${cells}|`;
}
