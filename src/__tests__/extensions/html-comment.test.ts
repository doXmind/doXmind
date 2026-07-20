/**
 * HTML comments must survive the .md round-trip (issue #149 follow-up).
 *
 * Comments carry load-bearing instructions for other tools — license headers,
 * `<!-- prettier-ignore -->`, `<!-- markdownlint-disable -->`, TOC markers — so
 * dropping them on save is unrecoverable data loss, not a formatting nit.
 */
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { markdownToHtml } from "@/lib/markdown";

function makeEditor(body: string): Editor {
  const editor = new Editor({ extensions: getEditorExtensions(), content: markdownToHtml(body) });
  editor.commands.setContent(markdownToHtml(body), { emitUpdate: false } as never);
  editor.commands.setSourceBaseline(body);
  return editor;
}
const norm = (s: string) => s.replace(/\n+$/, "");
const getMd = (editor: Editor) => editor.getMarkdown() as string;

const COMMENT_DOC = [
  "# Doc C",
  "",
  "<!-- markdownlint-disable MD013 -->",
  "",
  "Body paragraph.",
  "",
  "<!-- TODO: revisit -->",
  "",
  "Tail.",
].join("\n");

describe("HTML comments round-trip", () => {
  it("an untouched document with comments is byte-identical", () => {
    const editor = makeEditor(COMMENT_DOC);
    const out = getMd(editor);
    editor.destroy();
    expect(norm(out)).toBe(norm(COMMENT_DOC));
  });

  it("comments survive an edit to an unrelated paragraph", () => {
    const editor = makeEditor(COMMENT_DOC);
    // Type one character into "Body paragraph." — the reported repro.
    const pos = editor.state.doc.content.size;
    editor.commands.insertContentAt(pos, "x");
    const out = getMd(editor);
    editor.destroy();
    expect(out).toContain("<!-- markdownlint-disable MD013 -->");
    expect(out).toContain("<!-- TODO: revisit -->");
  });

  it("a multi-line comment keeps its interior bytes", () => {
    const body = [
      "<!--",
      "Copyright (c) 2026 Someone",
      "SPDX-License-Identifier: MIT",
      "-->",
      "",
      "Prose.",
    ].join("\n");
    const editor = makeEditor(body);
    const out = getMd(editor);
    editor.destroy();
    expect(norm(out)).toBe(norm(body));
  });

  it("an external-reference placeholder is still owned by its own block", () => {
    // pdf-block / excel-block markers are the same shape as a plain comment;
    // they must keep parsing as their own node, not as an htmlComment.
    const html = markdownToHtml('<!-- pdf-block id="a" src="s.pdf" -->\n');
    expect(html).toContain("<!-- pdf-block");
    expect(html).not.toContain("data-html-comment");
  });
});

describe("source preservation with comments and reference-style links", () => {
  const body = [
    "# Title",
    "",
    "<!-- prettier-ignore-start -->",
    "",
    "First _paragraph_ with `code` and a [ref link][a].",
    "",
    "| A | B |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "[a]: https://example.com  'Title here'",
    "",
    "<!-- prettier-ignore-end -->",
    "",
    "Third paragraph stays put.",
  ].join("\n");

  it("the untouched document is byte-identical", () => {
    const editor = makeEditor(body);
    const out = getMd(editor);
    editor.destroy();
    expect(norm(out)).toBe(norm(body));
  });

  it("editing the heading leaves every other block verbatim", () => {
    const editor = makeEditor(body);
    editor.commands.insertContentAt(2, "X");
    const out = getMd(editor);
    editor.destroy();
    expect(out).toContain("<!-- prettier-ignore-start -->");
    expect(out).toContain("<!-- prettier-ignore-end -->");
    expect(out).toContain("First _paragraph_ with `code` and a [ref link][a].");
    expect(out).toContain("[a]: https://example.com  'Title here'");
    expect(out).toContain("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(out).toContain("Third paragraph stays put.");
  });
});
