/**
 * Tests for findInMarkdown helper
 *
 * Verifies that the backend-provided offset is used when valid,
 * with fallback to indexOf when offset is missing or invalid.
 */
import { describe, it, expect } from "vitest";
import { findInMarkdown } from "@/lib/diff-utils";

describe("findInMarkdown", () => {
  const markdown = [
    "# Title",
    "",
    "Some text here.",
    "",
    "```mermaid",
    "graph TD",
    "  A --> B",
    "```",
    "",
    "```mermaid",
    "graph TD",
    "  C --> D",
    "```",
    "",
    "More text.",
  ].join("\n");

  // Pre-compute offsets for the two mermaid blocks
  const firstMermaidOffset = markdown.indexOf("```mermaid\ngraph TD\n  A --> B\n```");
  const secondMermaidOffset = markdown.indexOf("```mermaid\ngraph TD\n  C --> D\n```");

  describe("with valid offset", () => {
    it("uses offset directly when it matches", () => {
      const idx = markdown.indexOf("Some text here.");
      const result = findInMarkdown(markdown, "Some text here.", idx);
      expect(result).toBe(idx);
    });

    it("uses offset for first mermaid block", () => {
      const oldStr = "```mermaid\ngraph TD\n  A --> B\n```";
      const result = findInMarkdown(markdown, oldStr, firstMermaidOffset);
      expect(result).toBe(firstMermaidOffset);
    });

    it("uses offset for second mermaid block", () => {
      const oldStr = "```mermaid\ngraph TD\n  C --> D\n```";
      const result = findInMarkdown(markdown, oldStr, secondMermaidOffset);
      expect(result).toBe(secondMermaidOffset);
    });

    it("disambiguates similar blocks using offset", () => {
      // Both blocks start with "```mermaid\ngraph TD\n" — indexOf would always find the first
      const partialMatch = "```mermaid\ngraph TD";
      const firstIdx = markdown.indexOf(partialMatch);
      const secondIdx = markdown.indexOf(partialMatch, firstIdx + 1);

      // With offset pointing to the second occurrence
      const result = findInMarkdown(markdown, partialMatch, secondIdx);
      expect(result).toBe(secondIdx);
      expect(result).not.toBe(firstIdx);
    });
  });

  describe("with invalid offset", () => {
    it("falls back to indexOf when offset is undefined", () => {
      const result = findInMarkdown(markdown, "Some text here.", undefined);
      expect(result).toBe(markdown.indexOf("Some text here."));
    });

    it("falls back to indexOf when offset is negative", () => {
      const result = findInMarkdown(markdown, "Some text here.", -1);
      expect(result).toBe(markdown.indexOf("Some text here."));
    });

    it("falls back to indexOf when offset points past end", () => {
      const result = findInMarkdown(markdown, "Some text here.", markdown.length);
      expect(result).toBe(markdown.indexOf("Some text here."));
    });

    it("falls back to indexOf when offset content doesn't match", () => {
      // Offset points to wrong location
      const result = findInMarkdown(markdown, "Some text here.", 0);
      expect(result).toBe(markdown.indexOf("Some text here."));
    });

    it("returns -1 when string not found at all", () => {
      const result = findInMarkdown(markdown, "nonexistent content", undefined);
      expect(result).toBe(-1);
    });

    it("returns -1 when offset is wrong and string not found", () => {
      const result = findInMarkdown(markdown, "nonexistent content", 5);
      expect(result).toBe(-1);
    });
  });

  describe("edge cases", () => {
    it("handles empty markdown", () => {
      const result = findInMarkdown("", "text", undefined);
      expect(result).toBe(-1);
    });

    it("handles empty oldStr", () => {
      const result = findInMarkdown(markdown, "", undefined);
      expect(result).toBe(0); // indexOf("") returns 0
    });

    it("handles offset at exact end boundary", () => {
      const md = "abcdef";
      // "ef" is at offset 4, length 2, 4+2=6=md.length — boundary case
      const result = findInMarkdown(md, "ef", 4);
      expect(result).toBe(4);
    });

    it("handles offset at 0", () => {
      const md = "hello world";
      const result = findInMarkdown(md, "hello", 0);
      expect(result).toBe(0);
    });
  });
});
