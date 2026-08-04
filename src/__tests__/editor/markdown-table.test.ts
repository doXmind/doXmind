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
    // Two columns, and one handle per row — the header row included.
    expect(handles).toHaveLength(4);
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

  describe("where a keyboard crossing lands", () => {
    const GRID = "| head one | head two |\n| --- | --- |\n| body a | body b |\n| body c | body d |";

    function renderEntered(entry: -1 | 1) {
      const geometry = parseMarkdownTableSource(GRID)!;
      return render(
        createElement(MarkdownTableBlock, {
          blockId: "block-1",
          source: GRID,
          geometry,
          editable: true,
          entry,
          renderCell: (text: string) => createElement("span", null, text),
        })
      );
    }

    it("enters the last row from the Block below, at the end of its first cell", () => {
      // The header is where every activation used to land, whichever way the caret arrived, so one
      // ArrowUp from the paragraph underneath stepped over every body row into row 0 — and from
      // there no arrow could get back down to them. The grid was unreachable from below.
      renderEntered(-1);

      const cell = screen.getByRole("textbox", { name: "Table cell" });
      expect(cell).toHaveTextContent("body c");
      expect(cell.closest("th")).toBeNull();
      // At the end of that cell rather than in front of it: the caret is walking up the page, so it
      // enters at the far end of what it lands in, the way it does entering any other Block.
      expect(window.getSelection()?.focusOffset).toBe("body c".length);
    });

    it("still enters the header from the Block above", () => {
      renderEntered(1);

      const cell = screen.getByRole("textbox", { name: "Table cell" });
      expect(cell).toHaveTextContent("head one");
      expect(cell.closest("th")).not.toBeNull();
    });
  });

  /**
   * A handle has to be centred on the row or column it controls at any width, and jsdom cannot lay
   * a table out — so what is pinned here is the mechanism the measurement proved, not the pixels.
   *
   * Measured in the packaged app before this: a column handle sat 66px, 338px and 458px from the
   * column it names, and a row handle 6px below its row's centre, because the handle was positioned
   * against `DropdownMenu`'s own `relative inline-block` wrapper — a zero-sized box parked at
   * whatever static position the cell's `text-align` gave it. Two things therefore have to stay
   * true: the positioned element is a child of the *cell*, and the trigger inside the dropdown's
   * wrapper is left in flow so it cannot resolve against it.
   */
  it("centres each handle on the cell it belongs to, not on the dropdown's own wrapper", () => {
    const { container } = renderGrid(ALIGNED);
    const columnHandle = container.querySelector("th [data-axis-handle]") as HTMLElement;
    const rowHandle = container.querySelector("td [data-axis-handle]") as HTMLElement;

    for (const handle of [columnHandle, rowHandle]) {
      // Positioned against the cell's own box: the cell is `relative`, and nothing between it and
      // the positioned wrapper may establish a containing block of its own.
      const positioned = handle.closest(".absolute") as HTMLElement;
      expect(positioned.parentElement?.tagName).toMatch(/^(TH|TD)$/);
      expect(positioned.style.transform).toBe("translate(-50%, -50%)");
      // In flow inside the dropdown wrapper, or the wrapper becomes the containing block again.
      expect(handle.className).not.toContain("absolute");
    }

    // Mid-column, on the table's top border line.
    expect(columnHandle.closest(".absolute")).toHaveStyle({ left: "50%", top: "-0.5px" });
    // Mid-row, on the table's left border line.
    expect(rowHandle.closest(".absolute")).toHaveStyle({ top: "50%", left: "-0.5px" });
  });

  it("hides the handles until the Block is active, rather than showing an inert one", () => {
    // Shown at `opacity: 1` while disabled, a pill appeared under the pointer and answered a press
    // with nothing at all — no menu, no selection, not even focus.
    //
    // The class alone is not the pixel. `.editor-control:disabled { opacity: .5 }` in editor.css is
    // (0,2,0) and outranks `.opacity-0`, so with the class as the only declaration all six handles
    // of an inactive table measured `opacity: 0.5` on the packaged app — a permanent half-strength
    // blue pill on every row and every column, with no pointer near the table. The inline value is
    // what the browser actually paints, so it is what this asserts.
    const { container } = renderGrid(ALIGNED);
    for (const handle of container.querySelectorAll<HTMLElement>("[data-axis-handle]")) {
      expect(handle).toBeDisabled();
      expect(handle.className).toContain("opacity-0");
      expect(handle.style.opacity).toBe("0");
    }
  });

  it("leaves an active Block's handles to the class, so focus can still reveal one", () => {
    // The inline override belongs only to the state that can never be reached. On an active Block a
    // handle is reachable by Tab, and `focus-visible:opacity-100` has to be able to win — an inline
    // `opacity: 0` here would beat it and leave the keyboard driving an invisible control.
    const geometry = parseMarkdownTableSource(ALIGNED)!;
    const { container } = render(
      createElement(MarkdownTableBlock, {
        blockId: "block-1",
        source: ALIGNED,
        geometry,
        editable: true,
        renderCell: (text: string) => createElement("span", null, text),
      })
    );
    for (const handle of container.querySelectorAll<HTMLElement>("[data-axis-handle]")) {
      expect(handle).toBeEnabled();
      expect(handle.style.opacity).toBe("");
      expect(handle.className).toContain("focus-visible:opacity-100");
    }
  });

  it("gives the header row a handle too, with the two operations it cannot answer disabled", () => {
    // Three handles for four rows while every column had one: hovering down the left edge, the
    // affordance simply vanished at the top. The source layer already refuses a row above the
    // header and refuses to delete it, so the menu says so rather than hiding the rows.
    const geometry = parseMarkdownTableSource(ALIGNED)!;
    const { container } = render(
      createElement(MarkdownTableBlock, {
        blockId: "block-1",
        source: ALIGNED,
        geometry,
        editable: true,
        renderCell: (text: string) => createElement("span", null, text),
      })
    );
    const header = container.querySelector('th [aria-label="Row 1 actions"]');
    expect(header).not.toBeNull();
    fireEvent.click(header!);

    expect(screen.getByRole("menuitem", { name: "Insert above" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Insert below" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Clear contents" })).toBeEnabled();
  });

  it("reserves the tick column on every item of a menu that has one", () => {
    const geometry = parseMarkdownTableSource(ALIGNED)!;
    const { container } = render(
      createElement(MarkdownTableBlock, {
        blockId: "block-1",
        source: ALIGNED,
        geometry,
        editable: true,
        renderCell: (text: string) => createElement("span", null, text),
      })
    );
    fireEvent.click(container.querySelector("th [data-axis-handle]")!);

    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(9);
    // Reserved on all nine, not only the four that can be ticked: reserving it on the alignment
    // group alone stepped those labels 16px right of the other five, so one menu showed two
    // columns of labels.
    for (const item of items) {
      expect(item.firstElementChild?.className).toContain("w-4");
    }

    // A row's menu has nothing to tick, so it reserves nothing and still shows one label column.
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(container.querySelector("td [data-axis-handle]")!);
    for (const item of screen.getAllByRole("menuitem")) {
      expect(item.firstElementChild).toBeNull();
    }
  });

  it("declares no type size on the table, so the cell rules own it", () => {
    // `.markdown-page th, td` sizes every cell at 1rem through an element selector, so a `text-sm`
    // here applied to nothing — and would have silently shrunk anything added that is not a cell.
    const { container } = renderGrid(ALIGNED);
    expect(container.querySelector("table")?.className).not.toContain("text-sm");
  });

  it("starts the table on the content rail and reserves the row handle's room outside it", () => {
    // The handle straddles the table's left border, so it reaches 4.5px outside the table. Paying
    // for that with plain left padding put the table 12px right of every other Block on the Page.
    const { container } = renderGrid(ALIGNED);
    const wrapper = container.querySelector("table")?.parentElement;
    expect(wrapper?.className).toContain("-ml-1.5");
    expect(wrapper?.className).toContain("pl-1.5");
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
