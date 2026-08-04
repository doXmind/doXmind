import { expect, test, type Page } from "@playwright/test";

import { openPage } from "./harness";

/**
 * Sweeping the gutter must not lay the document out again, once per row.
 *
 * The gutter reveal is pure CSS — no React commit, no row render, no layout read — but taking
 * `[data-native-block-controls]` from `opacity: 0` to `1` used to make Blink build a compositing
 * layer for it, and building one runs a layout pass. The row's `contain: layout style` does not stop
 * that: containment without `size` still lets the row's own box change, so the pass walks every
 * sibling below it and its cost grows with the Page. Measured before `will-change: opacity` was
 * declared, one pointer sweep across 19 rows: 19 layouts at every size, costing 1.8ms at 20 Blocks,
 * 3.0ms at 200 and 8.6-8.8ms at 1000. A notched wheel with the pointer resting on the column is the
 * gesture that pays for it repeatedly — 100 notches at 1000 Blocks measured 100 layouts and 50.6ms,
 * against 0 and 0ms for the same gesture with the pointer off the rows.
 *
 * This is only observable in a browser: jsdom has no layout, so nothing about it can be asserted in a
 * unit test. What is asserted is the count, not a duration — the dev server inflates the latter
 * several-fold and the count is the same in both builds. The stylesheet declaration itself is pinned
 * in src/__tests__/components/editor/hover-reveal.test.ts.
 */

const PARAGRAPHS = 200;

function longPage(count = PARAGRAPHS): string {
  return (
    Array.from(
      { length: count },
      (_, index) => `Paragraph ${index} alpha bravo charlie delta.`
    ).join("\n\n") + "\n"
  );
}

/** Centres of the rows currently inside the viewport, which are the ones a pointer can cross. */
async function visibleRowCentres(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-native-block-row]")]
      .slice(0, 30)
      .map((row) => {
        const box = row.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      })
      .filter((point) => point.y > 60 && point.y < 860)
  );
}

test("a pointer sweep down the gutter costs no layout at all", async ({ page }) => {
  await openPage(page, "HoverReveal", longPage());
  await expect(page.locator("[data-native-block-row]")).toHaveCount(PARAGRAPHS);

  const centres = await visibleRowCentres(page);
  expect(centres.length).toBeGreaterThan(10);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const layoutCount = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    return metrics.find((metric) => metric.name === "LayoutCount")!.value;
  };

  // Settle on the first row first, so the sweep measures only the transitions between rows.
  await page.mouse.move(centres[0].x, centres[0].y);
  await page.waitForTimeout(250);

  const before = await layoutCount();
  for (const point of centres) await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(250);
  const forced = (await layoutCount()) - before;

  // One per hovered-row transition was the defect, and the two counts matched 1:1 in every arm. A
  // single stray layout is left as slack for an autosave or a resize observer landing in the window;
  // the defect this guards produced `centres.length - 1` of them.
  expect(forced, `${centres.length} rows crossed`).toBeLessThanOrEqual(1);

  // The reveal itself still has to work, or the assertion above is satisfied by nothing appearing.
  const lit = await page.evaluate(
    () =>
      [...document.querySelectorAll("[data-native-block-controls]")].filter(
        (el) => Number(getComputedStyle(el).opacity) > 0
      ).length
  );
  expect(lit).toBe(1);
});
