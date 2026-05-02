import { describe, it, expect } from "vitest";
import { markdownToHtml } from "@/lib/markdown";

describe("markdownToHtml", () => {
  it("converts empty string to empty paragraph", () => {
    expect(markdownToHtml("")).toBe("<p></p>");
  });

  it("converts whitespace to empty paragraph", () => {
    expect(markdownToHtml("   ")).toBe("<p></p>");
  });

  it("converts text to paragraph", () => {
    const result = markdownToHtml("Hello World");
    expect(result).toContain("<p>Hello World</p>");
  });

  it("converts headings", () => {
    expect(markdownToHtml("# Title")).toContain("<h1>Title</h1>");
    expect(markdownToHtml("## Subtitle")).toContain("<h2>Subtitle</h2>");
    expect(markdownToHtml("### Section")).toContain("<h3>Section</h3>");
  });

  it("converts bold text", () => {
    const result = markdownToHtml("**bold**");
    expect(result).toContain("<strong>bold</strong>");
  });

  it("converts italic text", () => {
    const result = markdownToHtml("*italic*");
    expect(result).toContain("<em>italic</em>");
  });

  it("converts links", () => {
    const result = markdownToHtml("[Link](https://example.com)");
    expect(result).toContain('<a href="https://example.com">Link</a>');
  });

  it("converts unordered lists", () => {
    const result = markdownToHtml("- Item 1\n- Item 2");
    expect(result).toContain("<ul>");
    expect(result).toContain("<li>Item 1</li>");
    expect(result).toContain("<li>Item 2</li>");
  });

  it("converts ordered lists", () => {
    const result = markdownToHtml("1. First\n2. Second");
    expect(result).toContain("<ol>");
    expect(result).toContain("<li>First</li>");
    expect(result).toContain("<li>Second</li>");
  });

  it("converts fenced code blocks", () => {
    const result = markdownToHtml("```\ncode\n```");
    expect(result).toContain("<pre>");
    expect(result).toContain("<code>");
  });

  it("converts inline code", () => {
    const result = markdownToHtml("`code`");
    expect(result).toContain("<code>code</code>");
  });

  it("converts blockquotes", () => {
    const result = markdownToHtml("> Quote");
    expect(result).toContain("<blockquote>");
    expect(result).toContain("Quote");
  });

  it("converts horizontal rule", () => {
    const result = markdownToHtml("---");
    expect(result).toContain("<hr");
  });

  it("converts tables", () => {
    const table = "| A | B |\n|---|---|\n| 1 | 2 |";
    const result = markdownToHtml(table);
    expect(result).toContain("<table>");
    expect(result).toContain("<th>");
    expect(result).toContain("<td>");
  });
});
