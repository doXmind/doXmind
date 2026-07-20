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

describe("paste — text/plain is read as markdown", () => {
  it("converts block syntax, not just inline marks", () => {
    const editor = makeEditor("start");
    placeCursorAtEnd(editor);
    const handled = paste(editor, {
      "text/plain": ["# Heading", "", "- one", "- two", "", "> quote"].join("\n"),
    });
    const md = editor.getMarkdown() as string;
    editor.destroy();

    expect(handled).toBe(true);
    expect(md).toContain("# Heading");
    expect(md).toContain("- one");
    expect(md).toContain("- two");
    expect(md).toContain("> quote");
    expect(md).not.toContain("\\#");
  });

  it("merges a single-paragraph paste inline instead of splitting the block", () => {
    const editor = makeEditor("start");
    placeCursorAtEnd(editor);
    paste(editor, { "text/plain": "more **bold**" });
    const blocks = editor.state.doc.childCount;
    const md = (editor.getMarkdown() as string).trim();
    editor.destroy();

    expect(blocks).toBe(1);
    expect(md).toBe("startmore **bold**");
  });

  it("round-trips a copied slice back to the same markdown", () => {
    const source = ["# Title", "", "1. first", "2. second", "", "> quoted"].join("\n");
    const from = makeEditor(source);
    const copied = copyAll(from);
    from.destroy();

    const into = makeEditor("");
    paste(into, { "text/plain": copied });
    const md = (into.getMarkdown() as string).trim();
    into.destroy();

    expect(md).toBe(source);
  });

  it("leaves the rich flavor alone when text/html is present", () => {
    const editor = makeEditor("start");
    placeCursorAtEnd(editor);
    const handled = paste(editor, {
      "text/plain": "# not a heading",
      "text/html": "<p># not a heading</p>",
    });
    editor.destroy();

    expect(handled).toBe(false);
  });

  it("pastes literally inside a code block", () => {
    const editor = makeEditor(["```js", "const a = 1;", "```"].join("\n"));
    const codeBlockPos = 1;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.near(editor.state.doc.resolve(codeBlockPos + "const a = 1;".length))
      )
    );
    const handled = paste(editor, { "text/plain": "# comment" });
    editor.destroy();

    expect(handled).toBe(false);
  });

  it("still lets a bare URL become a link", () => {
    const editor = makeEditor("start");
    placeCursorAtEnd(editor);
    paste(editor, { "text/plain": "https://example.com" });
    const md = (editor.getMarkdown() as string).trim();
    editor.destroy();

    expect(md).toContain("[https://example.com](https://example.com)");
  });

  it("pastes literally when the plain-paste modifier was used", () => {
    const editor = makeEditor("start");
    placeCursorAtEnd(editor);
    editor.view.someProp("handleKeyDown", (f) =>
      f(editor.view, { key: "v", metaKey: true, shiftKey: true } as KeyboardEvent)
    );
    const handled = paste(editor, { "text/plain": "# not a heading" });
    editor.destroy();

    expect(handled).toBe(false);
  });

  it("does not execute script from a hostile plain-text paste", () => {
    const editor = makeEditor("start");
    placeCursorAtEnd(editor);
    paste(editor, { "text/plain": '<img src="x" onerror="window.__pwned = true" />' });
    // Raw HTML is stored verbatim (source preservation) and sanitized where it
    // becomes DOM — ADR-0011.
    const img = editor.view.dom.querySelector("img");
    editor.destroy();

    expect(img?.hasAttribute("onerror")).toBe(false);
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });
});
