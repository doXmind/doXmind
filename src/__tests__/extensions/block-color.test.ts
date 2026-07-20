/**
 * Callout and toggle render through React node views, so the global colour
 * attributes' `renderHTML` never reaches the live DOM — picking a colour from
 * the block menu stored the attribute and changed nothing on screen. The
 * extension now also emits node decorations, which ProseMirror does apply to a
 * custom node view's outer DOM.
 *
 * Colours arrive from documents, which are untrusted (docs/adr/0011), so the
 * attribute only survives parsing if it is a plain CSS colour.
 */
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import type { Decoration, DecorationSet } from "@tiptap/pm/view";
import { getEditorExtensions } from "@/components/editor/editor-extensions";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function makeEditor(content: string): Editor {
  const ed = new Editor({ extensions: getEditorExtensions(), content });
  editor = ed;
  return ed;
}

/** Decoration `attrs` is not in the public typings but is what the view reads. */
function decorationStyles(ed: Editor): string[] {
  const styles: string[] = [];
  for (const plugin of ed.state.plugins) {
    const set = plugin.props?.decorations?.call(plugin, ed.state) as DecorationSet | undefined;
    if (!set) continue;
    for (const deco of set.find() as Decoration[]) {
      const attrs = (deco as unknown as { type?: { attrs?: Record<string, string> } }).type?.attrs;
      if (attrs?.style) styles.push(attrs.style);
    }
  }
  return styles;
}

function setColor(ed: Editor, typeName: string, attrs: Record<string, unknown>): void {
  let pos = -1;
  ed.state.doc.descendants((node, at) => {
    if (pos === -1 && node.type.name === typeName) pos = at;
    return pos === -1;
  });
  if (pos === -1) throw new Error(`no ${typeName} in document`);
  const node = ed.state.doc.nodeAt(pos);
  if (!node) throw new Error("node vanished");
  ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
}

const CALLOUT_HTML = '<div data-callout-type="info"><p>heads up</p></div>';
const TOGGLE_HTML =
  '<div data-toggle-open="true"><summary>title</summary><div data-toggle-body><p>body</p></div></div>';

describe("block colour on node-view blocks", () => {
  it("decorates a callout with its background colour", () => {
    const ed = makeEditor(CALLOUT_HTML);
    setColor(ed, "callout", { backgroundColor: "#FDEBEC" });
    expect(decorationStyles(ed).join(" ")).toContain("background-color: #FDEBEC");
  });

  it("decorates a toggle with its text colour", () => {
    const ed = makeEditor(TOGGLE_HTML);
    setColor(ed, "toggle", { textColor: "#337EA9" });
    expect(decorationStyles(ed).join(" ")).toContain("color: #337EA9");
  });

  it("decorates nothing when no colour is set", () => {
    const ed = makeEditor(CALLOUT_HTML);
    expect(decorationStyles(ed)).toEqual([]);
  });

  it("drops a colour that is not a plain CSS colour", () => {
    const ed = makeEditor(
      '<div data-callout-type="info" data-bg-color="red;background-image:url(https://evil.test/x)"><p>x</p></div>'
    );
    let attrs: Record<string, unknown> | null = null;
    ed.state.doc.descendants((node) => {
      if (!attrs && node.type.name === "callout") attrs = node.attrs;
      return !attrs;
    });
    expect(attrs).not.toBeNull();
    expect((attrs as unknown as Record<string, unknown>).backgroundColor).toBeNull();
    expect(decorationStyles(ed)).toEqual([]);
  });

  it("keeps a functional colour notation written by another tool", () => {
    const ed = makeEditor(
      '<div data-callout-type="info" data-bg-color="rgb(10, 20, 30)"><p>x</p></div>'
    );
    expect(decorationStyles(ed).join(" ")).toContain("background-color: rgb(10, 20, 30)");
  });
});
