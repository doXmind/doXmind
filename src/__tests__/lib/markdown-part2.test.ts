/**
 * Tests for Markdown/HTML conversion utilities (Part 2)
 *
 * Tests for markdownToPlainText, edge cases, Mermaid charts, and block math.
 */
import { describe, it, expect } from "vitest";
import { markdownToHtml, markdownToPlainText } from "@/lib/markdown";

describe("Markdown Utilities (Part 2)", () => {
  describe("markdownToPlainText", () => {
    it("returns empty string for empty input", () => {
      expect(markdownToPlainText("")).toBe("");
    });

    it("strips markdown formatting from bold", () => {
      const result = markdownToPlainText("**bold text**");
      expect(result).toContain("bold text");
      expect(result).not.toContain("**");
    });

    it("strips markdown formatting from italic", () => {
      const result = markdownToPlainText("*italic text*");
      expect(result).toContain("italic text");
      expect(result).not.toContain("*");
    });

    it("strips heading markers", () => {
      const result = markdownToPlainText("# Title");
      expect(result).toContain("Title");
      expect(result).not.toContain("#");
    });

    it("strips list markers", () => {
      const result = markdownToPlainText("- item 1\n- item 2");
      expect(result).toContain("item 1");
      expect(result).toContain("item 2");
      expect(result).not.toContain("-");
    });

    it("handles multiple paragraphs", () => {
      const result = markdownToPlainText("First paragraph\n\nSecond paragraph");
      expect(result).toContain("First paragraph");
      expect(result).toContain("Second paragraph");
    });

    it("handles mixed content", () => {
      const markdown = "# Title\n\n**Bold** and *italic* text\n\n- Item";
      const result = markdownToPlainText(markdown);
      expect(result).toContain("Title");
      expect(result).toContain("Bold");
      expect(result).toContain("italic");
      expect(result).toContain("Item");
    });

    it("handles code blocks", () => {
      const markdown = "```\ncode here\n```";
      const result = markdownToPlainText(markdown);
      expect(result).toContain("code here");
    });

    it("handles inline code", () => {
      const result = markdownToPlainText("`inline code`");
      expect(result).toContain("inline code");
    });

    it("strips link formatting", () => {
      const result = markdownToPlainText("[Link Text](https://example.com)");
      expect(result).toContain("Link Text");
    });

    it("handles HTML input", () => {
      const result = markdownToPlainText("<p>Hello</p><p>World</p>");
      expect(result).toContain("Hello");
      expect(result).toContain("World");
    });
  });

  describe("Edge Cases", () => {
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

  describe("Mermaid Chart markdownToHtml", () => {
    it("converts mermaid code fence to data-type div", () => {
      const markdown = "```mermaid\ngraph TD\n    A[Start] --> B[End]\n```";
      const html = markdownToHtml(markdown);
      expect(html).toContain('data-type="mermaid-chart"');
      expect(html).toContain("data-code=");
    });
  });

  describe("Block Math markdownToHtml", () => {
    it("converts $$ delimiters to data-type div", () => {
      const markdown = "$$\nE=mc^2\n$$";
      const html = markdownToHtml(markdown);
      expect(html).toContain('data-type="block-math"');
      expect(html).toContain("E=mc^2");
    });
  });
});
