/**
 * HTML block-level source preservation (#139) — the getHTML analogue of #149.
 * Untouched HTML blocks must round-trip byte-identical; edits stay confined.
 */
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { splitHtmlTopLevel } from "@/extensions/html-source-preservation";

function makeEditor(html: string): Editor {
  const editor = new Editor({ extensions: getEditorExtensions(), content: html });
  editor.commands.setContent(html, { emitUpdate: false } as never);
  editor.commands.setHtmlBaseline(html);
  return editor;
}

describe("splitHtmlTopLevel", () => {
  it("reproduces the input byte-for-byte (whitespace folded into blocks)", () => {
    const html = "<h1>Title</h1>\n<p>Hello</p>\n<ul><li>a</li><li>b</li></ul>";
    expect(splitHtmlTopLevel(html).join("")).toBe(html);
  });
});

describe("html source preservation — untouched blocks round-trip byte-identical", () => {
  it("an unedited html document is byte-identical through getHTML", () => {
    const html =
      '<h1>Title</h1><p>A <em>para</em> with a <a href="x.md">link</a>.</p><blockquote><p>q</p></blockquote>';
    const editor = makeEditor(html);
    const out = editor.getHTML();
    editor.destroy();
    expect(out).toBe(html);
  });

  it("pretty-printed html (inter-element newlines) round-trips byte-identical", () => {
    const html = "<h1>Title</h1>\n<p>first</p>\n<p>second</p>";
    const editor = makeEditor(html);
    const out = editor.getHTML();
    editor.destroy();
    expect(out).toBe(html);
  });
});

describe("html source preservation — edits stay confined", () => {
  it("editing the heading leaves the other blocks byte-identical", () => {
    const html =
      "<h1>Title</h1><p>untouched <em>para</em></p><blockquote><p>keep me</p></blockquote>";
    const editor = makeEditor(html);
    expect(editor.getHTML()).toBe(html); // baseline faithful

    // Edit inside the heading (doc position 2 → inside "Title").
    editor.commands.insertContentAt(2, "X");
    const out = editor.getHTML();
    editor.destroy();

    // The untouched blocks survive verbatim…
    expect(out).toContain("<p>untouched <em>para</em></p>");
    expect(out).toContain("<blockquote><p>keep me</p></blockquote>");
    // …and the edited heading changed (it reformats — it was touched).
    expect(out).toMatch(/<h1[^>]*>[^<]*X[^<]*<\/h1>/);
  });
});

describe("html source preservation — inert for non-html (no baseline)", () => {
  it("getHTML is unchanged when no html baseline is set", () => {
    const editor = new Editor({ extensions: getEditorExtensions(), content: "<p>plain</p>" });
    // no setHtmlBaseline → wrap falls back to the original getHTML
    expect(editor.getHTML()).toContain("plain");
    editor.destroy();
  });
});
