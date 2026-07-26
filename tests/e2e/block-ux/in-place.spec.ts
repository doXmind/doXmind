import { expect, test, type Locator } from "@playwright/test";

import { activate, clickAway, openPage, rows } from "./harness";

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
  /** An element that must be present whether or not the Block is being edited. */
  readonly rendered: string;
  /** Markdown that must never appear as visible text, in either state. */
  readonly hidden: readonly string[];
  /** Files the Block needs in the workspace to render at all. */
  readonly assets?: Readonly<Record<string, Buffer>>;
}

const CASES: readonly InPlaceCase[] = [
  {
    label: "image",
    source: "![A diagram](assets/diagram.png)",
    rendered: "img, [data-testid='image-block'], figure",
    hidden: ["![", "](", ".png)"],
    assets: { "assets/diagram.png": PIXEL_PNG },
  },
  {
    label: "divider",
    source: "---",
    rendered: "hr, [data-testid='thematic-break-block']",
    hidden: ["---"],
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
  test(`${testCase.label}: stays rendered when it is being edited`, async ({ page }) => {
    // A lead paragraph so the Block under test is never the Page's first, where a lone `---` would
    // be frontmatter rather than a divider.
    await openPage(page, "InPlace", `Lead paragraph.\n\n${testCase.source}\n`, testCase.assets);
    const row = rows(page).nth(1);

    await clickAway(page);
    await expect(row.locator(testCase.rendered).first()).toBeAttached();

    await activate(row);
    await expect(
      row.locator(testCase.rendered).first(),
      "the rendered Block was replaced when it was activated"
    ).toBeAttached();
  });

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

  test(`${testCase.label}: activation does not change its height`, async ({ page }) => {
    await openPage(page, "InPlace", `Lead paragraph.\n\n${testCase.source}\n`, testCase.assets);
    const row = rows(page).nth(1);

    await clickAway(page);
    const before = await row.boundingBox();
    await activate(row);
    const after = await row.boundingBox();

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    // Anything an editing surface adds is either present in both states or out of flow. Every
    // version of this that mounted controls only while active grew the Block under the pointer.
    expect(
      Math.abs((after?.height ?? 0) - (before?.height ?? 0)),
      `activating a ${testCase.label} changed its height`
    ).toBeLessThanOrEqual(1);
  });
}
