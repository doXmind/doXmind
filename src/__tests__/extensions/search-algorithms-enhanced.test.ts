/**
 * Tests for Search Algorithm Enhanced Features (wholeWord, useRegex)
 */
import { describe, it, expect } from "vitest";
import { getRegex } from "@/extensions/search/search-algorithms";

describe("Search Algorithms - Enhanced Features", () => {
  describe("getRegex - wholeWord option", () => {
    it("wraps pattern with word boundaries when wholeWord is true", () => {
      const regex = getRegex("test", false, true);
      expect(regex).not.toBeNull();
      expect("test".match(regex!)).toHaveLength(1);
      expect("testing".match(regex!)).toBeNull();
      expect("a test here".match(regex!)).toHaveLength(1);
    });

    it("does not use word boundaries when wholeWord is false", () => {
      const regex = getRegex("test", false, false);
      expect(regex).not.toBeNull();
      expect("testing".match(regex!)).toHaveLength(1);
      expect("contest".match(regex!)).toHaveLength(1);
    });

    it("whole word works case-insensitively by default", () => {
      const regex = getRegex("hello", false, true);
      expect("HELLO".match(regex!)).toHaveLength(1);
      expect("HELLOWORLD".match(regex!)).toBeNull();
    });

    it("whole word respects case sensitivity", () => {
      const regex = getRegex("Hello", true, true);
      expect("Hello".match(regex!)).toHaveLength(1);
      expect("hello".match(regex!)).toBeNull();
      expect("HelloWorld".match(regex!)).toBeNull();
    });

    it("whole word matches multiple occurrences", () => {
      const regex = getRegex("the", false, true);
      const matches = "the cat and the dog".match(regex!);
      expect(matches).toHaveLength(2);
    });

    it("whole word does not match partial words", () => {
      const regex = getRegex("cat", false, true);
      expect("concatenate".match(regex!)).toBeNull();
      expect("category".match(regex!)).toBeNull();
      expect("cat".match(regex!)).toHaveLength(1);
    });
  });

  describe("getRegex - useRegex option", () => {
    it("uses raw pattern without escaping when useRegex is true", () => {
      const regex = getRegex("test.*pattern", false, false, true);
      expect(regex).not.toBeNull();
      expect("test some pattern".match(regex!)).toHaveLength(1);
      expect("testXYZpattern".match(regex!)).toHaveLength(1);
    });

    it("escapes special characters when useRegex is false", () => {
      const regex = getRegex("test.*pattern", false, false, false);
      expect(regex).not.toBeNull();
      expect("test.*pattern".match(regex!)).toHaveLength(1);
      expect("test some pattern".match(regex!)).toBeNull();
    });

    it("supports capture groups in regex mode", () => {
      const regex = getRegex("(\\w+)@(\\w+)", false, false, true);
      expect(regex).not.toBeNull();
      expect("user@example".match(regex!)).not.toBeNull();
    });

    it("supports character classes in regex mode", () => {
      const regex = getRegex("[0-9]+", false, false, true);
      expect(regex).not.toBeNull();
      expect("abc123def".match(regex!)).toHaveLength(1);
      expect("no numbers here".match(regex!)).toBeNull();
    });

    it("returns null for invalid regex patterns", () => {
      const regex = getRegex("[invalid(", false, false, true);
      expect(regex).toBeNull();
    });

    it("returns null for unbalanced brackets", () => {
      const regex = getRegex("(unclosed", false, false, true);
      expect(regex).toBeNull();
    });

    it("regex mode with case sensitivity", () => {
      const regex = getRegex("[A-Z]+", true, false, true);
      expect("ABC".match(regex!)).toHaveLength(1);
      expect("abc".match(regex!)).toBeNull();
    });

    it("regex mode case insensitive", () => {
      const regex = getRegex("[A-Z]+", false, false, true);
      expect("abc".match(regex!)).toHaveLength(1);
    });
  });

  describe("getRegex - combined wholeWord and useRegex", () => {
    it("combines word boundaries with regex pattern", () => {
      const regex = getRegex("\\d+", false, true, true);
      expect(regex).not.toBeNull();
      // "123" as a standalone word
      expect("item 123 here".match(regex!)).toHaveLength(1);
    });

    it("empty search term still returns null", () => {
      expect(getRegex("", false, true, true)).toBeNull();
      expect(getRegex("   ", false, true, true)).toBeNull();
    });
  });
});
