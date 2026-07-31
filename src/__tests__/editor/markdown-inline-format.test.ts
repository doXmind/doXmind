import { describe, expect, it } from "vitest";

import {
  createMarkdownInlineFormatEdit,
  markdownLinkDestinationAt,
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
    // Selecting a whole chip, delimiters included, takes the code off it. The semantic editor hides
    // the backticks, so this range only ever arises from a drag over a rendered chip, which means
    // "this chip" — not "wrap these six literal characters in a longer fence".
    expect(createMarkdownInlineFormatEdit("Use `code`", 4, 10, "code")).toEqual({
      from: 4,
      to: 10,
      text: "code",
      selection: { anchor: 4, head: 8 },
    });
    // The longer fence still exists for text carrying a backtick that closes nothing, which is the
    // only way to select backticks that are not already a span.
    expect(createMarkdownInlineFormatEdit("Use a ` b here", 6, 9, "code")).toEqual({
      from: 6,
      to: 9,
      text: "`` ` b ``",
      selection: { anchor: 9, head: 12 },
    });
    // Round trip: a padded fence gives its content back without the spaces that held it open.
    expect(createMarkdownInlineFormatEdit("Use `` ` b `` here", 4, 13, "code")).toEqual({
      from: 4,
      to: 13,
      text: "` b",
      selection: { anchor: 4, head: 7 },
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

  it("reports emphasis only when the whole selection carries it", () => {
    // Reading the characters just outside the selection, a drag across `*a* and *b*` abuts a `*` at
    // either end, so Italic drew pressed for a run that is mostly not italic — and pressing it did
    // nothing, because untoggling there would take the opening delimiter of one span and the closing
    // delimiter of the other. A pressed button that does nothing is worse than an unlit one.
    expect(markdownInlineFormatState("*a* and *b*", 1, 10)).toMatchObject({ italic: false });
    expect(markdownInlineFormatState("**a** and **b**", 2, 13)).toMatchObject({ bold: false });
    expect(markdownInlineFormatState("~~gone~~ and ~~also gone~~", 2, 24)).toMatchObject({
      strike: false,
    });
    // A fragment inside a span carries the mark, but has no delimiter beside it for the untoggle to
    // remove, so it stays unlit rather than lighting up for an edit that declines.
    expect(markdownInlineFormatState("A **bold phrase** here", 9, 15)).toMatchObject({
      bold: false,
    });
    expect(createMarkdownInlineFormatEdit("A **bold phrase** here", 9, 15, "bold")).toBeNull();

    // What one span's worth of selection reports is unchanged, delimiter character included.
    expect(markdownInlineFormatState("**a *b* c**", 2, 9)).toMatchObject({ bold: true });
    expect(markdownInlineFormatState("This is _important_ text", 9, 18)).toMatchObject({
      italic: true,
    });
    expect(markdownInlineFormatState("~~gone~~ here", 2, 6)).toMatchObject({ strike: true });
  });

  it("reports inline code when the selection reaches onto the delimiters", () => {
    // An inline code chip is drawn with padding. A drag that begins a pixel inside its left edge
    // anchors in the preceding text node, so the source offsets straddle a backtick even though the
    // selected text is exactly the chip. Reporting no code there left the toolbar button unlit while
    // the whole chip was visibly highlighted.
    const source = "Run `codetoken` now";
    const open = source.indexOf("`");
    const contentFrom = open + 1;
    const contentTo = source.indexOf("`", contentFrom);
    const close = contentTo + 1;

    for (const [from, to, label] of [
      [contentFrom, contentTo, "exactly the content"],
      [open, contentTo, "anchored on the opening backtick"],
      [contentFrom, close, "extended over the closing backtick"],
      [open, close, "the whole span, delimiters included"],
      [contentFrom + 1, contentTo - 1, "a fragment inside the content"],
    ] as [number, number, string][]) {
      expect(markdownInlineFormatState(source, from, to).code, label).toBe(true);
    }
  });

  it("does not report inline code for a selection that leaves the span", () => {
    const source = "Run `codetoken` now";

    // Plain text either side, and a drag that starts in the prose and ends inside the chip: part of
    // the selection is not code, so the toolbar must not claim the selection is.
    expect(markdownInlineFormatState(source, 0, 3).code, "prose before").toBe(false);
    expect(markdownInlineFormatState(source, 16, 19).code, "prose after").toBe(false);
    expect(markdownInlineFormatState(source, 1, 8).code, "prose into the chip").toBe(false);
    expect(markdownInlineFormatState(source, 8, 18).code, "chip into the prose").toBe(false);
  });

  it("reports underscore emphasis, which is what a formatted file actually contains", () => {
    // Prettier writes emphasis with `_`, so this is the common case, not the exotic one.
    const italic = "This is _important_ text";
    const from = italic.indexOf("important");
    expect(markdownInlineFormatState(italic, from, from + 9)).toMatchObject({
      italic: true,
      bold: false,
    });
    // Toggling off is length arithmetic, so a one-character `_` unwraps like a one-character `*`.
    expect(createMarkdownInlineFormatEdit(italic, from, from + 9, "italic")).toEqual({
      from: from - 1,
      to: from + 10,
      text: "important",
      selection: { anchor: from - 1, head: from + 8 },
    });

    const bold = "This is __strong__ text";
    const boldFrom = bold.indexOf("strong");
    expect(markdownInlineFormatState(bold, boldFrom, boldFrom + 6)).toMatchObject({ bold: true });
  });

  it("does not call an underscore inside a word emphasis", () => {
    // CommonMark's rule, and already what the projection uses to decide what to render — the toolbar
    // has to agree with the text under it.
    const source = "call snake_case_name here";
    const from = source.indexOf("case");
    expect(markdownInlineFormatState(source, from, from + 4)).toMatchObject({
      italic: false,
      bold: false,
    });
  });

  it("reads a destination with balanced parentheses whole, and keeps a title out of it", () => {
    const parens = "See [wiki](https://en.wikipedia.org/wiki/Ruby_(gem)) now";
    const at = parens.indexOf("wiki]");
    // The old regex stopped at the first `)`, so the link editor prefilled a URL one character short
    // of working and accepting it unchanged rewrote the file with the broken value.
    expect(markdownLinkDestinationAt(parens, at, at + 4)).toBe(
      "https://en.wikipedia.org/wiki/Ruby_(gem)"
    );

    const titled = '[docs](https://e.com/p "Handbook")';
    expect(markdownLinkDestinationAt(titled, 1, 5)).toBe("https://e.com/p");

    const angled = "[a](<https://e.com/a b>)";
    expect(markdownLinkDestinationAt(angled, 1, 2)).toBe("https://e.com/a b");

    // Nothing to prefill when the selection is not in a link, and an image is not one.
    expect(markdownLinkDestinationAt("plain text", 0, 5)).toBe("");
    expect(markdownLinkDestinationAt("![alt](a.png)", 2, 5)).toBe("");
  });

  it("keeps a link's title when only its destination is being changed", () => {
    const source = '[docs](https://old.example "Handbook")';
    const edit = createMarkdownLinkEdit(source, 1, 5, "https://new.example");

    expect(edit?.text).toBe('[docs](https://new.example "Handbook")');
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

  it("refuses a format whose selection ends inside an emphasis delimiter run", () => {
    // The semantic editor hides the delimiters, so dragging the rendered word `bold` in
    // `A **bold phrase** here` anchors at source offset 4 — inside the `**` run. Splicing markers at
    // those offsets wrote `A ****bold** phrase** here`, putting asterisks the user never typed into
    // the paragraph and rewriting delimiters they never selected.
    expect(createMarkdownInlineFormatEdit("A **bold phrase** here", 4, 8, "bold")).toBeNull();
    expect(createMarkdownInlineFormatEdit("A **bold** here", 4, 12, "bold")).toBeNull();
    expect(createMarkdownInlineFormatEdit("**bold** tail", 2, 13, "bold")).toBeNull();
    // A different mark applied wholly inside the span is still fine — the guard is about delimiters
    // the edit would rewrite, not about formatting emphasized text.
    expect(createMarkdownInlineFormatEdit("A **bold phrase** here", 4, 8, "strike")).toEqual({
      from: 4,
      to: 8,
      text: "~~bold~~",
      selection: { anchor: 6, head: 10 },
    });
  });

  it("refuses to untoggle emphasis across two different spans", () => {
    // Reading only the characters just outside the selection, selecting the whole of `*a* and *b*`
    // looked italic, and untoggling deleted the opening `*` of the first span and the closing `*` of
    // the second, leaving `a* and *b`.
    expect(createMarkdownInlineFormatEdit("*a* and *b*", 1, 10, "italic")).toBeNull();
    expect(createMarkdownInlineFormatEdit("**a** and **b**", 2, 13, "bold")).toBeNull();
    expect(
      createMarkdownInlineFormatEdit("~~gone~~ and ~~also gone~~", 2, 24, "strike")
    ).toBeNull();
  });

  it("keeps selection offsets in the DOM UTF-16 coordinate space", () => {
    expect(createMarkdownInlineFormatEdit("Hi 😀", 3, 5, "bold")).toEqual({
      from: 3,
      to: 5,
      text: "**😀**",
      selection: { anchor: 5, head: 7 },
    });
  });

  /*
   * A selection that only partly covers an emphasis run declines.
   *
   * Reparsing the result catches most of these, but not all: wrapping `phrase` inside
   * `A **bold phrase** here` produces `A **bold **phrase**** here`, whose visible text is still
   * `A bold phrase here`, so the round-trip check passes while the file has grown a four-asterisk
   * run. Emphasis runs mean something up to three — `***bold***` is italic nested in bold and must
   * still work — so a *new* run of four is the corruption and nothing else.
   */
  it("declines rather than splicing a marker into an existing emphasis run", () => {
    const source = "A **bold phrase** here";
    // The head of the run, the tail of it, and a selection that swallows the delimiters.
    expect(createMarkdownInlineFormatEdit(source, 4, 8, "bold")).toBeNull();
    expect(createMarkdownInlineFormatEdit(source, 9, 15, "bold")).toBeNull();
    expect(createMarkdownInlineFormatEdit(source, 2, 17, "bold")).toBeNull();
    // Selecting exactly what the run wraps still toggles it off.
    const off = createMarkdownInlineFormatEdit(source, 4, 15, "bold");
    expect(off).not.toBeNull();
    expect(source.slice(0, off!.from) + off!.text + source.slice(off!.to)).toBe(
      "A bold phrase here"
    );
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

  it("refuses a selection that straddles an emphasis marker", () => {
    // Selecting the visible run `bold and` in `**bold** and more` maps to source [2,12), which is
    // inside the opening `**`. Wrapping that range produced `**[bold** and](https://e.com) more`:
    // the bold the user never touched was destroyed and the link did not even render as one.
    expect(createMarkdownLinkEdit("**bold** and more", 2, 12, "https://e.com")).toBeNull();
  });

  it("refuses an empty destination, a label with an unescaped bracket, and inline code", () => {
    expect(createMarkdownLinkEdit("word", 0, 4, "   ")).toBeNull();
    expect(createMarkdownLinkEdit("a]b", 0, 3, "https://e.com")).toBeNull();
    expect(createMarkdownLinkEdit("`code`", 1, 5, "https://e.com")).toBeNull();
  });
});
