import { expect, test, type Page } from "@playwright/test";

import { activate, openPage, rows } from "./harness";

/**
 * Where the Page goes when the keyboard drives it through a Block that is not a paragraph.
 *
 * scroll-continuity.spec.ts covers the walk from row to row. These two are the cases that walk
 * *into* a Block with its own editing surface, and they fail differently: a table moves the caret
 * between cells without the row ever changing, and an equation's source panel does not exist until
 * the Block is active, so it always mounts below the fold. Both used to be answered by a bare
 * `focus()`, whose `CenterIfNeeded` alignment recentres anything entirely off screen on the port's
 * midline.
 *
 * Measured in the running app, not asserted from theory; jsdom lays nothing out, so the same
 * assertion in a unit test would pass against any code at all. The unit half of this pair —
 * "which call was made" — is src/__tests__/editor/markdown-block-focus-scroll-guard.test.tsx.
 */

async function scrollTop(page: Page): Promise<number> {
  return page.evaluate(
    () => document.querySelector<HTMLElement>("[data-native-markdown-scroll]")!.scrollTop
  );
}

test("walking down a table's cells scrolls by one row, never by half a viewport", async ({
  page,
}) => {
  const grid = [
    "| head one | head two |",
    "| - | - |",
    ...Array.from({ length: 40 }, (_, index) => `| row${index} a | row${index} b |`),
  ].join("\n");
  await openPage(page, "TableWalk", `Above.\n\n${grid}\n\nBelow.\n`);
  await activate(rows(page).nth(1), "head one");

  let previous = await scrollTop(page);
  const steps: number[] = [];
  for (let press = 0; press < 30; press += 1) {
    await page.keyboard.press("ArrowDown");
    steps.push(Math.round((await scrollTop(page)) - previous));
    previous = await scrollTop(page);
  }

  // A cell move remounts the cell editor without changing the row, so the row's own
  // `scrollIntoView` on activation never fires and the cell editor's focus() is the only thing that
  // can scroll. Measured with a bare focus(): 0 for seventeen presses, then 420, then 0 for nine
  // more, then 410 — the cell landing at top 462 on an 868px port, which is the midline. With
  // `preventScroll` and an explicit `nearest`, 41 a press for all thirty.
  const moved = steps.filter((step) => step !== 0);
  expect(moved.length).toBeGreaterThan(5);
  expect(Math.max(...moved)).toBeLessThan(60);
});

test("arrowing into an equation brings its source panel to the edge, not to the midline", async ({
  page,
}) => {
  const before = Array.from(
    { length: 22 },
    (_, index) => `Paragraph ${index} alpha bravo charlie delta.`
  ).join("\n\n");
  await openPage(page, "EquationEntry", `${before}\n\n$$\nE = mc^2\n$$\n\nAfter.\n`);
  await activate(rows(page).first(), "Paragraph 0");

  let previous = await scrollTop(page);
  let entry = -1;
  for (let press = 0; press < 40; press += 1) {
    await page.keyboard.press("ArrowDown");
    const now = await scrollTop(page);
    const kind = await page.evaluate(
      () =>
        document.querySelector<HTMLElement>('[data-native-block-row][data-active="true"]')?.dataset
          .blockKind ?? ""
    );
    if (kind === "block_math") {
      entry = Math.round(now - previous);
      break;
    }
    previous = now;
  }
  expect(entry).toBeGreaterThanOrEqual(0);

  // The panel mounts below the rendered equation in the same commit that activates the Block, so it
  // is always entirely off screen when it focuses itself. Measured with a bare focus(): 491 on an
  // 868px port — 434 of it the recentring — far enough past the equation that the next eleven
  // presses moved the Page not at all. With the pair, 171, and the row sits flush against the
  // bottom edge rather than halfway up.
  const port = await page.evaluate(
    () => document.querySelector<HTMLElement>("[data-native-markdown-scroll]")!.clientHeight
  );
  expect(entry).toBeLessThan(port / 2);
  const { rowBottom, portBottom } = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>("[data-native-markdown-scroll]")!;
    const row = document.querySelector<HTMLElement>('[data-native-block-row][data-active="true"]')!;
    return {
      rowBottom: row.getBoundingClientRect().bottom,
      portBottom: scroller.getBoundingClientRect().bottom,
    };
  });
  expect(Math.abs(rowBottom - portBottom)).toBeLessThan(8);
});
