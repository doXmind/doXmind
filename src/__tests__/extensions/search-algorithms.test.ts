/**
 * Tests for Search Algorithm Functions
 */
import { describe, it, expect } from "vitest";
import { escapeRegExp, getRegex } from "@/extensions/search/search-algorithms";

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
      expect(escapeRegExp(".*+?^${}()|[]\\")).toBe("\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\");
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
});
