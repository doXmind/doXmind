import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Two reveals that answer a pointer, and what each one is allowed to cost.
 *
 * Both live purely in the cascade, so no jsdom render can see either: one is a compositing hint and
 * the other is a duration. The behavioural half of the first — that a pointer sweep down the gutter
 * forces no layout — is in tests/e2e/block-ux/hover-reveal-cost.spec.ts, because jsdom lays nothing
 * out and so would pass against any stylesheet at all.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

type Rule = { selectors: string[]; body: string };

/** Flat rule scan, with comments stripped so a quoted value cannot satisfy an assertion. */
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

describe("editor.css gutter reveal cost", () => {
  const editorRules = rules(read("src/app/styles/editor.css"));

  it("declares the gutter's opacity change up front, so revealing it lays out nothing", () => {
    // `opacity: 0` -> `1` made Blink build a compositing layer on the spot, and building one runs a
    // layout pass. `contain: layout style` on the row does not stop it — containment without `size`
    // still lets the row's own box change, so the pass walks every sibling below. Measured on a
    // pointer sweep across 19 rows: 19 layouts at every Page size, at 1.8ms / 3.0ms / 8.6-8.8ms for
    // 20 / 200 / 1000 Blocks, and 100 layouts costing 50.6ms for 100 wheel notches at 1000 Blocks.
    // Declaring the layer removes the invalidation instead of making it cheaper: 0 layouts, 0ms.
    const rest = editorRules.find((rule) =>
      rule.selectors.includes(".markdown-page [data-native-block-controls]")
    );
    expect(rest?.body).toMatch(/will-change:\s*opacity/);
    // On the resting state, not on the hovered one. A hint that arrives with the change it is
    // hinting at is the layout it was meant to avoid.
    const revealed = editorRules.find((rule) =>
      rule.selectors.includes(
        ".markdown-page [data-native-block-row]:hover [data-native-block-controls]"
      )
    );
    expect(revealed?.body).not.toMatch(/will-change/);
  });

  it("keeps the reveal itself to opacity, which is the only thing promoted", () => {
    // The layer is worth its memory only while the transition it serves is the whole reveal: a
    // second animated property would need layout again and the hint would be a lie. Measured on a
    // 360-row mixed Page, promotion changed no row's height, no gutter lead and no scroll height.
    const rest = editorRules.find((rule) =>
      rule.selectors.includes(".markdown-page [data-native-block-controls]")
    );
    expect(rest?.body).toMatch(/transition:\s*opacity 110ms ease-out 90ms/);
  });
});

describe("globals.css auto-hiding scrollbar", () => {
  const globalRules = rules(read("src/app/globals.css"));

  /*
   * A code Block wears `.autohide-scrollbar`, so this reveal is inside the content column rather
   * than on chrome, and it was running at 300ms — 15x the 20ms every control in editor.css's
   * interaction-state table uses, and docs/BLOCK_UX_REFERENCE.md is explicit that hover is
   * effectively instant and only menus animate. Measured on a code Block with the pointer arriving,
   * the thumb was under half its final alpha at 133ms and did not settle until 287ms; after, it
   * settles in the first frame after the pointer lands.
   */
  it.each([
    [".autohide-scrollbar", /transition:\s*scrollbar-color\s+20ms/],
    [".autohide-scrollbar::-webkit-scrollbar-thumb", /transition:\s*background-color\s+20ms/],
  ])("reveals %s at the shared 20ms, not at 300ms", (selector, expected) => {
    const rule = globalRules.find((candidate) => candidate.selectors.includes(selector));
    expect(rule, `no rule for ${selector}`).toBeDefined();
    expect(rule?.body).toMatch(expected);
    expect(rule?.body).not.toMatch(/0\.3s|300ms/);
  });
});
