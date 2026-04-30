import { describe, expect, it } from "vitest";
import { MATH_SYMBOLS, SYMBOL_CATEGORIES } from "@/extensions/math/math-types";

describe("math symbol definitions", () => {
  it("keeps categories and symbols internally consistent", () => {
    const categories = new Set(SYMBOL_CATEGORIES.map((category) => category.id));

    expect(categories.size).toBe(SYMBOL_CATEGORIES.length);
    for (const symbol of MATH_SYMBOLS) {
      expect(symbol.id).toBeTruthy();
      expect(symbol.name).toBeTruthy();
      expect(symbol.latex).toBeTruthy();
      expect(categories.has(symbol.category)).toBe(true);
    }
  });

  it("keeps symbol ids unique", () => {
    const ids = MATH_SYMBOLS.map((symbol) => symbol.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes representative picker entries", () => {
    expect(MATH_SYMBOLS.find((symbol) => symbol.id === "frac")?.latex).toContain("\\frac");
    expect(MATH_SYMBOLS.find((symbol) => symbol.id === "alpha")?.latex).toBe("\\alpha");
    expect(MATH_SYMBOLS.find((symbol) => symbol.id === "matrix")?.latex).toContain(
      "\\begin{pmatrix}"
    );
  });
});
