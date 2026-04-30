import { describe, expect, it } from "vitest";
import {
  POPULAR_LANGUAGE_IDS,
  SUPPORTED_LANGUAGES,
  findLanguageById,
  getLanguageDisplayName,
  getOtherLanguages,
  getPopularLanguages,
  searchLanguages,
} from "@/extensions/code-block/code-block-types";

describe("code block language helpers", () => {
  it("keeps language ids unique", () => {
    const ids = SUPPORTED_LANGUAGES.map((language) => language.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves common aliases case-insensitively", () => {
    expect(findLanguageById("JS")?.id).toBe("javascript");
    expect(findLanguageById("py")?.id).toBe("python");
    expect(getLanguageDisplayName("ts")).toBe("TypeScript");
    expect(getLanguageDisplayName(null)).toBe("Plain Text");
  });

  it("partitions popular and other languages without overlap", () => {
    const popular = getPopularLanguages();
    const others = getOtherLanguages();
    const combinedIds = new Set([...popular, ...others].map((language) => language.id));

    expect(popular.map((language) => language.id)).toEqual(POPULAR_LANGUAGE_IDS);
    expect(combinedIds.size).toBe(SUPPORTED_LANGUAGES.length);
  });

  it("searches names, ids, and aliases", () => {
    expect(searchLanguages("typescript")[0].id).toBe("typescript");
    expect(searchLanguages("py").some((language) => language.id === "python")).toBe(true);
    expect(searchLanguages("xyznonexistent")).toEqual([]);
  });
});
