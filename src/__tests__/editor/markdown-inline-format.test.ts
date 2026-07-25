import { describe, expect, it } from "vitest";

import {
  createMarkdownInlineFormatEdit,
  createMarkdownLinkEdit,
  markdownInlineFormatState,
} from "@/editor/markdown-block/markdown-inline-format";

describe("Markdown inline formatting", () => {
  it("wraps and unwraps a semantic selection without touching surrounding source", () => {
    expect(createMarkdownInlineFormatEdit("Hello world", 0, 5, "bold")).toEqual({
      from: 0,
      to: 5,
      text: "**Hello**",
      selection: { anchor: 2, head: 7 },
    });
    expect(createMarkdownInlineFormatEdit("**Hello** world", 2, 7, "bold")).toEqual({
      from: 0,
      to: 9,
      text: "Hello",
      selection: { anchor: 0, head: 5 },
    });
  });

  it("creates portable links and code spans", () => {
    // Applying a link needs a destination, which only the user has: this used to write
    // `[docs](https://)` — a link that goes nowhere, with the selection over the label so the next
    // keystroke rewrote the text rather than the URL.
    expect(createMarkdownInlineFormatEdit("Read docs", 5, 9, "link")).toBeNull();
    expect(createMarkdownLinkEdit("Read docs", 5, 9, "https://example.com")).toEqual({
      from: 5,
      to: 9,
      text: "[docs](https://example.com)",
      selection: { anchor: 6, head: 10 },
    });
    expect(createMarkdownInlineFormatEdit("Use `code`", 4, 10, "code")).toEqual({
      from: 4,
      to: 10,
      text: "`` `code` ``",
      selection: { anchor: 7, head: 13 },
    });
  });

  it("reports active wrappers for the floating toolbar", () => {
    expect(markdownInlineFormatState("**bold** and `code`", 2, 6)).toEqual({
      bold: true,
      italic: false,
      strike: false,
      link: false,
      code: false,
    });
    expect(markdownInlineFormatState("[local](https://example.test)", 1, 6)).toMatchObject({
      link: true,
    });
  });

  it("never treats image alt text as a link that can be toggled", () => {
    const source = "See ![diagram](./assets/diagram.png)";
    const from = source.indexOf("diagram");
    const to = from + "diagram".length;

    expect(markdownInlineFormatState(source, from, to)).toMatchObject({
      link: false,
    });
    expect(createMarkdownInlineFormatEdit(source, from, to, "link")).toBeNull();
  });

  it("preserves link toggling when a preceding image marker is escaped", () => {
    const source = String.raw`\![label](target)`;

    expect(createMarkdownInlineFormatEdit(source, 3, 8, "link")).toEqual({
      from: 2,
      to: source.length,
      text: "label",
      selection: { anchor: 2, head: 7 },
    });
  });

  it("unwraps a link only after its balanced destination closes", () => {
    const source = "[docs](https://example.test/a_(b)) next";

    expect(createMarkdownInlineFormatEdit(source, 1, 5, "link")).toEqual({
      from: 0,
      to: source.indexOf(" next"),
      text: "docs",
      selection: { anchor: 0, head: 4 },
    });
  });

  it("does not close a link destination on an escaped parenthesis", () => {
    const source = String.raw`[docs](https://example.test/a\)b) next`;

    expect(createMarkdownInlineFormatEdit(source, 1, 5, "link")).toEqual({
      from: 0,
      to: source.indexOf(" next"),
      text: "docs",
      selection: { anchor: 0, head: 4 },
    });
  });

  it("fails closed instead of creating a link with an unescaped closing bracket", () => {
    expect(createMarkdownInlineFormatEdit("a]b", 0, 3, "link")).toBeNull();
  });

  it("does not add incompatible emphasis inside a code span", () => {
    expect(createMarkdownInlineFormatEdit("Use `code`", 5, 9, "bold")).toBeNull();
  });

  it("does not add incompatible formatting to a partial code-span selection", () => {
    expect(createMarkdownInlineFormatEdit("Use `code`", 6, 8, "link")).toBeNull();
  });

  it("fails closed when a formatting selection clips code-span syntax", () => {
    expect(createMarkdownInlineFormatEdit("Use `code` here", 8, 11, "strike")).toBeNull();
  });

  it("does not rewrite any part of an image when formatting its alt text", () => {
    const source = "See ![diagram](./assets/diagram.png)";
    const altFrom = source.indexOf("diagram");

    expect(createMarkdownInlineFormatEdit(source, altFrom + 1, altFrom + 5, "bold")).toBeNull();
  });

  it("does not add incompatible wrappers inside an existing link", () => {
    const source = "[local docs](https://example.test)";

    expect(createMarkdownInlineFormatEdit(source, 2, 6, "italic")).toBeNull();
    expect(createMarkdownInlineFormatEdit(source, 2, 6, "link")).toBeNull();
  });

  it("keeps selection offsets in the DOM UTF-16 coordinate space", () => {
    expect(createMarkdownInlineFormatEdit("Hi 😀", 3, 5, "bold")).toEqual({
      from: 3,
      to: 5,
      text: "**😀**",
      selection: { anchor: 5, head: 7 },
    });
  });

  it("adds italic outside bold and toggles triple emphasis without corrupting either mark", () => {
    expect(createMarkdownInlineFormatEdit("**bold**", 2, 6, "italic")).toEqual({
      from: 2,
      to: 6,
      text: "*bold*",
      selection: { anchor: 3, head: 7 },
    });
    expect(markdownInlineFormatState("***bold***", 3, 7)).toMatchObject({
      bold: true,
      italic: true,
    });
    expect(createMarkdownInlineFormatEdit("***bold***", 3, 7, "italic")).toEqual({
      from: 2,
      to: 8,
      text: "bold",
      selection: { anchor: 2, head: 6 },
    });
  });
});

describe("createMarkdownLinkEdit", () => {
  it("wraps a selection with a real destination", () => {
    expect(createMarkdownLinkEdit("see here", 4, 8, "https://example.com")).toMatchObject({
      text: "[here](https://example.com)",
    });
  });

  it("uses the destination as the label when nothing is selected", () => {
    expect(createMarkdownLinkEdit("see ", 4, 4, "https://example.com")).toMatchObject({
      text: "[https://example.com](https://example.com)",
    });
  });

  it("retargets a link the selection already sits inside instead of nesting one", () => {
    const source = "see [docs](https://old.example) now";
    const edit = createMarkdownLinkEdit(source, 6, 9, "https://new.example");
    expect(edit).toMatchObject({ from: 4, to: 31, text: "[docs](https://new.example)" });
  });

  it("angle-brackets a destination containing characters that would end it early", () => {
    expect(createMarkdownLinkEdit("x", 0, 1, "https://e.com/a b")).toMatchObject({
      text: "[x](<https://e.com/a b>)",
    });
  });

  it("refuses an empty destination, a label with an unescaped bracket, and inline code", () => {
    expect(createMarkdownLinkEdit("word", 0, 4, "   ")).toBeNull();
    expect(createMarkdownLinkEdit("a]b", 0, 3, "https://e.com")).toBeNull();
    expect(createMarkdownLinkEdit("`code`", 1, 5, "https://e.com")).toBeNull();
  });
});
