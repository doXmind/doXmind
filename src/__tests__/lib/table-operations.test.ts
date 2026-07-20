/**
 * Table column/row operations must leave a single well-formed table behind and
 * must serialize back to valid GFM. Both were broken: the operations wrote
 * several replacements against stale positions, and the cell serializer joined
 * multi-block cells with a raw U+001F.
 */
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { markdownToHtml } from "@/lib/markdown";
import { clearColumn, clearRow, duplicateColumn, duplicateRow } from "@/lib/table-operations";

/** U+001F — the control character the upstream cell serializer emits. */
const UNIT_SEPARATOR = /\u001f/;

const TABLE_MD = [
  "| H1 | H2 | H3 |",
  "| --- | --- | --- |",
  "| a1 | b1 | c1 |",
  "| a2 | b2 | c2 |",
].join("\n");

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function makeEditor(body: string): Editor {
  const ed = new Editor({ extensions: getEditorExtensions(), content: markdownToHtml(body) });
  ed.commands.setContent(markdownToHtml(body), { emitUpdate: false } as never);
  editor = ed;
  return ed;
}

function findTablePos(ed: Editor): number {
  let found = -1;
  ed.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === "table") found = pos;
    return found === -1;
  });
  if (found === -1) throw new Error("no table in document");
  return found;
}

function tableNodeOf(ed: Editor): ProseMirrorNode {
  const node = ed.state.doc.nodeAt(findTablePos(ed));
  if (!node) throw new Error("table vanished");
  return node;
}

/** Row-major grid of cell text, so a shredded table is obvious in the diff. */
function grid(ed: Editor): string[][] {
  const table = tableNodeOf(ed);
  const rows: string[][] = [];
  table.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => cells.push(cell.textContent));
    rows.push(cells);
  });
  return rows;
}

function countTables(ed: Editor): number {
  let n = 0;
  ed.state.doc.descendants((node) => {
    if (node.type.name === "table") n += 1;
    return true;
  });
  return n;
}

/** Parse the emitted markdown back into a grid of trimmed cell strings. */
function markdownRows(md: string): string[][] {
  return md
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim())
    );
}

describe("table operations keep the table intact", () => {
  it("duplicateColumn copies one column without disturbing the others", () => {
    const ed = makeEditor(TABLE_MD);
    expect(duplicateColumn(ed, findTablePos(ed), 1)).toBe(true);

    expect(countTables(ed)).toBe(1);
    expect(grid(ed)).toEqual([
      ["H1", "H2", "H2", "H3"],
      ["a1", "b1", "b1", "c1"],
      ["a2", "b2", "b2", "c2"],
    ]);
  });

  it("duplicateRow copies the whole row cell-for-cell", () => {
    const ed = makeEditor(TABLE_MD);
    expect(duplicateRow(ed, findTablePos(ed), 1)).toBe(true);

    expect(countTables(ed)).toBe(1);
    expect(grid(ed)).toEqual([
      ["H1", "H2", "H3"],
      ["a1", "b1", "c1"],
      ["a1", "b1", "c1"],
      ["a2", "b2", "c2"],
    ]);
  });

  it("clearColumn empties exactly one column", () => {
    const ed = makeEditor(TABLE_MD);
    expect(clearColumn(ed, findTablePos(ed), 1)).toBe(true);

    expect(countTables(ed)).toBe(1);
    expect(grid(ed)).toEqual([
      ["H1", "", "H3"],
      ["a1", "", "c1"],
      ["a2", "", "c2"],
    ]);
  });

  it("clearRow empties exactly one row", () => {
    const ed = makeEditor(TABLE_MD);
    expect(clearRow(ed, findTablePos(ed), 1)).toBe(true);

    expect(countTables(ed)).toBe(1);
    expect(grid(ed)).toEqual([
      ["H1", "H2", "H3"],
      ["", "", ""],
      ["a2", "b2", "c2"],
    ]);
  });
});

describe("table operations emit valid GFM", () => {
  it("a duplicated column round-trips through the markdown", () => {
    const ed = makeEditor(TABLE_MD);
    duplicateColumn(ed, findTablePos(ed), 1);
    const md = ed.getMarkdown() as string;

    expect(md).not.toMatch(UNIT_SEPARATOR);
    const rows = markdownRows(md);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.length === 4)).toBe(true);
    expect(rows[0]).toEqual(["H1", "H2", "H2", "H3"]);
    expect(rows[2]).toEqual(["a1", "b1", "b1", "c1"]);
    expect(rows[3]).toEqual(["a2", "b2", "b2", "c2"]);
  });

  it("a cleared row still emits three delimited cells", () => {
    const ed = makeEditor(TABLE_MD);
    clearRow(ed, findTablePos(ed), 1);
    const md = ed.getMarkdown() as string;

    expect(md).not.toMatch(UNIT_SEPARATOR);
    const rows = markdownRows(md);
    expect(rows).toHaveLength(4);
    expect(rows[2]).toEqual(["", "", ""]);
    expect(rows[3]).toEqual(["a2", "b2", "c2"]);
  });
});

describe("table cell serialization", () => {
  /** Position just inside the first body cell's single paragraph. */
  function firstBodyCellTextPos(ed: Editor): number {
    const tablePos = findTablePos(ed);
    const table = tableNodeOf(ed);
    // table > row(1) > cell(0) > paragraph
    return tablePos + 1 + table.child(0).nodeSize + 1 + 1 + 1;
  }

  it("joins a multi-paragraph cell with a break instead of a control character", () => {
    const ed = makeEditor(TABLE_MD);
    const paraStart = firstBodyCellTextPos(ed) - 1;
    const paraEnd = paraStart + ed.state.doc.nodeAt(paraStart)!.nodeSize;
    ed.view.dispatch(
      ed.state.tr.insert(
        paraEnd,
        ed.state.schema.nodes.paragraph.create(null, ed.state.schema.text("second"))
      )
    );

    const md = ed.getMarkdown() as string;
    expect(md).not.toMatch(UNIT_SEPARATOR);
    expect(md).toContain("a1<br>second");
  });

  it("does not accumulate breaks in a cell that already contains one", () => {
    const withBreak = ["| A | B |", "| --- | --- |", "| one<br>two | y |"].join("\n");
    const ed = makeEditor(withBreak);
    const once = ed.getMarkdown() as string;
    expect(once).toContain("one<br>two");

    const reopened = new Editor({
      extensions: getEditorExtensions(),
      content: markdownToHtml(once),
    });
    const twice = reopened.getMarkdown() as string;
    reopened.destroy();
    expect(twice.trim()).toBe(once.trim());
  });

  it("escapes a literal pipe in cell text so the table survives reimport", () => {
    const ed = makeEditor(TABLE_MD);
    const textPos = firstBodyCellTextPos(ed);
    ed.view.dispatch(ed.state.tr.insertText(" | x", textPos + 2));

    const md = ed.getMarkdown() as string;
    expect(md).not.toMatch(UNIT_SEPARATOR);
    expect(md).toContain("a1 \\| x");

    const reopened = new Editor({ extensions: getEditorExtensions(), content: markdownToHtml(md) });
    let rowCount = 0;
    const cells: string[] = [];
    reopened.state.doc.descendants((node) => {
      if (node.type.name === "tableRow") rowCount += 1;
      if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
        cells.push(node.textContent);
      }
      return true;
    });
    reopened.destroy();
    expect(rowCount).toBe(3);
    expect(cells).toContain("a1 | x");
  });
});
