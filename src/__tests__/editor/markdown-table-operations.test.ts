import { describe, expect, it } from "vitest";

import {
  markdownTableClearColumn,
  markdownTableSetColumnAlignment,
  markdownTableClearRow,
  markdownTableDeleteColumn,
  markdownTableDeleteRow,
  markdownTableDuplicateColumn,
  markdownTableDuplicateRow,
  markdownTableInsertColumn,
  markdownTableInsertRow,
  parseMarkdownTableSource,
  type MarkdownTableGeometry,
} from "@/editor/markdown-block/markdown-table";

/**
 * Structural table edits, asserted on the bytes.
 *
 * Every one of these rewrites lines the user did not press, so the thing worth pinning is not that
 * the grid looks right afterwards but that the file still says what they meant — the pipe style they
 * chose, the padding they aligned by hand, the escapes inside their cells, and above all a delimiter
 * row whose cell count still matches the header. One short delimiter and the Block stops parsing as
 * a table at all, which loses the whole grid rather than one cell.
 */

const SIMPLE = ["| a | b |", "| - | - |", "| 1 | 2 |"].join("\n");

/** Hand-aligned padding, an escaped pipe, and a row that omits its outer pipes. */
const AWKWARD = ["| name  | note   |", "| :---- | -----: |", "| a\\|b  | wide   |", "c | d"].join(
  "\n"
);

/** A table written entirely without outer pipes, which GFM allows and `marked` reads as a table. */
const BARE = ["Name | Role", "---- | ----", "Ada  | Eng", "Bob  | Ops"].join("\n");

function geometryOf(source: string): MarkdownTableGeometry {
  const geometry = parseMarkdownTableSource(source);
  if (!geometry) throw new Error("fixture is not a table");
  return geometry;
}

/** Every edit has to leave something that still parses, with the delimiter matching the header. */
function expectStillATable(source: string): MarkdownTableGeometry {
  const geometry = parseMarkdownTableSource(source);
  expect(geometry, `no longer a table:\n${source}`).not.toBeNull();
  const header = geometry!.lines[0].payloads.length;
  const delimiter = geometry!.lines[1].payloads.length;
  expect(delimiter, "delimiter no longer matches the header").toBe(header);
  return geometry!;
}

describe("markdown table column operations", () => {
  it("inserts a column into every line, giving the delimiter a delimiter cell", () => {
    const next = markdownTableInsertColumn(SIMPLE, geometryOf(SIMPLE), 1, "left");
    expect(next).toBe(["| a |  | b |", "| - | --- | - |", "| 1 |  | 2 |"].join("\n"));
    expectStillATable(next!);
  });

  it("inserts to the right of the last column without dropping it", () => {
    const next = markdownTableInsertColumn(SIMPLE, geometryOf(SIMPLE), 1, "right");
    const geometry = expectStillATable(next!);
    expect(geometry.columnCount).toBe(3);
  });

  it("duplicates a column and copies its alignment into the delimiter", () => {
    const next = markdownTableDuplicateColumn(AWKWARD, geometryOf(AWKWARD), 1);
    const geometry = expectStillATable(next!);
    expect(geometry.columnCount).toBe(3);
    // The duplicated column was right-aligned, so its copy has to be too, or the table silently
    // re-aligns a column the user set.
    expect(geometry.alignments[1]).toBe("right");
    expect(geometry.alignments[2]).toBe("right");
  });

  it("clears a column's cells but never the delimiter", () => {
    const next = markdownTableClearColumn(AWKWARD, geometryOf(AWKWARD), 0);
    const geometry = expectStillATable(next!);
    expect(geometry.alignments[0], "clearing content destroyed the alignment").toBe("left");
    const firstColumn = geometry.cells
      .filter((cell) => cell.column === 0)
      .map((cell) => next!.slice(cell.from, cell.to));
    expect(firstColumn.every((text) => text === "")).toBe(true);
  });

  it("deletes a column, and refuses to delete the only one", () => {
    const next = markdownTableDeleteColumn(SIMPLE, geometryOf(SIMPLE), 0);
    expect(next).toBe(["| b |", "| - |", "| 2 |"].join("\n"));
    const single = expectStillATable(next!);
    expect(markdownTableDeleteColumn(next!, single, 0)).toBeNull();
  });

  it("leaves a one-column table behind when the rows omit their outer pipes", () => {
    // `Name | Role` with its second column gone is `Name`, which has no pipe left and so is not a
    // row at all — and the delimiter reduced to `----` reads as the underline of a setext heading,
    // so the Block stops being a table and the whole grid is lost rather than one column.
    const next = markdownTableDeleteColumn(BARE, geometryOf(BARE), 1);
    expect(next).toBe(["|Name ", "|---- ", "|Ada  ", "|Bob  "].join("\n"));
    expect(expectStillATable(next!).columnCount).toBe(1);

    // The pipe goes in front of the surviving cell rather than after it, because the padding that
    // cell keeps would otherwise be indentation: `     Role|` is an indented code block.
    const first = markdownTableDeleteColumn(BARE, geometryOf(BARE), 0);
    expect(first).toBe(["| Role", "| ----", "| Eng", "| Ops"].join("\n"));
    expect(expectStillATable(first!).columnCount).toBe(1);
  });

  it("degrades the alignment row with the column it belongs to", () => {
    const aligned = ["Name | Role", ":--- | ---:", "Ada  | Eng"].join("\n");
    const next = markdownTableDeleteColumn(aligned, geometryOf(aligned), 1);
    expect(next).toBe(["|Name ", "|:--- ", "|Ada  "].join("\n"));
    expect(expectStillATable(next!).alignments).toEqual(["left"]);
  });

  it("keeps a one-column result a table when only the trailing pipe is written", () => {
    const trailing = ["a | b |", "- | - |", "1 | 2 |"].join("\n");
    const next = markdownTableDeleteColumn(trailing, geometryOf(trailing), 1);
    // The trailing pipe the rows already had is the separator, so nothing is added to them.
    expect(next).toBe(["a |", "- |", "1 |"].join("\n"));
    expect(expectStillATable(next!).columnCount).toBe(1);
  });

  it("keeps hand-aligned padding, escapes and a row that omits its outer pipes", () => {
    const next = markdownTableInsertColumn(AWKWARD, geometryOf(AWKWARD), 0, "right");
    expect(next).not.toBeNull();
    const lines = next!.split("\n");
    // The bare row stays bare rather than gaining pipes it never had.
    expect(lines[3].startsWith("|")).toBe(false);
    // The escape survives as an escape, not as a new column boundary.
    expect(next).toContain("a\\|b");
    const geometry = expectStillATable(next!);
    expect(geometry.columnCount).toBe(3);
  });

  it("keeps a pipe-less row's last cell when a column operation blanks it", () => {
    // Without a trailing pipe a blank last cell is not a cell at all: the row comes back one column
    // short of the delimiter and the whole Block reparses as a paragraph of raw pipes.
    const cleared = markdownTableClearColumn(BARE, geometryOf(BARE), 1);
    expect(cleared).toBe(["Name |  |", "---- | ----", "Ada  |  |", "Bob  |  |"].join("\n"));
    expect(expectStillATable(cleared!).columnCount).toBe(2);

    const inserted = markdownTableInsertColumn(BARE, geometryOf(BARE), 1, "right");
    expect(expectStillATable(inserted!).columnCount).toBe(3);
    // The rows that still end in content stay bare; only the one that just lost its last cell's
    // text gains the pipe it now needs.
    expect(inserted!.split("\n")[1]).toBe("---- | ----| --- ");
  });
});

describe("markdown table row operations", () => {
  it("inserts a row below the header without landing between header and delimiter", () => {
    const next = markdownTableInsertRow(SIMPLE, geometryOf(SIMPLE), 0, "below");
    expect(next).toBe(["| a | b |", "| - | - |", "|  |  |", "| 1 | 2 |"].join("\n"));
    expect(expectStillATable(next!).rowCount).toBe(3);
  });

  it("refuses to insert above the header, which a pipe table cannot express", () => {
    expect(markdownTableInsertRow(SIMPLE, geometryOf(SIMPLE), 0, "above")).toBeNull();
  });

  it("inserts above a body row", () => {
    const next = markdownTableInsertRow(SIMPLE, geometryOf(SIMPLE), 1, "above");
    expect(next).toBe(["| a | b |", "| - | - |", "|  |  |", "| 1 | 2 |"].join("\n"));
  });

  it("duplicates a body row verbatim", () => {
    const next = markdownTableDuplicateRow(SIMPLE, geometryOf(SIMPLE), 1);
    expect(next).toBe(["| a | b |", "| - | - |", "| 1 | 2 |", "| 1 | 2 |"].join("\n"));
  });

  it("duplicates the header into the body rather than making a second header", () => {
    const next = markdownTableDuplicateRow(SIMPLE, geometryOf(SIMPLE), 0);
    const geometry = expectStillATable(next!);
    expect(next!.split("\n")[1], "the delimiter must still be the second line").toBe("| - | - |");
    expect(geometry.rowCount).toBe(3);
  });

  it("clears a row's cells in place", () => {
    const next = markdownTableClearRow(SIMPLE, geometryOf(SIMPLE), 1);
    expect(next).toBe(["| a | b |", "| - | - |", "|  |  |"].join("\n"));
  });

  it("deletes a body row, and refuses to delete the header", () => {
    const next = markdownTableDeleteRow(SIMPLE, geometryOf(SIMPLE), 1);
    expect(next).toBe(["| a | b |", "| - | - |"].join("\n"));
    expectStillATable(next!);
    expect(markdownTableDeleteRow(SIMPLE, geometryOf(SIMPLE), 0)).toBeNull();
  });

  it("deletes the last row without leaving a blank line behind it", () => {
    const three = ["| a |", "| - |", "| 1 |", "| 2 |"].join("\n");
    const next = markdownTableDeleteRow(three, geometryOf(three), 2);
    expect(next).toBe(["| a |", "| - |", "| 1 |"].join("\n"));
  });

  it("gives a blank row every cell, even modelled on a row that omits its outer pipes", () => {
    // A row of blank cells cannot be written without outer pipes: the last one is dropped on
    // reparse, and the grid then draws a cell nothing can be typed into.
    const next = markdownTableInsertRow(BARE, geometryOf(BARE), 2, "below");
    expect(next!.split("\n")[4]).toBe("|  |  |");
    const geometry = expectStillATable(next!);
    expect(geometry.cells.some((cell) => cell.row === 3 && cell.column === 1)).toBe(true);

    const cleared = markdownTableClearRow(BARE, geometryOf(BARE), 0);
    expect(cleared!.split("\n")[0]).toBe("|  |  |");
    expect(expectStillATable(cleared!).columnCount).toBe(2);
  });

  it("keeps CRLF terminators when a row is inserted", () => {
    const crlf = ["| a | b |", "| - | - |", "| 1 | 2 |"].join("\r\n");
    const next = markdownTableInsertRow(crlf, geometryOf(crlf), 1, "below");
    expect(next).toBe(["| a | b |", "| - | - |", "| 1 | 2 |", "|  |  |"].join("\r\n"));
    expect(next).not.toContain("\n\n");
    expectStillATable(next!);
  });
});

describe("markdown table cell payloads", () => {
  it("exposes the untrimmed span between the pipes, so an edit is a verbatim splice", () => {
    const geometry = geometryOf(AWKWARD);
    const cell = geometry.cells.find((candidate) => candidate.row === 0 && candidate.column === 0);
    expect(cell).toBeDefined();
    // The trimmed range is the text; the payload is the text plus the padding the user aligned.
    expect(AWKWARD.slice(cell!.from, cell!.to)).toBe("name");
    expect(AWKWARD.slice(cell!.payloadFrom, cell!.payloadTo)).toBe(" name  ");
  });

  it("writes a column's alignment into the delimiter and nowhere else", () => {
    // The reader has honoured `:--`, `:-:` and `--:` since the grid existed, but nothing could write
    // one, so the only way to right-align a column was to open the file in another editor.
    const right = markdownTableSetColumnAlignment(SIMPLE, geometryOf(SIMPLE), 1, "right");
    expect(right).toBe(["| a | b |", "| - | --: |", "| 1 | 2 |"].join("\n"));
    expect(expectStillATable(right!).alignments).toEqual([null, "right"]);

    // Content lines are untouched: alignment is structure. The awkward fixture's hand-aligned
    // padding, its escaped pipe and its pipe-less last row all have to come back unchanged.
    const centred = markdownTableSetColumnAlignment(AWKWARD, geometryOf(AWKWARD), 0, "center");
    expect(centred).toBe(
      ["| name  | note   |", "| :-: | -----: |", "| a\\|b  | wide   |", "c | d"].join("\n")
    );
    expect(expectStillATable(centred!).alignments).toEqual(["center", "right"]);

    // Back to default, and a no-op when it is already what was asked for.
    const cleared = markdownTableSetColumnAlignment(AWKWARD, geometryOf(AWKWARD), 1, null);
    expect(expectStillATable(cleared!).alignments).toEqual(["left", null]);
    expect(markdownTableSetColumnAlignment(SIMPLE, geometryOf(SIMPLE), 0, null)).toBeNull();
    // A column the table does not have changes nothing.
    expect(markdownTableSetColumnAlignment(SIMPLE, geometryOf(SIMPLE), 9, "left")).toBeNull();
  });

  it("gives an empty cell a payload a caret can sit in", () => {
    const blank = ["| a | b |", "| - | - |", "|  |  |"].join("\n");
    const geometry = geometryOf(blank);
    const cell = geometry.cells.find((candidate) => candidate.row === 1 && candidate.column === 0);
    expect(cell).toBeDefined();
    expect(cell!.payloadTo).toBeGreaterThan(cell!.payloadFrom);
  });
});
