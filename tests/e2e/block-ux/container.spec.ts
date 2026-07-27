import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { activate, clickAway, openPage, rows, settledHeight, type OpenedPage } from "./harness";

/**
 * A callout's own controls: changing its type, and getting out of it with the keyboard.
 *
 * Both were missing rather than broken. `type` was readable and unwritable, so every callout in the
 * app was permanently whatever the file said; and Backspace at the start was a dead key, so there was
 * no keyboard way to undo having made something a callout.
 *
 * The behaviour taken here is the reference products': the icon *is* the control, because pressing
 * the thing you want to change is more direct than selecting the Block first and reaching for a
 * floating bar; and Backspace at the very start strips the container and leaves the words, in two
 * presses rather than one, so it never swallows the Block above by surprise.
 */

/** Polls for the expected file contents — autosave is debounced, so a fixed wait races it. */
async function expectSource(opened: OpenedPage, expected: string): Promise<void> {
  await expect.poll(() => readFile(opened.path, "utf8"), { timeout: 8000 }).toBe(expected);
}

test("the callout icon changes its type, and never resizes the Block", async ({ page }) => {
  const opened = await openPage(page, "Callout type", "> [!NOTE]\n> Body text.\n");
  const row = rows(page).first();

  await clickAway(page);
  const resting = await settledHeight(row);
  await activate(row);
  const editing = (await row.boundingBox())?.height ?? 0;
  // The control is mounted in both states and is the same box in both, so taking the caret cannot
  // change the callout's size — the whole reason it replaces the icon rather than appearing beside it.
  expect(Math.abs(editing - resting), "activating the callout resized it").toBeLessThanOrEqual(1);

  await row.locator("button[aria-label*='change type']").click();
  // Awaited, not slept on: the menu is portalled and arrives a frame or two later.
  await expect(page.getByRole("menuitem").first()).toBeVisible();
  const items = await page.evaluate(() =>
    [...document.querySelectorAll('[role="menuitem"]')].map((node) => node.textContent)
  );
  // Every type a portable callout can be, with the current one marked so the menu also answers
  // "what is this?".
  expect(items).toEqual(["✓Note", "Tip", "Important", "Warning", "Caution"]);

  await page.getByRole("menuitem", { name: /Warning/ }).click();
  await expectSource(opened, "> [!WARNING]\n> Body text.\n");
});

test("Backspace at the start of a callout strips it, and only then merges", async ({ page }) => {
  const opened = await openPage(page, "Uncallout", "Lead.\n\n> [!TIP] Title here\n> Body text.\n");
  const row = rows(page).nth(1);
  await activate(row);
  // Into the title specifically. Activation alone does not say which of a container's two regions
  // took the caret, and this test is about the start of the *title*.
  await row.locator("[aria-label='Callout title']").first().click();
  await page.keyboard.press("Meta+ArrowLeft");

  // First press: the container goes, the words stay, and the Block is ordinary text.
  await page.keyboard.press("Backspace");
  await expectSource(opened, "Lead.\n\nTitle here\nBody text.\n");
  await expect(rows(page).nth(1)).toHaveAttribute("data-block-kind", "paragraph");

  // Second press, from the same place: now it merges upward. Two presses, never one — collapsing
  // them would take the Block above with a keystroke aimed at this one's styling.
  await page.keyboard.press("Meta+ArrowLeft");
  await page.keyboard.press("Backspace");
  await expectSource(opened, "Lead.Title here\nBody text.\n");
});

test("Backspace at the start of a callout's body joins it to the title", async ({ page }) => {
  const opened = await openPage(page, "Join body", "> [!NOTE] Title\n> Body text.\n");
  const row = rows(page).first();
  await activate(row);

  // ArrowDown from the title is how the body is reached — its editor only exists once the body is the
  // active region, so there is no body element to click before then — and it lands at the body's start,
  // which is the position under test.
  await row.locator("[aria-label='Callout title']").first().click();
  await page.keyboard.press("ArrowDown");
  await expect(row.locator("[aria-label='Callout body']")).toBeFocused();
  await page.keyboard.press("Backspace");

  // The title and the body are one container's two halves, so this is the ordinary "merge with the
  // line above" — it was simply dead, because the Block-level handler takes a bare Backspace only for
  // kinds that hold no text at all.
  await expectSource(opened, "> [!NOTE] TitleBody text.\n");
});
