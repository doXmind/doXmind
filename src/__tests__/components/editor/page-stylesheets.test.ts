import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Two Page-rendering bugs lived purely in the cascade, where no jsdom render can see them: table
 * alignment lost a specificity fight inside editor.css, and a collapsed toggle printed without its
 * body because the export stylesheet fought the wrong element. Both fixes are stylesheet rules, so
 * they are pinned here by reading the stylesheets.
 */

const readStyles = (name: string) =>
  readFileSync(join(process.cwd(), "src/app/styles", name), "utf8");

type Rule = { selectors: string[]; body: string };

/** Flat rule scan. Nested at-rule bodies still yield their inner rules, which is all we need. */
function rules(css: string): Rule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1]
      .split(",")
      .map((selector) => selector.trim())
      .filter(Boolean),
    body: match[2],
  }));
}

/** Specificity of the simple selectors these stylesheets use, as [ids, classes, types]. */
function specificity(selector: string): [number, number, number] {
  const withoutAttributes = selector.replace(/\[[^\]]+\]/g, "");
  return [
    selector.match(/#[\w-]+/g)?.length ?? 0,
    (selector.match(/\.[\w-]+/g)?.length ?? 0) + (selector.match(/\[[^\]]+\]/g)?.length ?? 0),
    withoutAttributes.match(/(^|[\s>+~])[a-z][\w-]*/g)?.length ?? 0,
  ];
}

const outranks = (a: string, b: string) => specificity(a) > specificity(b);

describe("editor.css table alignment", () => {
  const editorRules = rules(readStyles("editor.css"));

  it("keeps left as the cell default, without @apply", () => {
    const base = editorRules.find(
      (rule) =>
        rule.selectors.includes(".markdown-page th") &&
        rule.selectors.includes(".markdown-page td") &&
        /text-align:\s*left\b/.test(rule.body)
    );
    expect(base).toBeDefined();
    // Written out rather than applied: the alignment overrides below carry `.text-left` in their
    // own selectors, and Tailwind reads applying that utility here as a circular definition and
    // fails the whole stylesheet to compile — which blanks the app, not just the table.
    expect(/@apply[^;]*\btext-left\b/.test(base?.body ?? "")).toBe(false);
  });

  it.each([
    ["left", "text-left"],
    ["center", "text-center"],
    ["right", "text-right"],
  ])("lets an explicit %s alignment out-specify that default", (alignment, utility) => {
    for (const signal of [`.${utility}`, `[data-align="${alignment}"]`]) {
      for (const cell of ["th", "td"]) {
        const wanted = `.markdown-page ${cell}${signal}`;
        const rule = editorRules.find(
          (candidate) =>
            candidate.selectors.includes(wanted) &&
            new RegExp(`text-align:\\s*${alignment}\\b`).test(candidate.body)
        );
        expect(rule, `missing rule for ${wanted}`).toBeDefined();
        expect(outranks(wanted, `.markdown-page ${cell}`)).toBe(true);
      }
    }
  });
});

describe("print.css collapsed toggles", () => {
  const printCss = readStyles("print.css");

  it("un-hides the closed <details> subtree so its body reaches the PDF", () => {
    const rule = rules(printCss).find((candidate) =>
      candidate.selectors.includes("details::details-content")
    );
    expect(rule).toBeDefined();
    expect(rule?.body).toMatch(/content-visibility:\s*visible\s*!important/);
  });

  it("still forces the toggle body itself visible for older engines", () => {
    const rule = rules(printCss).find((candidate) =>
      candidate.selectors.includes("[data-native-toggle-content]")
    );
    expect(rule?.body).toMatch(/display:\s*block\s*!important/);
  });
});
