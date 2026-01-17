/**
 * Tests for Markdown/HTML conversion utilities
 */
import { describe, it, expect } from "vitest";
import {
  htmlToMarkdown,
  markdownToHtml,
  isHtml,
  normalizeForAI,
  normalizeForEditor,
  markdownToPlainText,
} from "@/lib/markdown";

describe("Markdown Utilities", () => {
  describe("htmlToMarkdown", () => {
    it("converts empty string to empty string", () => {
      expect(htmlToMarkdown("")).toBe("");
    });

    it("converts whitespace to empty string", () => {
      expect(htmlToMarkdown("   ")).toBe("");
    });

    it("converts empty paragraph to empty string", () => {
      expect(htmlToMarkdown("<p></p>")).toBe("");
    });

    it("converts paragraph to text", () => {
      expect(htmlToMarkdown("<p>Hello World</p>")).toBe("Hello World");
    });

    it("converts headings", () => {
      expect(htmlToMarkdown("<h1>Title</h1>")).toBe("# Title");
      expect(htmlToMarkdown("<h2>Subtitle</h2>")).toBe("## Subtitle");
      expect(htmlToMarkdown("<h3>Section</h3>")).toBe("### Section");
    });

    it("converts bold text", () => {
      expect(htmlToMarkdown("<strong>bold</strong>")).toBe("**bold**");
      expect(htmlToMarkdown("<b>bold</b>")).toBe("**bold**");
    });

    it("converts italic text", () => {
      expect(htmlToMarkdown("<em>italic</em>")).toBe("_italic_");
      expect(htmlToMarkdown("<i>italic</i>")).toBe("_italic_");
    });

    it("converts strikethrough text", () => {
      expect(htmlToMarkdown("<del>deleted</del>")).toBe("~~deleted~~");
      expect(htmlToMarkdown("<s>strike</s>")).toBe("~~strike~~");
    });

    it("converts links", () => {
      expect(htmlToMarkdown('<a href="https://example.com">Link</a>')).toBe(
        "[Link](https://example.com)"
      );
    });

    it("converts unordered lists", () => {
      const html = "<ul><li>Item 1</li><li>Item 2</li></ul>";
      const result = htmlToMarkdown(html);
      // Turndown uses 3 spaces after bullet
      expect(result).toContain("-   Item 1");
      expect(result).toContain("-   Item 2");
    });

    it("converts ordered lists", () => {
      const html = "<ol><li>First</li><li>Second</li></ol>";
      const result = htmlToMarkdown(html);
      expect(result).toContain("1.  First");
      expect(result).toContain("2.  Second");
    });

    it("converts code blocks", () => {
      const html = "<pre><code>const x = 1;</code></pre>";
      const result = htmlToMarkdown(html);
      expect(result).toContain("const x = 1;");
    });

    it("converts inline code", () => {
      expect(htmlToMarkdown("<code>code</code>")).toBe("`code`");
    });

    it("converts blockquotes", () => {
      expect(htmlToMarkdown("<blockquote>Quote</blockquote>")).toBe("> Quote");
    });

    it("converts nested elements", () => {
      const html = "<p>This is <strong>bold</strong> and <em>italic</em></p>";
      expect(htmlToMarkdown(html)).toBe("This is **bold** and _italic_");
    });

    it("handles multiple paragraphs", () => {
      const html = "<p>First</p><p>Second</p>";
      const result = htmlToMarkdown(html);
      expect(result).toContain("First");
      expect(result).toContain("Second");
    });
  });

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
      // This might not work perfectly without markdown code fence detection
      // but we check common patterns
      expect(isHtml("x < y && y > z")).toBe(false);
    });
  });

  describe("normalizeForAI", () => {
    it("converts HTML to markdown", () => {
      const result = normalizeForAI("<p>Hello</p>");
      expect(result).toBe("Hello");
    });

    it("returns markdown as-is", () => {
      expect(normalizeForAI("# Title")).toBe("# Title");
    });

    it("returns plain text as-is", () => {
      expect(normalizeForAI("Plain text")).toBe("Plain text");
    });

    it("converts complex HTML", () => {
      const result = normalizeForAI("<h1>Title</h1><p>Content</p>");
      expect(result).toContain("# Title");
      expect(result).toContain("Content");
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

  describe("Round-trip Conversion", () => {
    it("preserves basic text through round-trip", () => {
      const original = "Hello World";
      const html = markdownToHtml(original);
      const markdown = htmlToMarkdown(html);
      expect(markdown).toBe(original);
    });

    it("preserves headings through round-trip", () => {
      const original = "# Title";
      const html = markdownToHtml(original);
      const markdown = htmlToMarkdown(html);
      expect(markdown).toBe(original);
    });

    it("preserves bold through round-trip", () => {
      const original = "**bold**";
      const html = markdownToHtml(original);
      const markdown = htmlToMarkdown(html);
      expect(markdown).toBe(original);
    });

    it("preserves links through round-trip", () => {
      const original = "[Link](https://example.com)";
      const html = markdownToHtml(original);
      const markdown = htmlToMarkdown(html);
      expect(markdown).toBe(original);
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

    it("handles empty paragraphs in HTML", () => {
      expect(htmlToMarkdown("<p></p>")).toBe("");
      expect(htmlToMarkdown("<p>   </p>")).toBe("");
    });

    it("handles multiple consecutive newlines", () => {
      const markdown = "First\n\n\n\nSecond";
      const result = markdownToHtml(markdown);
      expect(result).toContain("First");
      expect(result).toContain("Second");
    });
  });
});
