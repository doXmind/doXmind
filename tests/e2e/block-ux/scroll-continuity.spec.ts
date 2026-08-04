import { expect, test, type Page } from "@playwright/test";

import { activate, openPage, rows } from "./harness";

/**
 * Where the Page goes while the keyboard drives it.
 *
 * Every number here was measured in the running app before it was asserted, and none of them can be
 * measured anywhere else: jsdom lays nothing out, so a scroll assertion in a unit test passes
 * against any code at all. The caret and focus half of the same cluster is a unit test — see
 * src/__tests__/editor/markdown-block-caret-continuity.test.tsx.
 *
 * The dev server inflates latency several-fold against the packaged build, so nothing here asserts a
 * duration. What is asserted is geometry, which is the same in both.
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

/** The active row's box and the scroll port's offset, read together so they cannot disagree. */
async function activeRowGeometry(page: Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>("[data-native-markdown-scroll]")!;
    const row = document.querySelector<HTMLElement>('[data-native-block-row][data-active="true"]');
    const box = row?.getBoundingClientRect();
    return {
      scrollTop: scroller.scrollTop,
      port: scroller.getBoundingClientRect(),
      top: box?.top ?? null,
      bottom: box?.bottom ?? null,
    };
  });
}

test("walking Enter down a Page scrolls by one row, never by half a viewport", async ({ page }) => {
  await openPage(page, "EnterWalk", longPage(60));
  await activate(rows(page).first(), "Paragraph 0");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowRight" : "End");

  let previous = (await activeRowGeometry(page)).scrollTop;
  const steps: number[] = [];
  for (let press = 0; press < 30; press += 1) {
    await page.keyboard.press("Enter");
    const now = (await activeRowGeometry(page)).scrollTop;
    steps.push(Math.round(now - previous));
    previous = now;
  }

  // Blink's `CenterIfNeeded` is bimodal: it nudges a surface that is still partly visible and
  // recentres one that mounts entirely below the fold. Measured, that read as 39, 39, 39 … 453 —
  // a single frame moving 52% of the port — until the row's focus() started passing
  // `preventScroll` and asking for `block: "nearest"` itself.
  const moved = steps.filter((step) => step !== 0);
  expect(moved.length).toBeGreaterThan(5);
  expect(Math.max(...moved)).toBeLessThan(60);
});

test("walking ArrowUp never parks the Block behind the window chrome", async ({ page }) => {
  await openPage(page, "ArrowUpWalk", longPage());

  await page.evaluate(() => {
    document.querySelectorAll("[data-native-block-row]")[120].scrollIntoView({ block: "center" });
  });
  await activate(rows(page).nth(120), "Paragraph 120");

  const chromeBottom = await page.evaluate(() => {
    const header = document.querySelector("header.desktop-chrome-header")?.getBoundingClientRect();
    const controls = document.querySelector(".page-controls-backdrop")?.getBoundingClientRect();
    return Math.max(header?.bottom ?? 0, controls?.bottom ?? 0);
  });
  expect(chromeBottom).toBeGreaterThan(0);

  const behind: number[] = [];
  for (let press = 0; press < 40; press += 1) {
    await page.keyboard.press("ArrowUp");
    const { top, bottom } = await activeRowGeometry(page);
    if (top === null || bottom === null) continue;
    // The scroll port starts at y=0 and the chrome is painted opaque over it, so "on screen" is not
    // the same question as "visible". Measured before `scroll-padding-top` was declared: 4 of 40
    // rows entirely behind it and 9 more with their first line inside the band, the worst showing
    // 0.0px of a 39.0px row. WCAG 2.2 SC 2.4.11.
    if (top < chromeBottom) behind.push(Math.round(top));
  }
  expect(behind).toEqual([]);
});

test("a vertical walk keeps its column across a short Block", async ({ page }) => {
  const long = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike";
  await openPage(page, "GoalColumn", `${long}\n\nHi\n\n${long}\n`);

  const third = rows(page).nth(2);
  await third.scrollIntoViewIfNeeded();
  const box = (await third.locator("[data-native-block-content]").boundingBox())!;
  await page.mouse.click(box.x + 300, box.y + box.height / 2);
  await expect(third).toHaveAttribute("data-active", "true");

  const caret = () =>
    page.evaluate(() => {
      const active = document.activeElement as HTMLTextAreaElement | null;
      const row = document.querySelector('[data-native-block-row][data-active="true"]');
      const all = [...document.querySelectorAll("[data-native-block-row]")];
      return { index: row ? all.indexOf(row) : -1, offset: active?.selectionStart ?? null };
    });

  const start = await caret();
  expect(start.index).toBe(2);
  expect(start.offset).toBeGreaterThan(20);

  await page.keyboard.press("ArrowUp");
  await expect(rows(page).nth(1)).toHaveAttribute("data-active", "true");
  await page.keyboard.press("ArrowUp");
  await expect(rows(page).nth(0)).toHaveAttribute("data-active", "true");

  // The two-character Block in the middle has nowhere to put a column of 300px, so re-measuring the
  // caret's x on arrival threw the column away for the rest of the walk: measured, offset 42 became
  // offset 2, and no further ArrowUp could get it back. The column belongs to the walk, not to
  // whichever Block it is passing through.
  const arrived = await caret();
  expect(arrived.offset).toBe(start.offset);
});

test("a horizontal move re-measures the column instead of reusing the walk's", async ({ page }) => {
  const long = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike";
  await openPage(page, "GoalReset", `${long}\n\nHi\n\n${long}\n`);

  const third = rows(page).nth(2);
  await third.scrollIntoViewIfNeeded();
  const box = (await third.locator("[data-native-block-content]").boundingBox())!;
  await page.mouse.click(box.x + 300, box.y + box.height / 2);
  await expect(third).toHaveAttribute("data-active", "true");

  await page.keyboard.press("ArrowUp");
  await expect(rows(page).nth(1)).toHaveAttribute("data-active", "true");
  // One ArrowLeft inside the short Block, the way a native field resets its goal column.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  await expect(rows(page).nth(0)).toHaveAttribute("data-active", "true");

  const offset = await page.evaluate(
    () => (document.activeElement as HTMLTextAreaElement | null)?.selectionStart ?? null
  );
  expect(offset).toBeLessThan(5);
});

test("the run a link will wrap stays painted while the popover holds focus", async ({ page }) => {
  await openPage(page, "LinkPaint", "Alpha bravo charlie delta.\n");
  await activate(rows(page).first(), "Alpha");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowLeft" : "Home");
  for (let index = 0; index < 5; index += 1) await page.keyboard.press("Shift+ArrowRight");

  const selected = await page.evaluate(() => {
    const active = document.activeElement as HTMLTextAreaElement | null;
    return active ? active.selectionEnd - active.selectionStart : 0;
  });
  expect(selected).toBe(5);

  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await expect(page.getByLabel("Link destination")).toBeVisible();

  // Measured, the tinted run went to 0px² the instant the popover took focus: a blurred textarea
  // paints no selection and a semantic Block's document selection is gone outright, so the reader
  // was being asked about a run they could not see.
  const painted = await page.evaluate(() =>
    [...document.querySelectorAll("[data-native-link-selection]")].reduce((sum, node) => {
      const box = node.getBoundingClientRect();
      return sum + box.width * box.height;
    }, 0)
  );
  expect(painted).toBeGreaterThan(200);

  // And Escape gives the keyboard back, rather than leaving it on `<body>` with only Shift+Tab or
  // the mouse able to recover.
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Link destination")).toHaveCount(0);
  await expect(rows(page).first().locator("[data-native-block-editor]")).toBeFocused();
  await page.keyboard.type("Z");
  await expect(rows(page).first().locator("[data-native-block-editor]")).toHaveValue(
    "Z bravo charlie delta."
  );
});
