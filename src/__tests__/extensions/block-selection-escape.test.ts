/**
 * Escape precedence in the editor.
 *
 * The block-selection plugin sits in front of every other keydown handler, so
 * it has to be the one that yields: transient popups (the slash menu) own
 * Escape first, and the selection it arms must be a block the rest of the
 * plugin can actually see.
 */
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { markdownToHtml } from "@/lib/markdown";
import { getSelectedBlockIds, extractBlocks } from "@/extensions/block-selection-extension";
import { stubLayoutRects } from "../helpers/stub-layout";

function makeEditor(body: string): Editor {
  // Mounted, so view.focus()/hasFocus() reflect real activeElement movement.
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: getEditorExtensions(),
    content: markdownToHtml(body),
  });
  editor.commands.setContent(markdownToHtml(body), { emitUpdate: false } as never);
  editor.commands.setSourceBaseline(body);
  return editor;
}

function press(editor: Editor, key: string, shiftKey = false): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })
  );
}

stubLayoutRects();

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const norm = (s: string) => s.replace(/\n+$/, "");

describe("Escape precedence", () => {
  it("does not arm a block selection while the slash menu is open", async () => {
    const editor = makeEditor("Alpha paragraph.");
    // "/" at the very start of a block is what opens the menu.
    editor.commands.setTextSelection(1);
    editor.commands.insertContent("/");
    // The suggestion renderer mounts and positions itself asynchronously; let
    // it settle around the editor, or its callbacks fire against a dead view.
    await flush();

    press(editor, "Escape");

    const armed = getSelectedBlockIds(editor).size;
    await flush();
    editor.destroy();

    expect(armed).toBe(0);
  });

  it("arms a selection a list can actually act on", () => {
    const body = ["# Doc", "", "- One", "- Two", "", "Trailing paragraph."].join("\n");
    const editor = makeEditor(body);

    const list = extractBlocks(editor.state.doc).find((b) => b.type === "bulletList");
    expect(list).toBeDefined();

    // Caret inside the first list item.
    editor.commands.setTextSelection(list!.from + 4);
    press(editor, "Escape");

    const armed = Array.from(getSelectedBlockIds(editor));
    expect(armed).toEqual([list!.id]);

    press(editor, "Backspace");

    const out = norm(editor.getMarkdown() as string);
    editor.destroy();

    expect(out).toContain("# Doc");
    expect(out).toContain("Trailing paragraph.");
    expect(out).not.toContain("One");
    expect(out).not.toContain("Two");
  });

  it("clearing an armed selection with Escape leaves the editor focused", () => {
    const editor = makeEditor("Alpha paragraph.");
    editor.commands.setTextSelection(3);
    editor.view.focus();

    press(editor, "Escape");
    expect(getSelectedBlockIds(editor).size).toBe(1);

    press(editor, "Escape");
    const armed = getSelectedBlockIds(editor).size;
    const focused = editor.view.hasFocus();
    editor.destroy();

    expect(armed).toBe(0);
    expect(focused).toBe(true);
  });
});
