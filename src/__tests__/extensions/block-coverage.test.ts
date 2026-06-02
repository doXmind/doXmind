/**
 * Comprehensive per-block round-trip coverage for source preservation (#149).
 * Every block type doXmind supports must round-trip byte-identical when the
 * document is opened and saved untouched.
 */
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { markdownToHtml } from "@/lib/markdown";

const norm = (s: string) => s.replace(/\n+$/, "");

function roundtripFromMarkdown(body: string): string {
  const editor = new Editor({ extensions: getEditorExtensions(), content: markdownToHtml(body) });
  editor.commands.setContent(markdownToHtml(body), { emitUpdate: false } as never);
  editor.commands.setSourceBaseline(body);
  const out = editor.getMarkdown() as string;
  editor.destroy();
  return out;
}

function roundtripFromHtml(html: string, body: string): string {
  const editor = new Editor({ extensions: getEditorExtensions(), content: html });
  editor.commands.setContent(html, { emitUpdate: false } as never);
  editor.commands.setSourceBaseline(body);
  const out = editor.getMarkdown() as string;
  editor.destroy();
  return out;
}

// Blocks whose Markdown form imports directly into their editor node.
const MARKDOWN_BLOCKS: Record<string, string> = {
  heading: "# Heading",
  paragraph: "Just a paragraph.",
  bulletList: "- one\n- two",
  orderedList: "1. one\n2. two",
  nestedList: "- a\n  - b\n  - c",
  taskList: "- [ ] todo\n- [x] done",
  table: "| a | b |\n| --- | --- |\n| 1 | 2 |",
  blockquote: "> a quote",
  callout: "> [!NOTE]\n> note text",
  fencedCode: "```js\nconst x = 1;\n```",
  mermaid: "```mermaid\ngraph TD\n  A --> B\n```",
  inlineMath: "energy is $E=mc^2$ ok",
  blockMath: "$$\n\\int_0^1 x\\,dx\n$$",
  horizontalRule: "above\n\n---\n\nbelow",
  inlineCode: "use `code` here",
  emphasisUnderscore: "this is _em_ text",
  bold: "this is **bold** text",
  strikethrough: "this is ~~gone~~ text",
  link: "see [text](https://x.com/a)",
  relativeLink: "see [text](docs/adr/0001.md)",
  image: "![alt](assets/img.png)",
  rawHtmlBadge: '<p align="center"><img src="b.svg" alt="b"></p>',
  detailsToggle: "<details>\n<summary>Q</summary>\n\nbody\n\n</details>",
  columns:
    '<div data-columns="2">\n\n<div data-column>\n\nleft\n\n</div>\n\n<div data-column>\n\nright\n\n</div>\n\n</div>',
};

// External-reference blocks live as a `<div data-type=...>` element in the
// editor (sidecar) HTML; the Markdown body is an HTML-comment placeholder.
const EXTERNAL_REF_BLOCKS: Record<string, { html: string; body: string }> = {
  pdfBlock: {
    html: '<div data-type="pdf-block" data-id="p1" data-src="spec.pdf"></div>',
    body: '<!-- pdf-block id="p1" src="spec.pdf" -->',
  },
  excelBlock: {
    html: '<div data-type="excel-block" data-id="e1" data-src="data.xlsx"></div>',
    body: '<!-- excel-block id="e1" src="data.xlsx" -->',
  },
  databaseBlock: {
    html: '<div data-type="database-block" data-database-id="abc123"></div>',
    body: "<!-- database:abc123 -->",
  },
};

describe("block coverage — markdown-form blocks round-trip byte-identical", () => {
  for (const [name, body] of Object.entries(MARKDOWN_BLOCKS)) {
    it(name, () => {
      expect(norm(roundtripFromMarkdown(body))).toBe(norm(body));
    });
  }
});

describe("block coverage — external-reference blocks round-trip byte-identical", () => {
  for (const [name, { html, body }] of Object.entries(EXTERNAL_REF_BLOCKS)) {
    it(name, () => {
      expect(norm(roundtripFromHtml(html, body))).toBe(norm(body));
    });
  }
});

describe("block coverage — a document mixing many block types", () => {
  it("preserves every untouched block in one document", () => {
    const body = [
      "# Title",
      "",
      '<p align="center"><img src="b.svg" alt="b"></p>',
      "",
      "A paragraph with _em_, **bold**, `code`, ~~strike~~ and [a link](docs/x.md).",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "- list one",
      "- list two",
      "",
      "> [!NOTE]",
      "> a callout",
      "",
      "```python",
      "print('hi')",
      "```",
      "",
      "$$",
      "x^2",
      "$$",
      "",
      "<details>",
      "<summary>FAQ</summary>",
      "",
      "answer",
      "",
      "</details>",
      "",
      "Final line.",
    ].join("\n");
    expect(norm(roundtripFromMarkdown(body))).toBe(norm(body));
  });
});
