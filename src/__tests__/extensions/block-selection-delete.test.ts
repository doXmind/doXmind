/**
 * Block-selection Backspace/Delete must remove exactly the selected blocks.
 *
 * extractBlocks() walks the whole tree, so a selection of blocks nested inside a
 * container is not comparable to the document's top-level child count.
 */
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { markdownToHtml } from "@/lib/markdown";
import { extractBlocks } from "@/extensions/block-selection-extension";

function makeEditor(body: string): Editor {
  const editor = new Editor({ extensions: getEditorExtensions(), content: markdownToHtml(body) });
  editor.commands.setContent(markdownToHtml(body), { emitUpdate: false } as never);
  editor.commands.setSourceBaseline(body);
  return editor;
}

const norm = (s: string) => s.replace(/\n+$/, "");

/** Drive the real desktop keydown handler the way the browser would. */
function press(editor: Editor, key: string, shiftKey = false): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })
  );
}
const pressBackspace = (editor: Editor) => press(editor, "Backspace");

describe("block selection — Backspace deletes only the selected blocks", () => {
  // The doc has three top-level children (heading, blockquote, paragraph) and the
  // blockquote holds three paragraphs, so a nested selection of three is exactly the
  // shape that made the old `toDelete.length >= doc.childCount` guard clear the doc.
  it("deleting paragraphs nested in a blockquote leaves siblings intact", () => {
    const body = [
      "# Doc A",
      "",
      "> One.",
      ">",
      "> Two.",
      ">",
      "> Three.",
      "",
      "Trailing paragraph.",
    ].join("\n");
    const editor = makeEditor(body);

    const quoted = extractBlocks(editor.state.doc).filter(
      (b) => b.type === "paragraph" && /^(One|Two|Three)\.$/.test(b.text)
    );
    expect(quoted).toHaveLength(3);
    expect(editor.state.doc.childCount).toBe(3);

    editor.commands.setSelectedBlocks(quoted.map((b) => b.id));
    pressBackspace(editor);

    const out = norm(editor.getMarkdown() as string);
    editor.destroy();

    expect(out).toContain("# Doc A");
    expect(out).toContain("Trailing paragraph.");
    expect(out).not.toContain("One.");
    expect(out).not.toContain("Two.");
    expect(out).not.toContain("Three.");
  });

  it("emptying the only container in the document leaves the rest of the doc valid", () => {
    const body = ["# Doc B", "", "> Only quoted line."].join("\n");
    const editor = makeEditor(body);

    const quoted = extractBlocks(editor.state.doc).filter(
      (b) => b.type === "paragraph" && /Only quoted/.test(b.text)
    );
    expect(quoted).toHaveLength(1);

    editor.commands.setSelectedBlocks(quoted.map((b) => b.id));
    pressBackspace(editor);

    const out = norm(editor.getMarkdown() as string);
    editor.destroy();

    expect(out).toContain("# Doc B");
    expect(out).not.toContain("Only quoted line.");
  });

  it("deleting one of two top-level paragraphs leaves the other intact", () => {
    const body = ["Alpha paragraph.", "", "Beta paragraph."].join("\n");
    const editor = makeEditor(body);

    const alpha = extractBlocks(editor.state.doc).filter((b) => /Alpha/.test(b.text));
    expect(alpha).toHaveLength(1);

    editor.commands.setSelectedBlocks(alpha.map((b) => b.id));
    pressBackspace(editor);

    const out = norm(editor.getMarkdown() as string);
    editor.destroy();

    expect(out).toBe("Beta paragraph.");
  });

  // The reported repro. extractBlocks() flattens the tree, so the entry after the
  // blockquote's last paragraph is the blockquote's own next sibling — Shift+ArrowDown
  // used to jump out of the container and take an untouched top-level block with it.
  it("Shift+ArrowDown does not extend the selection out of a blockquote", () => {
    const body = [
      "# Doc A",
      "",
      "> First quoted line.",
      "> Second quoted line.",
      "",
      "Trailing paragraph.",
    ].join("\n");
    const editor = makeEditor(body);

    // Caret inside the quoted paragraph, then the user's exact key sequence.
    editor.commands.setTextSelection(15);
    press(editor, "Escape");
    press(editor, "ArrowDown", true);
    pressBackspace(editor);

    const out = norm(editor.getMarkdown() as string);
    editor.destroy();

    expect(out).toContain("# Doc A");
    expect(out).toContain("Trailing paragraph.");
  });

  it("Shift+ArrowDown still extends across siblings inside the same container", () => {
    const body = ["# Doc C", "", "> One.", ">", "> Two.", "", "Trailing paragraph."].join("\n");
    const editor = makeEditor(body);

    editor.commands.setTextSelection(12);
    press(editor, "Escape");
    press(editor, "ArrowDown", true);
    pressBackspace(editor);

    const out = norm(editor.getMarkdown() as string);
    editor.destroy();

    expect(out).toContain("# Doc C");
    expect(out).toContain("Trailing paragraph.");
    expect(out).not.toContain("One.");
    expect(out).not.toContain("Two.");
  });

  it("selecting every block in the document clears it", () => {
    const body = ["# Heading", "", "Body paragraph.", "", "Another paragraph."].join("\n");
    const editor = makeEditor(body);

    const all = extractBlocks(editor.state.doc);
    expect(all.length).toBeGreaterThan(1);

    editor.commands.setSelectedBlocks(all.map((b) => b.id));
    pressBackspace(editor);

    const out = norm(editor.getMarkdown() as string);
    const childCount = editor.state.doc.childCount;
    editor.destroy();

    expect(out).toBe("");
    expect(childCount).toBe(1);
  });
});
