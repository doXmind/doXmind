/**
 * Tests for Search Algorithm Functions
 */
import { describe, it, expect } from "vitest";
import {
  escapeRegExp,
  getRegex,
  dedupeRanges,
} from "@/extensions/search/search-algorithms";

describe("Search Algorithms", () => {
  describe("escapeRegExp", () => {
    it("escapes special regex characters", () => {
      expect(escapeRegExp("hello.world")).toBe("hello\\.world");
      expect(escapeRegExp("test*pattern")).toBe("test\\*pattern");
      expect(escapeRegExp("a+b")).toBe("a\\+b");
      expect(escapeRegExp("what?")).toBe("what\\?");
    });

    it("escapes brackets and braces", () => {
      expect(escapeRegExp("[test]")).toBe("\\[test\\]");
      expect(escapeRegExp("{test}")).toBe("\\{test\\}");
      expect(escapeRegExp("(test)")).toBe("\\(test\\)");
    });

    it("escapes caret and dollar", () => {
      expect(escapeRegExp("^start")).toBe("\\^start");
      expect(escapeRegExp("end$")).toBe("end\\$");
    });

    it("escapes pipe and backslash", () => {
      expect(escapeRegExp("a|b")).toBe("a\\|b");
      expect(escapeRegExp("path\\to")).toBe("path\\\\to");
    });

    it("handles empty string", () => {
      expect(escapeRegExp("")).toBe("");
    });

    it("returns unchanged for normal text", () => {
      expect(escapeRegExp("hello world")).toBe("hello world");
      expect(escapeRegExp("regular text 123")).toBe("regular text 123");
    });

    it("escapes multiple special characters", () => {
      expect(escapeRegExp(".*+?^${}()|[]\\")).toBe(
        "\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\"
      );
    });
  });

  describe("getRegex", () => {
    it("returns case insensitive regex by default", () => {
      const regex = getRegex("test", false);
      expect(regex).toBeInstanceOf(RegExp);
      expect(regex?.flags).toContain("g");
      expect(regex?.flags).toContain("i");
    });

    it("returns case sensitive regex when specified", () => {
      const regex = getRegex("test", true);
      expect(regex).toBeInstanceOf(RegExp);
      expect(regex?.flags).toContain("g");
      expect(regex?.flags).not.toContain("i");
    });

    it("returns null for empty search term", () => {
      expect(getRegex("", false)).toBeNull();
      expect(getRegex("   ", false)).toBeNull();
    });

    it("escapes special characters in search term", () => {
      const regex = getRegex("test.pattern", false);
      expect(regex).not.toBeNull();
      expect("test.pattern".match(regex!)).toHaveLength(1);
      expect("testXpattern".match(regex!)).toBeNull();
    });

    it("matches globally", () => {
      const regex = getRegex("a", false);
      const matches = "aaa".match(regex!);
      expect(matches).toHaveLength(3);
    });

    it("handles case sensitivity correctly", () => {
      const caseInsensitive = getRegex("hello", false);
      const caseSensitive = getRegex("hello", true);

      expect("HELLO".match(caseInsensitive!)).toHaveLength(1);
      expect("HELLO".match(caseSensitive!)).toBeNull();
      expect("hello".match(caseSensitive!)).toHaveLength(1);
    });
  });

  describe("dedupeRanges", () => {
    it("returns empty array for empty input", () => {
      expect(dedupeRanges([])).toEqual([]);
    });

    it("returns single range unchanged", () => {
      const ranges = [{ from: 0, to: 10, score: 0.9 }];
      expect(dedupeRanges(ranges)).toEqual(ranges);
    });

    it("removes overlapping ranges, keeping higher scores", () => {
      const ranges = [
        { from: 0, to: 10, score: 0.5 },
        { from: 5, to: 15, score: 0.9 },
      ];
      const result = dedupeRanges(ranges);
      expect(result).toHaveLength(1);
      expect(result[0].score).toBe(0.9);
    });

    it("keeps non-overlapping ranges", () => {
      const ranges = [
        { from: 0, to: 10, score: 0.5 },
        { from: 10, to: 20, score: 0.6 },
        { from: 20, to: 30, score: 0.7 },
      ];
      const result = dedupeRanges(ranges);
      expect(result).toHaveLength(3);
    });

    it("sorts result by position", () => {
      const ranges = [
        { from: 20, to: 30, score: 0.9 },
        { from: 0, to: 10, score: 0.8 },
        { from: 10, to: 20, score: 0.7 },
      ];
      const result = dedupeRanges(ranges);
      expect(result.map((r) => r.from)).toEqual([0, 10, 20]);
    });

    it("handles adjacent but non-overlapping ranges", () => {
      const ranges = [
        { from: 0, to: 10, score: 0.5 },
        { from: 10, to: 20, score: 0.6 },
      ];
      const result = dedupeRanges(ranges);
      expect(result).toHaveLength(2);
    });

    it("handles fully contained ranges", () => {
      const ranges = [
        { from: 0, to: 100, score: 0.8 },
        { from: 20, to: 30, score: 0.9 },
      ];
      const result = dedupeRanges(ranges);
      // Higher score wins, so inner range is kept
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ from: 20, to: 30, score: 0.9 });
    });

    it("handles multiple overlapping ranges with different scores", () => {
      const ranges = [
        { from: 0, to: 10, score: 0.3 },
        { from: 5, to: 15, score: 0.9 },
        { from: 10, to: 20, score: 0.5 },
        { from: 25, to: 35, score: 0.7 },
      ];
      const result = dedupeRanges(ranges);
      // 5-15 wins (highest score), then 25-35 (no overlap)
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ from: 5, to: 15, score: 0.9 });
      expect(result[1]).toEqual({ from: 25, to: 35, score: 0.7 });
    });

    it("preserves ranges with same score but no overlap", () => {
      const ranges = [
        { from: 0, to: 10, score: 0.5 },
        { from: 20, to: 30, score: 0.5 },
      ];
      const result = dedupeRanges(ranges);
      expect(result).toHaveLength(2);
    });
  });
});
