import { describe, it, expect } from "vitest";
import { markdownToHtml } from "@/lib/markdown";

describe("markdownToHtml edge cases", () => {
  it("handles special characters in HTML", () => {
    const result = markdownToHtml("A < B > C & D");
    expect(result).toContain("&lt;");
    expect(result).toContain("&gt;");
    expect(result).toContain("&amp;");
  });

  it("handles nested lists", () => {
    const markdown = "- Item 1\n  - Nested\n- Item 2";
    const result = markdownToHtml(markdown);
    expect(result).toContain("<ul>");
    expect(result).toContain("<li>Item 1");
    expect(result).toContain("Nested");
  });

  it("handles images", () => {
    const markdown = "![Alt text](https://example.com/image.png)";
    const result = markdownToHtml(markdown);
    expect(result).toContain("<img");
    expect(result).toContain("src=");
  });

  it("handles escape characters", () => {
    const markdown = "\\*not italic\\*";
    const result = markdownToHtml(markdown);
    expect(result).toContain("*not italic*");
  });

  it("handles multiple consecutive newlines", () => {
    const markdown = "First\n\n\n\nSecond";
    const result = markdownToHtml(markdown);
    expect(result).toContain("First");
    expect(result).toContain("Second");
  });
});

describe("markdownToHtml mermaid + math", () => {
  it("converts mermaid code fence to data-type div", () => {
    const markdown = "```mermaid\ngraph TD\n    A[Start] --> B[End]\n```";
    const html = markdownToHtml(markdown);
    expect(html).toContain('data-type="mermaid-chart"');
    expect(html).toContain("data-code=");
  });

  it("converts $$ delimiters to block-math div", () => {
    const markdown = "$$\nE=mc^2\n$$";
    const html = markdownToHtml(markdown);
    expect(html).toContain('data-type="block-math"');
    expect(html).toContain("E=mc^2");
  });

  it("converts block math that follows a text line without a blank line", () => {
    const html = markdownToHtml("Intro line\n$$\nE=mc^2\n$$\nAfter");
    expect(html).toContain('data-type="block-math"');
  });

  // issue #149: marked's blockMath `start` used to fire on any `$$`, breaking a
  // paragraph mid-line and re-lexing inline `` `$$x$$` `` code as a math block.
  it("does NOT turn $$ inside an inline code span into block math", () => {
    const html = markdownToHtml("Use ``$$E=mc^2$$`` to write block math.");
    expect(html).not.toContain('data-type="block-math"');
    expect(html).toContain("<code>$$E=mc^2$$</code>");
  });

  it("keeps single-backtick code with $ as code, not math", () => {
    const html = markdownToHtml("Use `$x^2$` for inline math.");
    expect(html).not.toContain("data-type=");
    expect(html).toContain("<code>$x^2$</code>");
  });

  it("leaves stray mid-line $$ as literal text", () => {
    const html = markdownToHtml("the cost is $$5 to $$10 dollars");
    expect(html).not.toContain('data-type="block-math"');
    expect(html).toContain("$$5 to $$10");
  });
});

describe("markdownToHtml raw-HTML sentinel (issue #149)", () => {
  it("wraps a raw-HTML badge block in a rawHtml sentinel", () => {
    const html = markdownToHtml('<p align="center"><img src="b.svg"></p>');
    expect(html).toContain("data-raw-html=");
  });

  it("does NOT wrap comment placeholders (pdf/excel/database)", () => {
    const html = markdownToHtml('<!-- pdf-block id="a" src="s.pdf" -->');
    expect(html).not.toContain("data-raw-html");
    expect(html).toContain("<!-- pdf-block");
  });

  it("does NOT wrap a <details> toggle block", () => {
    const html = markdownToHtml("<details>\n<summary>S</summary>\n\nbody\n\n</details>");
    expect(html).not.toContain("data-raw-html");
  });

  it("does NOT wrap a columns div", () => {
    const html = markdownToHtml('<div data-columns="2">\n\nx\n\n</div>');
    expect(html).not.toContain("data-raw-html");
    expect(html).toContain("data-columns");
  });
});
