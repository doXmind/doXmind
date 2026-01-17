/**
 * Tests for Math Extension Types and Symbol Definitions
 */
import { describe, it, expect } from "vitest";
import {
  MATH_SYMBOLS,
  SYMBOL_CATEGORIES,
  type MathSymbol,
} from "@/extensions/math/math-types";

describe("Math Types", () => {
  describe("MATH_SYMBOLS", () => {
    it("contains common math symbols", () => {
      const commonSymbols = MATH_SYMBOLS.filter((s) => s.category === "common");
      expect(commonSymbols.length).toBeGreaterThan(0);

      const symbolIds = commonSymbols.map((s) => s.id);
      expect(symbolIds).toContain("frac");
      expect(symbolIds).toContain("sqrt");
      expect(symbolIds).toContain("sum");
      expect(symbolIds).toContain("int");
    });

    it("contains Greek letters", () => {
      const greekSymbols = MATH_SYMBOLS.filter((s) => s.category === "greek");
      expect(greekSymbols.length).toBeGreaterThan(0);

      const symbolIds = greekSymbols.map((s) => s.id);
      expect(symbolIds).toContain("alpha");
      expect(symbolIds).toContain("beta");
      expect(symbolIds).toContain("pi");
      expect(symbolIds).toContain("omega");
    });

    it("contains uppercase Greek letters", () => {
      const greekSymbols = MATH_SYMBOLS.filter((s) => s.category === "greek");
      const symbolIds = greekSymbols.map((s) => s.id);

      expect(symbolIds).toContain("Gamma");
      expect(symbolIds).toContain("Delta");
      expect(symbolIds).toContain("Omega");
    });

    it("contains operators", () => {
      const operators = MATH_SYMBOLS.filter((s) => s.category === "operators");
      expect(operators.length).toBeGreaterThan(0);

      const symbolIds = operators.map((s) => s.id);
      expect(symbolIds).toContain("times");
      expect(symbolIds).toContain("div");
      expect(symbolIds).toContain("pm");
    });

    it("contains relations", () => {
      const relations = MATH_SYMBOLS.filter((s) => s.category === "relations");
      expect(relations.length).toBeGreaterThan(0);

      const symbolIds = relations.map((s) => s.id);
      expect(symbolIds).toContain("eq");
      expect(symbolIds).toContain("neq");
      expect(symbolIds).toContain("leq");
      expect(symbolIds).toContain("geq");
    });

    it("contains arrows", () => {
      const arrows = MATH_SYMBOLS.filter((s) => s.category === "arrows");
      expect(arrows.length).toBeGreaterThan(0);

      const symbolIds = arrows.map((s) => s.id);
      expect(symbolIds).toContain("to");
      expect(symbolIds).toContain("Rightarrow");
    });

    it("contains structures", () => {
      const structures = MATH_SYMBOLS.filter((s) => s.category === "structures");
      expect(structures.length).toBeGreaterThan(0);

      const symbolIds = structures.map((s) => s.id);
      expect(symbolIds).toContain("matrix");
      expect(symbolIds).toContain("vec");
    });

    it("each symbol has required fields", () => {
      MATH_SYMBOLS.forEach((symbol) => {
        expect(symbol.id).toBeTruthy();
        expect(symbol.name).toBeTruthy();
        expect(symbol.latex).toBeTruthy();
        expect(symbol.category).toBeTruthy();
      });
    });

    it("has unique IDs", () => {
      const ids = MATH_SYMBOLS.map((s) => s.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("each symbol has valid category", () => {
      const validCategories = SYMBOL_CATEGORIES.map((c) => c.id);
      MATH_SYMBOLS.forEach((symbol) => {
        expect(validCategories).toContain(symbol.category);
      });
    });

    it("common symbols have proper LaTeX syntax", () => {
      const frac = MATH_SYMBOLS.find((s) => s.id === "frac");
      expect(frac?.latex).toContain("\\frac");

      const sqrt = MATH_SYMBOLS.find((s) => s.id === "sqrt");
      expect(sqrt?.latex).toContain("\\sqrt");

      const sum = MATH_SYMBOLS.find((s) => s.id === "sum");
      expect(sum?.latex).toContain("\\sum");
    });

    it("Greek symbols have backslash notation", () => {
      const greekSymbols = MATH_SYMBOLS.filter((s) => s.category === "greek");
      greekSymbols.forEach((symbol) => {
        expect(symbol.latex).toContain("\\");
      });
    });

    it("structure symbols have proper LaTeX bracket notation", () => {
      const matrix = MATH_SYMBOLS.find((s) => s.id === "matrix");
      expect(matrix?.latex).toContain("\\begin{pmatrix}");
      expect(matrix?.latex).toContain("\\end{pmatrix}");
    });
  });

  describe("SYMBOL_CATEGORIES", () => {
    it("contains all expected categories", () => {
      const categoryIds = SYMBOL_CATEGORIES.map((c) => c.id);
      expect(categoryIds).toContain("common");
      expect(categoryIds).toContain("greek");
      expect(categoryIds).toContain("operators");
      expect(categoryIds).toContain("relations");
      expect(categoryIds).toContain("arrows");
      expect(categoryIds).toContain("structures");
    });

    it("has 6 categories", () => {
      expect(SYMBOL_CATEGORIES.length).toBe(6);
    });

    it("each category has id and name", () => {
      SYMBOL_CATEGORIES.forEach((category) => {
        expect(category.id).toBeTruthy();
        expect(category.name).toBeTruthy();
      });
    });

    it("has unique category IDs", () => {
      const ids = SYMBOL_CATEGORIES.map((c) => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("category names are human readable", () => {
      const names = SYMBOL_CATEGORIES.map((c) => c.name);
      expect(names).toContain("Common");
      expect(names).toContain("Greek");
      expect(names).toContain("Operators");
    });
  });

  describe("Symbol Coverage", () => {
    it("covers all symbol categories", () => {
      const usedCategories = new Set(MATH_SYMBOLS.map((s) => s.category));
      const definedCategories = new Set(SYMBOL_CATEGORIES.map((c) => c.id));

      definedCategories.forEach((category) => {
        expect(usedCategories.has(category)).toBe(true);
      });
    });

    it("has symbols for basic arithmetic", () => {
      const symbolLatex = MATH_SYMBOLS.map((s) => s.latex);
      expect(symbolLatex).toContain("+");
      expect(symbolLatex).toContain("-");
      expect(symbolLatex).toContain("\\times");
      expect(symbolLatex).toContain("\\div");
    });

    it("has symbols for calculus", () => {
      const symbolIds = MATH_SYMBOLS.map((s) => s.id);
      expect(symbolIds).toContain("int"); // integral
      expect(symbolIds).toContain("lim"); // limit
      expect(symbolIds).toContain("partial"); // partial derivative
      expect(symbolIds).toContain("nabla"); // gradient
    });

    it("has symbols for set theory", () => {
      const symbolIds = MATH_SYMBOLS.map((s) => s.id);
      expect(symbolIds).toContain("in");
      expect(symbolIds).toContain("notin");
      expect(symbolIds).toContain("subset");
      expect(symbolIds).toContain("subseteq");
    });
  });

  describe("MathSymbol Type", () => {
    it("can create valid MathSymbol object", () => {
      const symbol: MathSymbol = {
        id: "test",
        name: "Test Symbol",
        latex: "\\test",
        category: "common",
      };

      expect(symbol.id).toBe("test");
      expect(symbol.name).toBe("Test Symbol");
      expect(symbol.latex).toBe("\\test");
      expect(symbol.category).toBe("common");
    });

    it("category is limited to valid values", () => {
      const validCategories = ["common", "greek", "operators", "relations", "arrows", "structures"];
      MATH_SYMBOLS.forEach((symbol) => {
        expect(validCategories).toContain(symbol.category);
      });
    });
  });
});
