/**
 * A `/columns` block used to be frozen at the shape it was inserted with: no
 * way to change the split, no way to add or drop a column. The commands below
 * are what the divider drag handle and the layout controls drive.
 *
 * Removing a column must never drop what was in it — its blocks move into the
 * neighbour that absorbs the space.
 */
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { markdownToHtml } from "@/lib/markdown";

function columnsMarkdown(bodies: string[]): string {
  const inner = bodies.map((body) => `<div data-column>\n\n${body}\n\n</div>`).join("\n\n");
  return `<div data-columns="${bodies.length}">\n\n${inner}\n\n</div>`;
}

const TWO_COLUMNS = columnsMarkdown(["left", "right"]);
const THREE_COLUMNS = columnsMarkdown(["one", "two", "three"]);

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function makeEditor(body: string): Editor {
  const ed = new Editor({ extensions: getEditorExtensions(), content: markdownToHtml(body) });
  editor = ed;
  return ed;
}

function columnsPos(ed: Editor): number {
  let pos = -1;
  ed.state.doc.descendants((node, at) => {
    if (pos === -1 && node.type.name === "columns") pos = at;
    return pos === -1;
  });
  if (pos === -1) throw new Error("no columns block in document");
  return pos;
}

function columnTexts(ed: Editor): string[] {
  const node = ed.state.doc.nodeAt(columnsPos(ed));
  if (!node) throw new Error("columns block vanished");
  const texts: string[] = [];
  node.forEach((column) => texts.push(column.textContent));
  return texts;
}

function columnWidths(ed: Editor): (number | null)[] {
  const node = ed.state.doc.nodeAt(columnsPos(ed));
  if (!node) throw new Error("columns block vanished");
  const widths: (number | null)[] = [];
  node.forEach((column) => widths.push(column.attrs.width as number | null));
  return widths;
}

describe("layout columns", () => {
  it("round-trips an untouched block byte-identically", () => {
    const ed = makeEditor(TWO_COLUMNS);
    expect(ed.getMarkdown().trimEnd()).toBe(TWO_COLUMNS);
  });

  it("adds a column and keeps the existing content", () => {
    const ed = makeEditor(TWO_COLUMNS);
    expect(ed.commands.addLayoutColumn(columnsPos(ed))).toBe(true);
    expect(columnTexts(ed)).toEqual(["left", "right", ""]);
    expect(ed.getMarkdown()).toContain('<div data-columns="3">');
  });

  it("refuses to add past the five-column ceiling", () => {
    const ed = makeEditor(columnsMarkdown(["a", "b", "c", "d", "e"]));
    expect(ed.commands.addLayoutColumn(columnsPos(ed))).toBe(false);
    expect(columnTexts(ed)).toHaveLength(5);
  });

  it("moves a removed column's content into its neighbour", () => {
    const ed = makeEditor(THREE_COLUMNS);
    expect(ed.commands.removeLayoutColumn(columnsPos(ed), 1)).toBe(true);
    expect(columnTexts(ed)).toEqual(["onetwo", "three"]);
    expect(ed.getMarkdown()).toContain('<div data-columns="2">');
    expect(ed.getMarkdown()).toContain("two");
  });

  it("moves the first column's content forward when it is the one removed", () => {
    const ed = makeEditor(THREE_COLUMNS);
    expect(ed.commands.removeLayoutColumn(columnsPos(ed), 0)).toBe(true);
    expect(columnTexts(ed)).toEqual(["onetwo", "three"]);
  });

  it("refuses to drop below two columns", () => {
    const ed = makeEditor(TWO_COLUMNS);
    expect(ed.commands.removeLayoutColumn(columnsPos(ed), 1)).toBe(false);
    expect(columnTexts(ed)).toEqual(["left", "right"]);
  });

  it("persists a resized split and reads it back", () => {
    const ed = makeEditor(TWO_COLUMNS);
    expect(ed.commands.setLayoutColumnWidths(columnsPos(ed), [65, 35])).toBe(true);

    const markdown = ed.getMarkdown();
    expect(markdown).toContain('<div data-column="65">');
    expect(markdown).toContain('<div data-column="35">');

    const reopened = makeEditor(markdown);
    expect(columnWidths(reopened)).toEqual([65, 35]);
    expect(columnTexts(reopened)).toEqual(["left", "right"]);
  });

  it("clamps a split so no column can be dragged away to nothing", () => {
    const ed = makeEditor(TWO_COLUMNS);
    ed.commands.setLayoutColumnWidths(columnsPos(ed), [99, 1]);
    const widths = columnWidths(ed);
    expect(widths[0]).toBeLessThanOrEqual(90);
    expect(widths[1]).toBeGreaterThanOrEqual(10);
    expect((widths[0] as number) + (widths[1] as number)).toBe(100);
  });

  it("resets to an even split when the column count changes", () => {
    const ed = makeEditor(TWO_COLUMNS);
    ed.commands.setLayoutColumnWidths(columnsPos(ed), [70, 30]);
    ed.commands.addLayoutColumn(columnsPos(ed));
    expect(columnWidths(ed)).toEqual([null, null, null]);
    expect(ed.getMarkdown()).toContain("<div data-column>");
  });
});
