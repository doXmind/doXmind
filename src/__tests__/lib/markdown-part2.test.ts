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
});
