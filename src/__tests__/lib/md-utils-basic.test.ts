/**
 * Tests for Markdown/HTML conversion utilities (Part 1)
 *
 * HTML→Markdown is now handled by TipTap's @tiptap/markdown (editor.getMarkdown()),
 * so only markdownToHtml, isHtml, and normalizeForEditor are tested here.
 */
import { describe, it, expect } from "vitest";
import { markdownToHtml, isHtml, normalizeForEditor } from "@/lib/markdown";

describe("Markdown Utilities (Part 1)", () => {
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

  describe("isHtml", () => {
    it("returns false for empty string", () => {
      expect(isHtml("")).toBe(false);
    });

    it("returns false for plain text", () => {
      expect(isHtml("Hello World")).toBe(false);
    });

    it("returns false for markdown", () => {
      expect(isHtml("# Title")).toBe(false);
      expect(isHtml("**bold**")).toBe(false);
      expect(isHtml("- item")).toBe(false);
    });

    it("returns true for paragraph tag", () => {
      expect(isHtml("<p>text</p>")).toBe(true);
    });

    it("returns true for div tag", () => {
      expect(isHtml("<div>content</div>")).toBe(true);
    });

    it("returns true for heading tags", () => {
      expect(isHtml("<h1>Title</h1>")).toBe(true);
      expect(isHtml("<h2>Subtitle</h2>")).toBe(true);
      expect(isHtml("<h3>Section</h3>")).toBe(true);
    });

    it("returns true for list tags", () => {
      expect(isHtml("<ul><li>item</li></ul>")).toBe(true);
      expect(isHtml("<ol><li>item</li></ol>")).toBe(true);
    });

    it("returns true for table tags", () => {
      expect(isHtml("<table><tr><td>cell</td></tr></table>")).toBe(true);
    });

    it("returns true for formatting tags", () => {
      expect(isHtml("<strong>bold</strong>")).toBe(true);
      expect(isHtml("<em>italic</em>")).toBe(true);
    });

    it("returns true for self-closing tags", () => {
      expect(isHtml("<br/>")).toBe(true);
      expect(isHtml("<hr/>")).toBe(true);
    });

    it("returns false for angle brackets in code", () => {
      expect(isHtml("x < y && y > z")).toBe(false);
    });
  });

  describe("normalizeForEditor", () => {
    it("converts markdown to HTML", () => {
      const result = normalizeForEditor("# Title");
      expect(result).toContain("<h1>Title</h1>");
    });

    it("returns HTML as-is", () => {
      const html = "<p>Hello</p>";
      expect(normalizeForEditor(html)).toBe(html);
    });

    it("converts markdown with formatting", () => {
      const result = normalizeForEditor("**bold** and *italic*");
      expect(result).toContain("<strong>bold</strong>");
      expect(result).toContain("<em>italic</em>");
    });
  });
});
