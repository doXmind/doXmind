/**
 * Block-level source preservation (issue #149, Path X).
 * Untouched blocks must round-trip byte-identical; edits stay confined.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Editor } from "@tiptap/core";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { markdownToHtml } from "@/lib/markdown";
import { stripFrontmatter } from "@/extensions/source-preservation";

const REPO = resolve(__dirname, "../../..");

function makeEditor(body: string): Editor {
  const editor = new Editor({ extensions: getEditorExtensions(), content: markdownToHtml(body) });
  // Mirror the runtime load: settle the migration plugin, then capture baseline.
  editor.commands.setContent(markdownToHtml(body), { emitUpdate: false } as never);
  editor.commands.setSourceBaseline(body);
  return editor;
}
function getMd(editor: Editor): string {
  return editor.getMarkdown() as string;
}
const norm = (s: string) => s.replace(/\n+$/, "");

const FAITHFUL_DOCS = [
  "CONTEXT.md",
  "README.md", // heavy raw HTML (centered badge rows) — preserved via the rawHtml node
  "docs/adr/0006-feature-scope-typora-notion.md",
  "docs/adr/0004-custom-block-registry-split-and-correlation.md",
  "docs/adr/0002-hybrid-hydration-for-custom-blocks.md",
];

describe("source preservation — untouched docs round-trip byte-identical", () => {
  for (const rel of FAITHFUL_DOCS) {
    it(rel, () => {
      const body = stripFrontmatter(readFileSync(resolve(REPO, rel), "utf8"));
      const editor = makeEditor(body);
      const out = getMd(editor);
      editor.destroy();
      expect(norm(out)).toBe(norm(body));
    });
  }

  it("synthetic doc with a table + underscores + inline code", () => {
    const body = [
      "# Title",
      "",
      "First _paragraph_ with `code` and a [rel link](docs/x.md).",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "Third paragraph stays put.",
    ].join("\n");
    const editor = makeEditor(body);
    const out = getMd(editor);
    editor.destroy();
    expect(norm(out)).toBe(norm(body));
  });
});

describe("source preservation — raw HTML survives as one block", () => {
  it("a centered badge row round-trips byte-identical", () => {
    const body = [
      "# Title",
      "",
      '<p align="center">',
      '  <a href="https://x.com"><img src="b.svg" alt="badge" /></a>',
      "</p>",
      "",
      "A normal paragraph after the badges.",
    ].join("\n");
    const editor = makeEditor(body);
    const out = getMd(editor);
    editor.destroy();
    expect(norm(out)).toBe(norm(body));
  });

  it("a <details> toggle (multi-token block) round-trips byte-identical", () => {
    const body = [
      "# FAQ",
      "",
      "<details>",
      "<summary>Does it work?</summary>",
      "",
      "Yes, it does.",
      "",
      "</details>",
      "",
      "Closing note.",
    ].join("\n");
    const editor = makeEditor(body);
    const out = getMd(editor);
    editor.destroy();
    expect(norm(out)).toBe(norm(body));
  });

  it("editing prose around a raw-HTML block leaves the HTML verbatim", () => {
    const body = [
      '<div align="center"><img src="logo.png" width="900" /></div>',
      "",
      "Edit me.",
    ].join("\n");
    const editor = makeEditor(body);
    expect(norm(getMd(editor))).toBe(norm(body));
    // Append to the trailing paragraph; the raw-HTML block must not change.
    editor.commands.insertContentAt(editor.state.doc.content.size, " more");
    const out = getMd(editor);
    editor.destroy();
    expect(out).toContain('<div align="center"><img src="logo.png" width="900" /></div>');
  });
});

describe("source preservation — safe degradation", () => {
  it("transient/empty doc falls back without a baseline", () => {
    const editor = new Editor({ extensions: getEditorExtensions(), content: "<p>hello</p>" });
    editor.commands.setSourceBaseline(null);
    expect(getMd(editor)).toContain("hello");
    editor.destroy();
  });
});

describe("source preservation — edits stay confined to the edited block", () => {
  it("editing only the heading leaves the table and later prose byte-identical", () => {
    const body = [
      "# Title",
      "",
      "First _paragraph_ with `code`.",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "Third paragraph stays put.",
    ].join("\n");
    const editor = makeEditor(body);
    expect(norm(getMd(editor))).toBe(norm(body)); // baseline faithful

    // Edit the heading text only (insert inside "Title" at doc position 2).
    editor.commands.insertContentAt(2, "X");

    const out = getMd(editor);
    editor.destroy();

    // The edited heading reformats (acceptable — it was touched)…
    expect(out).toMatch(/# T?Xitle|# TXitle|TXitle/);
    // …but every untouched block survives verbatim, including the table grid
    // (which the old serializer rewrote) and the underscore emphasis.
    expect(out).toContain("First _paragraph_ with `code`.");
    expect(out).toContain("| A | B |");
    expect(out).toContain("| --- | --- |");
    expect(out).toContain("| 1 | 2 |");
    expect(out).toContain("Third paragraph stays put.");
  });
});
