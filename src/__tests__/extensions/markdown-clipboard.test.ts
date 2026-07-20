/**
 * Clipboard fidelity: a markdown editor's text/plain flavor is markdown, and a
 * text/plain paste is read back as markdown.
 */
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { markdownToHtml } from "@/lib/markdown";

function makeEditor(body: string): Editor {
  return new Editor({ extensions: getEditorExtensions(), content: markdownToHtml(body) });
}

function copyAll(editor: Editor): string {
  const slice = editor.state.doc.slice(0, editor.state.doc.content.size);
  return editor.view.someProp("clipboardTextSerializer", (f) => f(slice, editor.view)) ?? "";
}

/**
 * jsdom has no ClipboardEvent/DataTransfer, so drive the paste plugin the way
 * ProseMirror does: hand it an event carrying the flavors under test.
 */
function paste(editor: Editor, data: Record<string, string>): boolean {
  const event = {
    clipboardData: { getData: (type: string) => data[type] ?? "" },
    preventDefault: () => {},
  } as unknown as ClipboardEvent;
  return (
    editor.view.someProp("handlePaste", (f) =>
      f(editor.view, event, editor.state.selection.content())
    ) ?? false
  );
}

function placeCursorAtEnd(editor: Editor): void {
  const { doc, tr } = editor.state;
  editor.view.dispatch(tr.setSelection(TextSelection.near(doc.resolve(doc.content.size), -1)));
}

describe("copy — text/plain flavor is markdown", () => {
  it("keeps ordinals, bullets, quotes and headings", () => {
    const editor = makeEditor(
      ["# Title", "", "1. first", "2. second", "", "- bullet", "", "> quoted"].join("\n")
    );
    const text = copyAll(editor);
    editor.destroy();

    expect(text).toContain("# Title");
    expect(text).toContain("1. first");
    expect(text).toContain("2. second");
    expect(text).toContain("- bullet");
    expect(text).toContain("> quoted");
  });

  it("keeps table structure", () => {
    const editor = makeEditor(["| A | B |", "| --- | --- |", "| 1 | 2 |"].join("\n"));
    const text = copyAll(editor);
    editor.destroy();

    expect(text).toContain("| A");
    expect(text).toContain("| ---");
    expect(text).toContain("| 1");
  });

  it("does not silently drop math and mermaid", () => {
    const editor = makeEditor(
      [
        "$$",
        "x^2",
        "$$",
        "",
        "Inline $a+b$ here.",
        "",
        "```mermaid",
        "graph TD;A-->B;",
        "```",
      ].join("\n")
    );
    const text = copyAll(editor);
    editor.destroy();

    expect(text).toContain("x^2");
    expect(text).toContain("$a+b$");
    expect(text).toContain("```mermaid");
    expect(text).toContain("graph TD;A-->B;");
  });

  it("serializes a partial inline selection without block scaffolding", () => {
    const editor = makeEditor("Some **bold** words here.");
    const doc = editor.state.doc;
    const from = doc.content.size - "words here.".length - 1;
    const slice = doc.slice(from, doc.content.size - 1);
    const text =
      editor.view.someProp("clipboardTextSerializer", (f) => f(slice, editor.view)) ?? "";
    editor.destroy();

    expect(text).toBe("words here.");
  });
});
