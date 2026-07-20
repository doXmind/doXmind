/**
 * Column resizing has to survive the editor being built read-only.
 *
 * A disk-backed document mounts with `editable: false` and is switched on a
 * frame later (see markdown-runtime). Upstream decides once, at construction,
 * whether to install the resize plugin — so every document opened from a file
 * lost resizing for the whole session while a transient buffer kept it.
 */
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { columnResizingPluginKey } from "@tiptap/pm/tables";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { markdownToHtml } from "@/lib/markdown";

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

function makeEditor(body: string, editable: boolean): Editor {
  const ed = new Editor({
    extensions: getEditorExtensions(),
    content: markdownToHtml(body),
    editable,
  });
  editor = ed;
  return ed;
}

function firstRowCellPositions(ed: Editor): number[] {
  const positions: number[] = [];
  let tablePos = -1;
  ed.state.doc.descendants((node, pos) => {
    if (tablePos === -1 && node.type.name === "table") tablePos = pos;
    if (tablePos !== -1 && (node.type.name === "tableHeader" || node.type.name === "tableCell")) {
      positions.push(pos);
    }
    return true;
  });
  if (positions.length === 0) throw new Error("no cells in document");
  return positions.slice(0, 3);
}

describe("table column resizing", () => {
  it("installs the resize plugin for a table created in an editable editor", () => {
    const ed = makeEditor(TABLE_MD, true);
    expect(columnResizingPluginKey.getState(ed.state)).toBeDefined();
  });

  it("installs the resize plugin for a document opened read-only and then unlocked", () => {
    const ed = makeEditor(TABLE_MD, false);
    ed.setEditable(true);
    expect(columnResizingPluginKey.getState(ed.state)).toBeDefined();
  });

  it("renders a colgroup so widths have somewhere to land", () => {
    const ed = makeEditor(TABLE_MD, false);
    ed.setEditable(true);
    expect(ed.view.dom.querySelector("table > colgroup")).not.toBeNull();
  });

  it("keeps the emitted markdown byte-identical after columns are resized", () => {
    const ed = makeEditor(TABLE_MD, false);
    ed.setEditable(true);
    const before = ed.getMarkdown();

    const { tr } = ed.state;
    firstRowCellPositions(ed).forEach((pos, index) => {
      const cell = ed.state.doc.nodeAt(pos);
      if (!cell) throw new Error("cell vanished");
      tr.setNodeMarkup(pos, undefined, { ...cell.attrs, colwidth: [120 + index * 20] });
    });
    ed.view.dispatch(tr);

    const after = ed.getMarkdown();
    expect(after).toBe(before);
    expect(after).not.toMatch(/[\u0000-\u0009\u000b-\u001f]/);
    expect(after).toContain("| H1  | H2  | H3  |");
  });
});
