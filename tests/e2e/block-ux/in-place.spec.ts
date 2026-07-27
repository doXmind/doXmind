import { expect, test, type Locator } from "@playwright/test";

import { activate, clickAway, openPage, rows, settledHeight } from "./harness";

/** A 1x1 PNG, so the image Block has a real file to render instead of a missing-asset placeholder. */
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/**
 * No Block turns into its own Markdown when you click it.
 *
 * This is the invariant the editor kept breaking. Ten of the sixteen kinds used to replace the
 * rendered Block with a textarea holding its raw source on activation, so pressing an image showed
 * `![Alt](path.png)`, a divider showed `---`, a callout showed `> [!NOTE]`, and a code Block lost
 * every colour. It was reported three times before it was understood as one decision rather than ten
 * bugs, which is exactly why it belongs in a test that covers every kind at once rather than in ten
 * separate ones that each new kind can quietly skip.
 *
 * Two assertions per kind, and both matter:
 *
 *   - the element that *is* the rendered Block is still in the DOM while the Block is active, so a
 *     future change cannot re-introduce the swap and leave the delimiters merely hidden by CSS;
 *   - none of the Markdown that the rendered form exists to hide is visible as text.
 *
 * `unsupported` is deliberately absent. A Block the editor cannot model has no rendered form to
 * show, so its raw source is not a fallback — it is the content, and showing it is correct.
 */

interface InPlaceCase {
  readonly label: string;
  readonly source: string;
  /**
   * An element that must be present whether or not the Block is being edited.
   *
   * Only for kinds whose rendered form is a distinct artefact — an `img`, a `.katex`, a `table`, a
   * highlighted `pre`. A paragraph's rendered form is its own text, and the attribute that marks it
   * sits on the editing surface too, so there is nothing here that a swap could not also satisfy.
   * Those kinds carry `hidden` alone, which is the assertion that actually guards them.
   */
  readonly rendered?: string;
  /** Markdown that must never appear as visible text, in either state. */
  readonly hidden: readonly string[];
  /** Files the Block needs in the workspace to render at all. */
  readonly assets?: Readonly<Record<string, Buffer>>;
  /**
   * A Block with no text surface anywhere in it, whose shell has to answer the keys a caret usually
   * would. Set together with `blockKind`, the value the row reports in `data-block-kind`.
   */
  readonly cellFree?: boolean;
  readonly blockKind?: string;
}

const CASES: readonly InPlaceCase[] = [
  {
    label: "image",
    source: "![A diagram](assets/diagram.png)",
    rendered: "img, [data-testid='image-block'], figure",
    hidden: ["![", "](", ".png)"],
    assets: { "assets/diagram.png": PIXEL_PNG },
    cellFree: true,
    blockKind: "image",
  },
  {
    label: "divider",
    source: "---",
    rendered: "hr, [data-testid='thematic-break-block']",
    hidden: ["---"],
    cellFree: true,
    blockKind: "thematic_break",
  },
  {
    label: "code",
    source: "```ts\nconst highlighted: number = 1;\n```",
    rendered: "pre, [data-testid='fenced-code-block']",
    hidden: ["```"],
  },
  {
    label: "equation",
    source: "$$\nE = mc^2\n$$",
    rendered: ".katex, [data-testid='rendered-math'], [data-testid='block-math']",
    hidden: ["$$"],
  },
  {
    label: "callout",
    source: "> [!NOTE]\n> Callout body text.",
    rendered: "aside, [data-testid='callout-block']",
    hidden: ["[!NOTE]", "> "],
  },
  {
    label: "toggle",
    source: "<details>\n<summary>Toggle title</summary>\n\nToggle body.\n\n</details>",
    rendered: "details, [data-testid='toggle-block']",
    hidden: ["<details>", "<summary>", "</summary>", "</details>"],
  },
  {
    label: "table",
    source: "| head | two |\n| - | - |\n| cellword | 2 |",
    rendered: "table",
    hidden: ["| head", "| - |", "|\n"],
  },

  // The text kinds. Their delimiters are a line prefix rather than a wrapper, which made them feel
  // like a different problem and left them out of this list while it was being written — but a
  // heading that shows `##` when you click it is the same bug as an image that shows `![`, and the
  // whole point of one table is that a kind cannot quietly sit outside it.
  { label: "heading 1", source: "# Heading one", hidden: ["#"] },
  { label: "heading 2", source: "## Heading two", hidden: ["#"] },
  { label: "heading 3", source: "### Heading three", hidden: ["#"] },
  { label: "heading 4", source: "#### Heading four", hidden: ["#"] },
  { label: "heading 5", source: "##### Heading five", hidden: ["#"] },
  { label: "heading 6", source: "###### Heading six", hidden: ["#"] },
  { label: "bulleted list", source: "- Bulleted item", hidden: ["- ", "-\u00a0"] },
  { label: "numbered list", source: "1. Numbered item", hidden: ["1. "] },
  { label: "to-do", source: "- [ ] Unchecked item", hidden: ["- ", "[ ]", "[x]"] },
  { label: "to-do checked", source: "- [x] Checked item", hidden: ["- ", "[ ]", "[x]"] },
  { label: "quote", source: "> Quoted text", hidden: ["> ", ">\u00a0"] },
  // An autolink's brackets are markup like any other delimiter. This Block showed clean text until
  // it was clicked, then grew a pair of angle brackets, because the row only reaches for the semantic
  // editor when the projection hides something and nothing knew autolinks existed.
  { label: "autolink", source: "Visit <https://example.com> now", hidden: ["<", ">"] },
  { label: "email autolink", source: "Mail <a@example.com> today", hidden: ["<", ">"] },
];

/** Everything the row shows a reader, with the gutter controls' own labels excluded. */
async function visibleText(row: Locator): Promise<string> {
  return row.evaluate((el) => {
    const content = el.querySelector("[data-native-block-content]") ?? el;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let text = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const owner = node.parentElement;
      if (owner?.closest("[data-native-block-controls], .sr-only, [hidden]")) continue;
      if (owner && window.getComputedStyle(owner).display === "none") continue;
      text += node.nodeValue ?? "";
    }
    return text;
  });
}

for (const testCase of CASES) {
  const rendered = testCase.rendered;
  if (rendered) {
    test(`${testCase.label}: stays rendered when it is being edited`, async ({ page }) => {
      // A lead paragraph so the Block under test is never the Page's first, where a lone `---` would
      // be frontmatter rather than a divider.
      await openPage(page, "InPlace", `Lead paragraph.\n\n${testCase.source}\n`, testCase.assets);
      const row = rows(page).nth(1);

      await clickAway(page);
      await expect(row.locator(rendered).first()).toBeAttached();

      await activate(row);
      await expect(
        row.locator(rendered).first(),
        "the rendered Block was replaced when it was activated"
      ).toBeAttached();
    });
  }

  test(`${testCase.label}: never shows its own Markdown`, async ({ page }) => {
    await openPage(page, "InPlace", `Lead paragraph.\n\n${testCase.source}\n`, testCase.assets);
    const row = rows(page).nth(1);

    await clickAway(page);
    const resting = await visibleText(row);
    for (const delimiter of testCase.hidden) {
      expect(
        resting,
        `an unfocused ${testCase.label} shows ${JSON.stringify(delimiter)}`
      ).not.toContain(delimiter);
    }

    await activate(row);
    const editing = await visibleText(row);
    for (const delimiter of testCase.hidden) {
      expect(
        editing,
        `clicking a ${testCase.label} turned it into ${JSON.stringify(delimiter)}`
      ).not.toContain(delimiter);
    }
  });

  if (testCase.cellFree) {
    test(`${testCase.label}: an arrow leaves it, in both directions`, async ({ page }) => {
      // A Block with no text surface has no caret to move first, so unless its shell answers the
      // arrow the key is simply swallowed and the only way out is the mouse. Pressing Down on a
      // divider used to leave the divider active no matter how many times it was pressed.
      await openPage(
        page,
        "InPlace",
        `Lead paragraph.\n\n${testCase.source}\n\nTail.\n`,
        testCase.assets
      );
      const activeKind = () =>
        page.evaluate(
          () =>
            document.querySelector('[data-active="true"]')?.getAttribute("data-block-kind") ?? null
        );

      await activate(rows(page).first());
      await page.keyboard.press("ArrowDown");
      expect(await activeKind(), `ArrowDown did not reach the ${testCase.label}`).toBe(
        testCase.blockKind
      );

      await page.keyboard.press("ArrowDown");
      expect(await activeKind(), `ArrowDown could not leave the ${testCase.label}`).toBe(
        "paragraph"
      );

      await page.keyboard.press("ArrowUp");
      expect(await activeKind(), `ArrowUp could not come back`).toBe(testCase.blockKind);
    });
  }

  test(`${testCase.label}: activation does not change its height`, async ({ page }) => {
    await openPage(page, "InPlace", `Lead paragraph.\n\n${testCase.source}\n`, testCase.assets);
    const row = rows(page).nth(1);

    await clickAway(page);
    // Settled, so an equation still typesetting is not mistaken for activation resizing the Block.
    const before = await settledHeight(row);
    await activate(row);
    const after = (await row.boundingBox())?.height ?? 0;

    // Anything an editing surface adds is either present in both states or out of flow. Every
    // version of this that mounted controls only while active grew the Block under the pointer.
    expect(
      Math.abs(after - before),
      `activating a ${testCase.label} changed its height`
    ).toBeLessThanOrEqual(1);
  });
}
