/**
 * Tests for Code Block Types and Language Utilities
 */
import { describe, it, expect } from "vitest";
import {
  SUPPORTED_LANGUAGES,
  POPULAR_LANGUAGE_IDS,
  findLanguageById,
  getLanguageDisplayName,
  getPopularLanguages,
  getOtherLanguages,
  searchLanguages,
} from "@/extensions/code-block/code-block-types";

describe("Code Block Types", () => {
  describe("SUPPORTED_LANGUAGES", () => {
    it("contains expected popular languages", () => {
      const languageIds = SUPPORTED_LANGUAGES.map((lang) => lang.id);
      expect(languageIds).toContain("javascript");
      expect(languageIds).toContain("typescript");
      expect(languageIds).toContain("python");
      expect(languageIds).toContain("java");
    });

    it("contains web languages", () => {
      const languageIds = SUPPORTED_LANGUAGES.map((lang) => lang.id);
      expect(languageIds).toContain("html");
      expect(languageIds).toContain("css");
      expect(languageIds).toContain("json");
      expect(languageIds).toContain("xml");
    });

    it("contains shell languages", () => {
      const languageIds = SUPPORTED_LANGUAGES.map((lang) => lang.id);
      expect(languageIds).toContain("bash");
      expect(languageIds).toContain("powershell");
    });

    it("has unique IDs", () => {
      const ids = SUPPORTED_LANGUAGES.map((lang) => lang.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("each language has id and name", () => {
      SUPPORTED_LANGUAGES.forEach((lang) => {
        expect(lang.id).toBeTruthy();
        expect(lang.name).toBeTruthy();
      });
    });
  });

  describe("findLanguageById", () => {
    it("finds language by exact ID", () => {
      const lang = findLanguageById("javascript");
      expect(lang).toBeDefined();
      expect(lang?.name).toBe("JavaScript");
    });

    it("finds language by alias", () => {
      const lang = findLanguageById("js");
      expect(lang).toBeDefined();
      expect(lang?.id).toBe("javascript");
    });

    it("finds language by alias (case insensitive)", () => {
      const lang = findLanguageById("JS");
      expect(lang).toBeDefined();
      expect(lang?.id).toBe("javascript");
    });

    it("returns undefined for unknown language", () => {
      const lang = findLanguageById("unknown-lang");
      expect(lang).toBeUndefined();
    });

    it("finds Python by py alias", () => {
      const lang = findLanguageById("py");
      expect(lang?.id).toBe("python");
    });

    it("finds TypeScript by ts alias", () => {
      const lang = findLanguageById("ts");
      expect(lang?.id).toBe("typescript");
    });

    it("finds C# by cs alias", () => {
      const lang = findLanguageById("cs");
      expect(lang?.id).toBe("csharp");
    });

    it("finds Bash by shell alias", () => {
      const lang = findLanguageById("shell");
      expect(lang?.id).toBe("bash");
    });

    it("finds YAML by yml alias", () => {
      const lang = findLanguageById("yml");
      expect(lang?.id).toBe("yaml");
    });
  });

  describe("getLanguageDisplayName", () => {
    it("returns display name for valid language", () => {
      expect(getLanguageDisplayName("javascript")).toBe("JavaScript");
      expect(getLanguageDisplayName("python")).toBe("Python");
      expect(getLanguageDisplayName("typescript")).toBe("TypeScript");
    });

    it("returns display name for alias", () => {
      expect(getLanguageDisplayName("js")).toBe("JavaScript");
      expect(getLanguageDisplayName("py")).toBe("Python");
    });

    it("returns Plain Text for null", () => {
      expect(getLanguageDisplayName(null)).toBe("Plain Text");
    });

    it("returns Plain Text for undefined", () => {
      expect(getLanguageDisplayName(undefined)).toBe("Plain Text");
    });

    it("returns Plain Text for empty string", () => {
      expect(getLanguageDisplayName("")).toBe("Plain Text");
    });

    it("returns original ID for unknown language", () => {
      expect(getLanguageDisplayName("unknown")).toBe("unknown");
    });
  });

  describe("getPopularLanguages", () => {
    it("returns popular languages only", () => {
      const popular = getPopularLanguages();
      const popularIds = popular.map((lang) => lang.id);

      expect(popularIds).toContain("javascript");
      expect(popularIds).toContain("typescript");
      expect(popularIds).toContain("python");
    });

    it("has same length as POPULAR_LANGUAGE_IDS", () => {
      const popular = getPopularLanguages();
      expect(popular.length).toBe(POPULAR_LANGUAGE_IDS.length);
    });

    it("does not include non-popular languages", () => {
      const popular = getPopularLanguages();
      const popularIds = popular.map((lang) => lang.id);

      expect(popularIds).not.toContain("rust");
      expect(popularIds).not.toContain("go");
      expect(popularIds).not.toContain("ruby");
    });
  });

  describe("getOtherLanguages", () => {
    it("returns non-popular languages", () => {
      const others = getOtherLanguages();
      const otherIds = others.map((lang) => lang.id);

      expect(otherIds).toContain("rust");
      expect(otherIds).toContain("go");
      expect(otherIds).toContain("ruby");
    });

    it("does not include popular languages", () => {
      const others = getOtherLanguages();
      const otherIds = others.map((lang) => lang.id);

      expect(otherIds).not.toContain("javascript");
      expect(otherIds).not.toContain("python");
    });

    it("combined with popular equals all languages", () => {
      const popular = getPopularLanguages();
      const others = getOtherLanguages();

      expect(popular.length + others.length).toBe(SUPPORTED_LANGUAGES.length);
    });
  });

  describe("searchLanguages", () => {
    it("returns all languages for empty query", () => {
      const results = searchLanguages("");
      expect(results.length).toBe(SUPPORTED_LANGUAGES.length);
    });

    it("returns all languages for whitespace query", () => {
      const results = searchLanguages("   ");
      expect(results.length).toBe(SUPPORTED_LANGUAGES.length);
    });

    it("finds language by name", () => {
      const results = searchLanguages("JavaScript");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe("javascript");
    });

    it("finds language by partial name", () => {
      const results = searchLanguages("Java");
      expect(results.length).toBeGreaterThan(0);
      const ids = results.map((r) => r.id);
      expect(ids).toContain("javascript");
      expect(ids).toContain("java");
    });

    it("finds language by id", () => {
      const results = searchLanguages("typescript");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe("typescript");
    });

    it("finds language by alias", () => {
      const results = searchLanguages("py");
      expect(results.length).toBeGreaterThan(0);
      const ids = results.map((r) => r.id);
      expect(ids).toContain("python");
    });

    it("is case insensitive", () => {
      const resultsLower = searchLanguages("python");
      const resultsUpper = searchLanguages("PYTHON");
      const resultsMixed = searchLanguages("PyThOn");

      expect(resultsLower.length).toBe(resultsUpper.length);
      expect(resultsLower.length).toBe(resultsMixed.length);
    });

    it("returns empty array for no matches", () => {
      const results = searchLanguages("xyznonexistent");
      expect(results.length).toBe(0);
    });

    it("finds multiple matches", () => {
      const results = searchLanguages("script");
      const ids = results.map((r) => r.id);
      expect(ids).toContain("javascript");
      expect(ids).toContain("typescript");
    });

    it("finds C languages", () => {
      const results = searchLanguages("c");
      const ids = results.map((r) => r.id);
      expect(ids).toContain("c");
      expect(ids).toContain("cpp");
      expect(ids).toContain("csharp");
    });
  });
});
