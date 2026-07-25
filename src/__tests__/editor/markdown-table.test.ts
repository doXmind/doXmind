import { describe, expect, it } from "vitest";

import {
  markdownTableBlankRow,
  markdownTableCellAt,
  markdownTableNeighbourCell,
  parseMarkdownTableSource,
} from "@/editor/markdown-block/markdown-table";

const TABLE = "| A | B |\n| --- | :-: |\n| a1 | b1 |\n| a2 | b2 |";

describe("parseMarkdownTableSource", () => {
  it("maps every cell to the source range of its own text", () => {
    const geometry = parseMarkdownTableSource(TABLE);
    expect(geometry).not.toBeNull();
    const cell = (row: number, column: number) =>
      geometry!.cells.find((candidate) => candidate.row === row && candidate.column === column)!;

    // Ranges exclude the pipes and the padding, so the caret lands on the text itself.
    expect(TABLE.slice(cell(0, 0).from, cell(0, 0).to)).toBe("A");
    expect(TABLE.slice(cell(0, 1).from, cell(0, 1).to)).toBe("B");
    expect(TABLE.slice(cell(1, 0).from, cell(1, 0).to)).toBe("a1");
    expect(TABLE.slice(cell(2, 1).from, cell(2, 1).to)).toBe("b2");
    // The delimiter row is not a row.
    expect(geometry!.rowCount).toBe(3);
    expect(geometry!.columnCount).toBe(2);
  });

  it("reads column alignment from the delimiter row", () => {
    expect(
      parseMarkdownTableSource("| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |")?.alignments
    ).toEqual(["left", "center", "right"]);
    expect(parseMarkdownTableSource(TABLE)?.alignments).toEqual([null, "center"]);
  });

  it("handles tables without outer pipes and with an escaped pipe in a cell", () => {
    const bare = "a | b\n--- | ---\n1 | 2";
    const geometry = parseMarkdownTableSource(bare);
    expect(geometry?.columnCount).toBe(2);
    expect(bare.slice(geometry!.cells[0].from, geometry!.cells[0].to)).toBe("a");

    const escaped = "| a \\| b | c |\n| --- | --- |\n| 1 | 2 |";
    const withEscape = parseMarkdownTableSource(escaped);
    expect(withEscape?.columnCount).toBe(2);
    expect(escaped.slice(withEscape!.cells[0].from, withEscape!.cells[0].to)).toBe("a \\| b");
  });

  it("keeps an empty cell addressable as a zero-width range", () => {
    const source = "| a |  |\n| --- | --- |\n|  | d |";
    const geometry = parseMarkdownTableSource(source)!;
    const empty = geometry.cells.find((cell) => cell.row === 0 && cell.column === 1)!;
    expect(empty.from).toBe(empty.to);
    expect(source.slice(empty.from, empty.to)).toBe("");
  });

  it("refuses anything that is not a pipe table", () => {
    expect(parseMarkdownTableSource("just text")).toBeNull();
    expect(parseMarkdownTableSource("| a |\n| b |")).toBeNull();
    expect(parseMarkdownTableSource("| a |")).toBeNull();
  });

  it("survives CRLF", () => {
    const crlf = TABLE.replace(/\n/g, "\r\n");
    const geometry = parseMarkdownTableSource(crlf)!;
    expect(geometry.lineEnding).toBe("\r\n");
    const cell = geometry.cells.find((c) => c.row === 2 && c.column === 1)!;
    expect(crlf.slice(cell.from, cell.to)).toBe("b2");
  });
});

describe("table cell navigation", () => {
  it("walks cells in reading order and stops at both ends", () => {
    const geometry = parseMarkdownTableSource(TABLE)!;
    const first = geometry.cells[0];
    const last = geometry.cells[geometry.cells.length - 1];
    expect(markdownTableNeighbourCell(geometry, first, -1)).toBeNull();
    expect(markdownTableNeighbourCell(geometry, last, 1)).toBeNull();
    expect(markdownTableNeighbourCell(geometry, first, 1)).toMatchObject({ row: 0, column: 1 });
    // Forward from the end of a row wraps to the start of the next.
    expect(markdownTableNeighbourCell(geometry, { ...first, column: 1 }, 1)).toMatchObject({
      row: 1,
      column: 0,
    });
  });

  it("finds the cell a caret sits in, and the previous one when it sits on a pipe", () => {
    const geometry = parseMarkdownTableSource(TABLE)!;
    const b1 = geometry.cells.find((cell) => cell.row === 1 && cell.column === 1)!;
    expect(markdownTableCellAt(geometry, b1.from)).toMatchObject({ row: 1, column: 1 });
    expect(markdownTableCellAt(geometry, b1.to)).toMatchObject({ row: 1, column: 1 });
    expect(markdownTableCellAt(geometry, 0)).toMatchObject({ row: 0, column: 0 });
  });

  it("builds a blank row matching the column count", () => {
    expect(markdownTableBlankRow(parseMarkdownTableSource(TABLE)!)).toBe("\n|  |  |");
    expect(markdownTableBlankRow(parseMarkdownTableSource("|a|b|c|\n|-|-|-|\n|1|2|3|")!)).toBe(
      "\n|  |  |  |"
    );
  });
});
