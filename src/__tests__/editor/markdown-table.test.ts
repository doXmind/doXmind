import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import {
  markdownTableBlankRow,
  markdownTableCellAt,
  markdownTableCellSourceOffset,
  markdownTableCellText,
  markdownTableNeighbourCell,
  markdownTablePressedCell,
  parseMarkdownTableSource,
} from "@/editor/markdown-block/markdown-table";
import { MarkdownTableBlock } from "@/editor/markdown-block/markdown-table-block";

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

  it("answers a press on a column its row does not have with that row's last cell", () => {
    // A hand-written table whose first body row declares two cells against a three-column header.
    const ragged = "| A | B | C |\n| --- | --- | --- |\n| a1 | b1 |\n| a2 | b2 | c2 |";
    const geometry = parseMarkdownTableSource(ragged)!;

    expect(markdownTablePressedCell(geometry, { row: 1, column: 1 })).toMatchObject({
      row: 1,
      column: 1,
    });
    // Never the header at the opposite corner of the grid, which is where the caret used to land.
    expect(markdownTablePressedCell(geometry, { row: 1, column: 2 })).toMatchObject({
      row: 1,
      column: 1,
    });
    expect(markdownTablePressedCell(geometry, { row: 9, column: 0 })).toBeNull();
  });

  it("builds a blank row matching the column count", () => {
    expect(markdownTableBlankRow(parseMarkdownTableSource(TABLE)!)).toBe("\n|  |  |");
    expect(markdownTableBlankRow(parseMarkdownTableSource("|a|b|c|\n|-|-|-|\n|1|2|3|")!)).toBe(
      "\n|  |  |  |"
    );
  });
});

describe("table cell text", () => {
  it("resolves an escaped pipe, inside a code span as much as outside one", () => {
    // The escape belongs to the table syntax and is resolved before the cell is parsed as Markdown,
    // so it goes even where inline escapes do not apply.
    expect(markdownTableCellText("a \\| b")).toBe("a | b");
    expect(markdownTableCellText("`x \\| y`")).toBe("`x | y`");
    // Nothing else is this parser's escape: every other backslash is inline syntax and stays.
    expect(markdownTableCellText("a \\* b \\\\ c")).toBe("a \\* b \\\\ c");
  });

  it("maps an offset in the rendered text back to the source it came from", () => {
    const cell = "a \\| b";
    expect(markdownTableCellSourceOffset(cell, 0)).toBe(0);
    // Rendered as `a | b`: the space after the pipe is offset 3 there and offset 4 in the source.
    expect(markdownTableCellSourceOffset(cell, 3)).toBe(4);
    expect(markdownTableCellSourceOffset(cell, "a | b".length)).toBe(cell.length);
  });
});

describe("rendered grid", () => {
  const ALIGNED = "| a `x \\| y` | z |\n| --- | :-: |\n| 1 | 2 |";

  function renderGrid(source: string) {
    const geometry = parseMarkdownTableSource(source)!;
    return render(
      createElement(MarkdownTableBlock, {
        blockId: "block-1",
        source,
        geometry,
        editable: false,
        renderCell: (text: string) => createElement("span", null, text),
      })
    );
  }

  it("shows a cell's escaped pipe as the pipe it escapes", () => {
    const { container } = renderGrid(ALIGNED);
    expect(container.textContent).toContain("`x | y`");
    expect(container.textContent).not.toContain("\\|");
  });

  it("mounts a row's handle out of flow, the way the header mounts its own", () => {
    // The menu root is an `inline-block` element. In flow beside the cell body it cost nothing
    // until activation made the body a block and pushed it onto its own line box, growing the
    // pressed row by 24px and dropping its text out from under the pointer.
    const { container } = renderGrid(ALIGNED);
    const handles = container.querySelectorAll("[data-axis-handle]");
    // Two columns and one body row.
    expect(handles).toHaveLength(3);
    for (const handle of handles) {
      expect(handle.closest(".absolute")).not.toBeNull();
    }
  });

  it("puts the caret in the pressed row when that row has no such column", () => {
    const ragged = "| A | B | C |\n| --- | --- | --- |\n| a1 | b1 |\n| a2 | b2 | c2 |";
    const geometry = parseMarkdownTableSource(ragged)!;
    const { container } = render(
      createElement(MarkdownTableBlock, {
        blockId: "block-1",
        source: ragged,
        geometry,
        editable: true,
        renderCell: (text: string) => createElement("span", null, text),
      })
    );

    const phantom = container.querySelectorAll("tbody tr")[0].querySelectorAll("td")[2];
    fireEvent.pointerDown(phantom);

    const cell = screen.getByRole("textbox", { name: "Table cell" });
    expect(cell).toHaveTextContent("b1");
    // Not the header cell `A`, which is where the typed text used to go.
    expect(cell.closest("th")).toBeNull();
  });

  it("says how each column is aligned on every cell, header cells included", () => {
    const { container } = renderGrid(ALIGNED);
    const header = container.querySelectorAll("th");
    expect(header[0].getAttribute("data-align")).toBe("left");
    expect(header[1].getAttribute("data-align")).toBe("center");
    const body = container.querySelectorAll("td");
    expect(body[0].getAttribute("data-align")).toBe("left");
    expect(body[1].getAttribute("data-align")).toBe("center");
  });
});
