import { describe, expect, it } from "vitest";

import { scanMarkdownSource } from "@/editor/markdown-block/markdown-source-scanner";

describe("scanMarkdownSource", () => {
  it("projects adjacent ATX headings and paragraphs as exact source Blocks", () => {
    const markdown = "# Heading\nParagraph\n## Next\nText";

    const spans = scanMarkdownSource(markdown);

    expect(spans.map((span) => span.raw)).toEqual([
      "# Heading\n",
      "Paragraph\n",
      "## Next\n",
      "Text",
    ]);
    expect(spans.map((span) => span.raw).join("")).toBe(markdown);
  });

  it("keeps a portable details toggle with blank lines as one source Block", () => {
    const markdown =
      "Before\r\n\r\n<details>\r\n<summary>More</summary>\r\n\r\n- one\r\n- two\r\n\r\n</details>\r\n\r\nAfter\r\n";

    const spans = scanMarkdownSource(markdown);

    expect(spans.map((span) => span.raw)).toEqual([
      "Before\r\n\r\n",
      "<details>\r\n<summary>More</summary>\r\n\r\n- one\r\n- two\r\n\r\n</details>\r\n\r\n",
      "After\r\n",
    ]);
    expect(spans.map((span) => span.raw).join("")).toBe(markdown);
  });

  it("balances nested toggles and ignores details-shaped text inside fences", () => {
    const toggle =
      "<details>\n<summary>Outer</summary>\n\n```html\n</details>\n```\n\n<details>\n<summary>Inner</summary>\n\nNested\n\n</details>\n\n</details>\n\n";
    const markdown = `${toggle}After\n`;

    expect(scanMarkdownSource(markdown).map((span) => span.raw)).toEqual([toggle, "After\n"]);
  });

  it("does not let an unclosed details tag swallow the rest of the Page", () => {
    const markdown =
      "<details>\n<summary>Broken</summary>\n\nStill a separate paragraph\n\nAfter\n";
    const spans = scanMarkdownSource(markdown);

    expect(spans.length).toBeGreaterThan(1);
    expect(spans.map((span) => span.raw).join("")).toBe(markdown);
    expect(spans.at(-1)?.raw).toContain("After");
  });
  it("returns contiguous source views that round-trip exactly", () => {
    const markdown = "\nAlpha\n\nBeta\n";

    const spans = scanMarkdownSource(markdown);

    expect(spans.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 8 },
      { from: 8, to: markdown.length },
    ]);
    expect(spans.map((span) => span.raw).join("")).toBe(markdown);
    for (const span of spans) {
      expect(span.raw).toBe(markdown.slice(span.from, span.to));
    }
  });

  it("keeps a complete backtick fence with CRLF and blank code lines in one span", () => {
    const fence = "```ts\r\nalpha\r\n\r\nbeta\r\n```\r\n\r\n";
    const markdown = `Before\r\n\r\n${fence}After\r\n`;

    const spans = scanMarkdownSource(markdown);

    expect(spans.map((span) => span.raw)).toEqual(["Before\r\n\r\n", fence, "After\r\n"]);
    expect(spans.map((span) => span.raw).join("")).toBe(markdown);
  });

  it("closes a tilde fence only with the same marker at least as long as its opener", () => {
    const fence = "~~~~ text\none\n~~~\n````\n~~~~ extra\n~~~~~\n";
    const markdown = `Before\n${fence}After`;

    const spans = scanMarkdownSource(markdown);

    expect(spans.map((span) => span.raw)).toEqual(["Before\n", fence, "After"]);
    expect(spans.map((span) => span.raw).join("")).toBe(markdown);
  });

  it("keeps an unclosed fence intact through the end of the source", () => {
    const unclosedFence = "```md\nline\n\ntext after the blank stays code\n";
    const markdown = `Before\n\n${unclosedFence}`;

    const spans = scanMarkdownSource(markdown);

    expect(spans.map((span) => span.raw)).toEqual(["Before\n\n", unclosedFence]);
    expect(spans.at(-1)?.to).toBe(markdown.length);
  });

  it("keeps an HTML comment with internal blank lines intact until its terminator", () => {
    const raw = "<!-- first\n\nstill comment\n-->\n\n";
    const markdown = `Before\n\n${raw}After\n`;

    const spans = scanMarkdownSource(markdown);

    expect(spans.map((span) => span.raw)).toEqual(["Before\n\n", raw, "After\n"]);
    expect(spans.map((span) => span.raw).join("")).toBe(markdown);
  });

  it.each([
    ["raw HTML container", '<script type="text/plain">\nfirst\n\nstill raw\n</script>\n\n'],
    ["processing instruction", "<?doxmind\n\nraw=true\n?>\n\n"],
    ["CDATA section", "<![CDATA[\nfirst\n\nstill raw\n]]>\n\n"],
  ])("keeps a %s intact through its CommonMark terminator", (_name, raw) => {
    const markdown = `Before\n\n${raw}After\n`;

    const spans = scanMarkdownSource(markdown);

    expect(spans.map((span) => span.raw)).toEqual(["Before\n\n", raw, "After\n"]);
    expect(spans.map((span) => span.raw).join("")).toBe(markdown);
  });

  it("projects each top-level list item as an exact source span", () => {
    const markdown = "Before\r\n\r\n- first\r\n- [ ] task\r\n3) ordered\r\n\r\nAfter\r\n";

    const spans = scanMarkdownSource(markdown);

    expect(spans.map((span) => span.raw)).toEqual([
      "Before\r\n\r\n",
      "- first\r\n",
      "- [ ] task\r\n",
      "3) ordered\r\n\r\n",
      "After\r\n",
    ]);
    expect(spans.map((span) => span.raw).join("")).toBe(markdown);
  });

  it("keeps an indented code block and its internal blank lines in one raw span", () => {
    const raw = "    first\n\n\tsecond\n\n";
    const markdown = `Before\n\n${raw}After\n`;

    const spans = scanMarkdownSource(markdown);

    expect(spans.map((span) => span.raw)).toEqual(["Before\n\n", raw, "After\n"]);
    expect(spans.map((span) => span.raw).join("")).toBe(markdown);
  });

  it("keeps an indented nested list attached to its top-level owning item", () => {
    const markdown = "- outer\n  continuation\n  - nested\n- next\n";

    const spans = scanMarkdownSource(markdown);

    expect(spans.map((span) => span.raw)).toEqual([
      "- outer\n  continuation\n  - nested\n",
      "- next\n",
    ]);
    expect(spans.map((span) => span.raw).join("")).toBe(markdown);
  });

  it("preserves leading and trailing blank lines byte-for-byte", () => {
    const leading = "\r\n \r\n";
    const contentWithTrailing = "Alpha\r\n\r\n\t\r\n";
    const markdown = leading + contentWithTrailing;

    const spans = scanMarkdownSource(markdown);

    expect(spans.map((span) => span.raw)).toEqual([leading, contentWithTrailing]);
    expect(spans[0]).toMatchObject({ from: 0, to: leading.length });
    expect(spans[1]).toMatchObject({ from: leading.length, to: markdown.length });
  });
});
