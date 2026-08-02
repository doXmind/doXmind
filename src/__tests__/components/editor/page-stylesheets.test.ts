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
    (selector.match(/\.[\w-]+/g)?.length ?? 0) +
      (selector.match(/\[[^\]]+\]/g)?.length ?? 0) +
      // A pseudo-class counts at the class level, which is the whole reason `h1:empty` still holds
      // an empty heading's line box against the `[data-editor-kind="heading"]` reset. The lookbehind
      // keeps `::before`/`::after` out — those count as types, and neither appears in a comparison.
      (selector.match(/(?<!:):[a-z][\w-]*/g)?.length ?? 0),
    withoutAttributes.match(/(^|[\s>+~])[a-z][\w-]*/g)?.length ?? 0,
  ];
}

/** The stylesheet with its comments removed, for assertions about what it no longer contains. */
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const outranks = (a: string, b: string) => specificity(a) > specificity(b);

describe("editor.css multi-Block selection band", () => {
  const editorRules = rules(readStyles("editor.css"));

  /*
   * The band is one shape, not a chip per Block.
   *
   * The fill starts below each row's lead, and the lead IS the inter-Block gap — so it was never
   * painted. A uniform 2px gap hid that behind the rule's own `-1px`; a lead that varies by kind does
   * not. Measured before the sibling rule below: heading pairs gapped 10-18px, and once containers
   * got their own lead so did callout->callout, blockquote->fenced_code and eight other pairs, at
   * 4-16px each. After it, all eleven pairs of a twelve-Block selection measure -2px, i.e. joined.
   */
  it("starts a continued selection at the row's own top edge, not below its lead", () => {
    const continued = editorRules.find(
      (rule) =>
        rule.selectors.some(
          (selector) =>
            selector.includes('[data-block-selected="true"]') &&
            selector.includes("+") &&
            selector.includes("::after")
        ) && /top:\s*-1px/.test(rule.body)
    );
    expect(
      continued,
      "a selected row following a selected row must reclaim its lead"
    ).toBeDefined();
  });

  it("keeps the first row of a selection inset by its lead", () => {
    const base = editorRules.find(
      (rule) =>
        rule.selectors.includes(".markdown-page > [data-native-block-row]::after") &&
        /top:\s*calc\(var\(--row-lead\)/.test(rule.body)
    );
    expect(base, "a selection must still begin where its first Block begins").toBeDefined();
  });
});

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

/**
 * The inter-Block rhythm.
 *
 * The gap a reader sees is between painted ink, not between row boxes, and every kind insets its own
 * ink differently — which is how one nominal 2px lead delivered 29 different gaps, from 4px between
 * two code Blocks to 48.5px between two tables. editor.css now declares the *gap* per relationship
 * and derives the lead from both neighbours' ink insets, so this suite reads those declarations back
 * and recomputes every ordered pair the way the browser will.
 */
describe("editor.css inter-Block rhythm", () => {
  const css = readStyles("editor.css");
  const editorRules = rules(css);
  const ROW = ".markdown-page > [data-native-block-row]";

  /** Declarations of one custom property, keyed by the whole selector that sets it. */
  const declarations = (property: string) =>
    editorRules.flatMap((rule) => {
      const match = rule.body.match(new RegExp(`${property}:\\s*([^;]+);`));
      return match ? rule.selectors.map((selector) => ({ selector, value: match[1].trim() })) : [];
    });

  const kindsIn = (selector: string) =>
    [...selector.matchAll(/\[data-block-kind="([a-z_]+)"\]/g)].map((match) => match[1]);

  it("leads no row that has no row above it", () => {
    // The old `:first-child` reset lost a specificity fight with the per-level heading rules and so
    // matched nothing at all — a Page opening `# Title` started 28px lower than one opening with a
    // paragraph. Writing every lead on `+` makes the exception unnecessary rather than fragile.
    expect(withoutComments(css)).not.toMatch(/:first-child/);
    for (const { selector } of declarations("--row-lead")) {
      if (/^\s*$/.test(selector)) continue;
      const setsNonZero = !/^\.markdown-page > \[data-native-block-row\]$/.test(selector);
      if (setsNonZero) expect(selector, `${selector} must be an adjacency`).toMatch(/\+/);
    }
  });

  it("derives the lead from the declared gap and both neighbours' ink", () => {
    const lead = declarations("--row-lead").find(({ selector }) => selector.includes("+"));
    expect(lead?.value.replace(/\s+/g, " ")).toBe(
      "max(0px, calc(var(--block-gap) - 2px - var(--prev-ink) - var(--own-ink)))"
    );
  });

  it("gives every kind the same ink inset whether it is above or below the neighbour", () => {
    const own = new Map<string, string>();
    for (const { selector, value } of declarations("--own-ink")) {
      for (const kind of kindsIn(selector)) own.set(kind, value);
    }
    const previous = new Map<string, string>();
    for (const { selector, value } of declarations("--prev-ink")) {
      // `A + B` styles B, so the kinds named before the combinator are the ones being described.
      const [before] = selector.split("+");
      for (const kind of kindsIn(before)) previous.set(kind, value);
    }
    expect([...own.keys()].sort()).toEqual([...previous.keys()].sort());
    for (const [kind, value] of own) {
      // The table is the one declared exception: it reserves 12px above its border for the column
      // handles that hang outside it, and 4px below.
      if (kind === "table") continue;
      expect(previous.get(kind), `${kind} ink disagrees between its two sides`).toBe(value);
    }
  });

  it("spaces a heading harder above than below, at every level", () => {
    const gaps = new Map<string, number>();
    for (const { selector, value } of declarations("--block-gap")) {
      gaps.set(selector.replace(/\s+/g, " ").trim(), Number.parseFloat(value));
    }
    const above = (level: number) =>
      [...gaps].find(([selector]) =>
        selector.endsWith(
          `+ [data-native-block-row][data-block-kind="heading"][data-block-level="${level}"]`
        )
      )?.[1];
    const below = [...gaps].find(
      ([selector]) => selector === `${ROW}[data-block-kind="heading"] + [data-native-block-row]`
    )?.[1];

    expect(above(1)).toBe(40);
    expect(above(2)).toBe(32);
    for (const level of [3, 4, 5, 6]) expect(above(level)).toBe(24);
    expect(below).toBe(16);
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(above(level)!, `h${level} must take more space above than below`).toBeGreaterThan(
        below!
      );
    }
  });

  it("lets the space above a heading out-specify the space below one", () => {
    // A heading that follows a heading starts a section rather than trailing one.
    const belowSelector = `${ROW}[data-block-kind="heading"] + [data-native-block-row]`;
    const aboveSelector = `${ROW} + [data-native-block-row][data-block-kind="heading"][data-block-level="1"]`;
    expect(outranks(aboveSelector, belowSelector)).toBe(true);
  });

  it("lands every ordered pair of kinds on the declared scale", () => {
    const base = editorRules.find((rule) => rule.selectors.includes(ROW));
    expect(base?.body).toMatch(/--block-gap:\s*20px/);

    // Ink insets, in the order the browser resolves them. Prose is 4px of padding plus half its
    // leading; at the default 1.75rem that is 8.5px.
    const ink: Record<string, { top: number; bottom: number }> = {
      paragraph: { top: 8.5, bottom: 8.5 },
      heading: { top: 5, bottom: 5 },
      container: { top: 0, bottom: 0 },
      table: { top: 12, bottom: 4 },
      thematic_break: { top: 17.5, bottom: 17.5 },
    };
    const gapFor = (next: string) => (next === "heading" ? 24 : 20);
    const delivered = (previous: string, next: string) => {
      const target = previous === "heading" && next !== "heading" ? 16 : gapFor(next);
      const lead = Math.max(0, target - 2 - ink[previous].bottom - ink[next].top);
      return +(ink[previous].bottom + 2 + lead + ink[next].top).toFixed(2);
    };

    // Every pair among the kinds that can reach their target lands on the declared scale exactly.
    const reachable = ["paragraph", "heading", "container"];
    const hit = new Set<number>();
    for (const previous of reachable) {
      for (const next of reachable) hit.add(delivered(previous, next));
    }
    expect([...hit].sort((a, b) => a - b)).toEqual([16, 20, 24]);

    // Two kinds inset their own ink by more than the gap they are owed, so they keep the floor
    // instead of going negative: a table reserves 12px above its border for the column handles that
    // hang outside it, and a divider is a 1px rule centred in a 36px click target this stylesheet
    // does not own. Their pairs are listed rather than derived, so moving any ink value has to move
    // this table deliberately.
    expect({
      "paragraph -> table": delivered("paragraph", "table"),
      "table -> paragraph": delivered("table", "paragraph"),
      "heading -> table": delivered("heading", "table"),
      "container -> table": delivered("container", "table"),
      "table -> table": delivered("table", "table"),
      "paragraph -> divider": delivered("paragraph", "thematic_break"),
      "divider -> paragraph": delivered("thematic_break", "paragraph"),
      "heading -> divider": delivered("heading", "thematic_break"),
      "container -> divider": delivered("container", "thematic_break"),
      "divider -> divider": delivered("thematic_break", "thematic_break"),
    }).toEqual({
      "paragraph -> table": 22.5,
      "table -> paragraph": 20,
      "heading -> table": 19,
      "container -> table": 20,
      "table -> table": 20,
      "paragraph -> divider": 28,
      "divider -> paragraph": 28,
      "heading -> divider": 24.5,
      "container -> divider": 20,
      "divider -> divider": 37,
    });
  });

  it("leaves outer spacing to the row and to nothing else", () => {
    const rule = editorRules.find((candidate) =>
      candidate.selectors.includes(".markdown-page [data-native-block-content] > *")
    );
    expect(rule?.body).toMatch(/margin-top:\s*0/);
    expect(rule?.body).toMatch(/margin-bottom:\s*0/);
    // The table sits one level deeper, inside its own scroll box.
    expect(rule?.selectors).toContain(".markdown-page [data-native-block-content] > * > table");
  });

  it("sizes a heading to its own line rather than to a 36px slot", () => {
    const heading = editorRules.find((rule) =>
      rule.selectors.includes('.markdown-page [data-editor-kind="heading"]')
    );
    expect(heading?.body).toMatch(/min-height:\s*0/);
    // An empty heading still holds a line box, and still out-specifies the reset above.
    const empty = editorRules.find((rule) => rule.selectors.includes(".markdown-page h1:empty"));
    expect(empty?.body).toMatch(/min-height:\s*1\.3em/);
    expect(outranks(".markdown-page h1:empty", '.markdown-page [data-editor-kind="heading"]')).toBe(
      true
    );
  });
});

describe("editor.css type", () => {
  const editorRules = rules(readStyles("editor.css"));

  it("pins one bold weight for the whole document", () => {
    // Nothing declared a weight, so the UA's `bolder` resolved against the host: 700 inside 400
    // prose and 900 inside a 600 heading or callout title — the same asterisks, two faces.
    const rule = editorRules.find(
      (candidate) =>
        candidate.selectors.includes(".markdown-page strong") &&
        candidate.selectors.includes(".markdown-page b")
    );
    expect(rule?.body).toMatch(/font-weight:\s*600/);
  });

  it("routes body leading through one variable so the Line spacing setting reaches it", () => {
    const page = editorRules.find((rule) => rule.selectors.includes(".markdown-page"));
    expect(page?.body).toMatch(/--editor-body-leading:\s*1\.75rem/);

    const compact = editorRules.find((rule) =>
      rule.selectors.includes(".editor-leading-compact .markdown-page")
    );
    const relaxed = editorRules.find((rule) =>
      rule.selectors.includes(".editor-leading-relaxed .markdown-page")
    );
    const value = (body?: string) => body?.match(/--editor-body-leading:\s*([^;]+);/)?.[1].trim();
    expect(value(compact?.body)).toBe("1.5rem");
    expect(value(relaxed?.body)).toBe("2rem");
    // Relaxed used to declare the same 1.75 the default already had, so it moved nothing at all.
    expect(value(relaxed?.body)).not.toBe("1.75rem");

    const body = editorRules.find((rule) =>
      rule.selectors.includes(
        '.markdown-page [data-native-block-row] [data-editor-kind="paragraph"]'
      )
    );
    expect(body?.body).toMatch(/line-height:\s*var\(--editor-body-leading\)\s*!important/);
  });

  it("gives a table cell the same leading as the paragraph beside it", () => {
    const cells = editorRules.find(
      (rule) =>
        rule.selectors.includes(".markdown-page th") && rule.selectors.includes(".markdown-page td")
    );
    expect(cells?.body).toMatch(/line-height:\s*var\(--editor-body-leading\)/);
  });

  it("keeps a completed to-do and a raw Block looking the same once the caret arrives", () => {
    const checked = editorRules.find((rule) =>
      rule.selectors.some((selector) => /task_list_item.*:has\(input:checked\)/.test(selector))
    );
    expect(checked?.body).toMatch(/text-decoration-line:\s*line-through/);
    expect(checked?.body).toMatch(/color:\s*hsl\(var\(--muted-foreground\)\)/);

    const raw = editorRules.find((rule) =>
      rule.selectors.some(
        (selector) =>
          selector.includes('[data-editor-kind="unsupported"]') &&
          selector.includes(".native-block-textarea")
      )
    );
    expect(raw?.body).toMatch(/color:\s*hsl\(var\(--muted-foreground\)\)/);
  });
});

describe("math-mermaid.css", () => {
  const mathRules = rules(readStyles("math-mermaid.css"));

  it("leaves the equation and diagram wrappers unspaced, so the row spaces them", () => {
    for (const selector of [
      ".markdown-page .block-math-wrapper",
      ".markdown-page .mermaid-chart-wrapper",
    ]) {
      const rule = mathRules.find((candidate) => candidate.selectors.includes(selector));
      expect(rule, selector).toBeDefined();
      expect(/@apply[^;]*\bmy-4\b/.test(rule?.body ?? ""), selector).toBe(false);
    }
  });

  it("sizes the equation and diagram source like every other source surface", () => {
    // `text-xs` in the component routes through globals.css's 13px chrome scale with `!important`,
    // which sized them at 11px/15.4px against 12px/17.4px everywhere else — and moved them with the
    // UI density slider rather than the code-font slider.
    const rule = mathRules.find((candidate) =>
      candidate.selectors.includes(".markdown-page [data-figure-source-field]")
    );
    expect(rule?.body).toMatch(/font-size:\s*var\(--ui-code-font-size-base\)\s*!important/);
    expect(rule?.body).toMatch(/line-height:\s*1\.45\s*!important/);
  });

  it("takes the diagram's label off the chrome scale", () => {
    const rule = mathRules.find((candidate) =>
      candidate.selectors.includes(".markdown-page .mermaid-chart-wrapper > figcaption")
    );
    expect(rule?.body).toMatch(/font-size:\s*0\.75rem\s*!important/);
    // The only positive tracking in the content column; every other run is normal or negative.
    expect(rule?.body).toMatch(/letter-spacing:\s*normal/);
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
