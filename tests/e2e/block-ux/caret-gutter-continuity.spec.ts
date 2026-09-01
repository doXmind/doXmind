/**
 * The gutter must not trail the caret.
 *
 * `docs/BLOCK_UX_REFERENCE.md`: "Neither product animates anything anchored to the caret — a menu or
 * toolbar that eases into position reads as lag." The gutter controls are anchored to the caret via
 * `:focus-within`, and their rest state is `transition: opacity 110ms ease-out 90ms`.
 *
 * The kill switch that cancels that fade for rows the user has left was gated on
 * `.markdown-page:hover`, so it only ever saw the pointer. Pressing ArrowDown with the mouse away
 * from the Page lit the new row instantly and left the old one ramping down for 200ms behind it.
 * These assert on computed timing rather than on a sampled opacity, because a 200ms ramp read at a
 * wall-clock offset is a race and this is not.
 */

import { test, expect } from "@playwright/test";
import { openPage, rows, activate } from "./harness";

const SOURCE = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n";

/** The controls' computed transition timing for a row, read from the live cascade. */
async function controlsTiming(row: import("@playwright/test").Locator) {
  return row.locator("[data-native-block-controls]").evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      duration: cs.transitionDuration,
      delay: cs.transitionDelay,
      opacity: cs.opacity,
    };
  });
}

test("a row the caret has left drops its controls in the same frame, with no pointer involved", async ({
  page,
}) => {
  await openPage(page, "CaretGutter", SOURCE);

  // Activate first — `activate` clicks, which parks the pointer over the Page — and only then move
  // it away. Doing it in the other order leaves `.markdown-page:hover` true, the pointer-side kill
  // switch handles everything, and this test passes with or without the rule it exists to pin.
  await activate(rows(page).first());
  await expect(rows(page).first()).toHaveAttribute("data-active", "true");
  await page.mouse.move(2, 2);
  await expect
    .poll(() => page.evaluate(() => !!document.querySelector(".markdown-page:hover")))
    .toBe(false);

  const focused = await controlsTiming(rows(page).first());
  expect(focused.opacity).toBe("1");
  expect(focused.duration).toBe("0s");

  // Every row the caret is not in is off, and off *now* — not over the next 200ms.
  for (const index of [1, 2]) {
    const timing = await controlsTiming(rows(page).nth(index));
    expect(timing.opacity).toBe("0");
    expect(timing.duration).toBe("0s");
    expect(timing.delay).toBe("0s");
  }

  // And the row the caret actually leaves, which is the shape the user sees as a trailing gutter.
  await page.keyboard.press("ArrowDown");
  await expect(rows(page).nth(1)).toHaveAttribute("data-active", "true");
  const left = await controlsTiming(rows(page).first());
  expect(left.duration).toBe("0s");
  expect(left.delay).toBe("0s");
});

test("the forgiving fade survives where it was written for: no pointer and no caret", async ({
  page,
}) => {
  await openPage(page, "CaretGutterRest", SOURCE);
  await page.mouse.move(4, 4);
  // Take focus out of the Page entirely, so nothing is lighting up to take over.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(150);

  const timing = await controlsTiming(rows(page).first());
  expect(timing.duration).toBe("0.11s");
  expect(timing.delay).toBe("0.09s");
});

/**
 * One gutter at a time while the pointer is the thing choosing.
 *
 * `:hover` and `:focus-within` are independent, and the two kill switches above are timing only, so
 * the caret in one row and the pointer over another lit both at `opacity: 1`. That is neither
 * reference — Notion's controls follow the hovered row, and Feishu draws a single shared overlay
 * that slides — and it puts two `+`/grip pairs under the hand at once, acting on different rows.
 */
test("the caret's row yields its controls to the row under the pointer", async ({ page }) => {
  await openPage(page, "GutterHandoff", SOURCE);

  const first = rows(page).first();
  const second = rows(page).nth(1);
  await activate(first);
  await expect(first).toHaveAttribute("data-active", "true");

  const box = await second.boundingBox();
  if (!box) throw new Error("second row has no box");
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);

  // The hovered row is lit and the row holding the caret is not, even though it still matches
  // `:focus-within`.
  await expect.poll(async () => (await controlsTiming(second)).opacity).toBe("1");
  await expect.poll(async () => (await controlsTiming(first)).opacity).toBe("0");

  // The pointer leaving the Page hands them straight back to the caret, so keyboard-only use is
  // untouched.
  await page.mouse.move(2, 2);
  await expect
    .poll(() => page.evaluate(() => !!document.querySelector(".markdown-page:hover")))
    .toBe(false);
  await expect.poll(async () => (await controlsTiming(first)).opacity).toBe("1");
});
