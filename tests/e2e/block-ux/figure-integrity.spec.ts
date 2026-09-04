/**
 * What happens to an equation whose contents you delete.
 *
 * `docs/BLOCK_UX_REFERENCE.md` recorded a rule and a reason: `block_math` keeps its `$$` visible on
 * purpose, because "a fence tolerates an empty payload (```ts\n\n``` is still one code Block) but
 * `$$\n\n$$` is a blank line between two paragraphs, so projecting it would let deleting an
 * equation's contents disintegrate the Block."
 *
 * The `$$` are no longer visible — `splitFigureSource` projects them out and the source field holds
 * only the payload — so the rule as written is gone. The answer, asked of the file rather than of
 * the DOM, is that the *defence* moved rather than disappearing: `assembleMath` refuses to write
 * `$$\n\n$$` at all, collapsing an emptied equation to the one-line `$$ $$` that holds nothing
 * safely, and promoting it back to the fenced shape on the first newline. Nothing disintegrates.
 *
 * These exist because that property had no end-to-end test. What was pinned was the *mechanism* —
 * whether the delimiters render — and the mechanism is exactly what changed underneath it. These
 * assert the property instead, against the only witness that matters: the user's bytes.
 */

import { test, expect } from "@playwright/test";
import { openPage, rows, activate, clickAway, readSource } from "./harness";

// One worker per file is what made this suite 38 minutes: `fullyParallel: false` in
// playwright.config.ts keeps a file's tests serial, so history.spec.ts alone held a worker for 18.4
// minutes while the other idled — Playwright's own run summary says "Consider running tests from
// slow files in parallel." Every test here opens its own `mkdtemp` workspace through `openPage`, so
// there is no shared state to serialise for. The specs that DO share a fixed directory
// (browsing-runtime, import-conflict, knowledge-editor-gui-acceptance, markdown-autosave-focus,
// native-markdown-gui-acceptance) are deliberately not given this.
test.describe.configure({ mode: "parallel" });

/** Long enough that autosave has certainly run; `menus.spec.ts` uses the same budget for the same reason. */
const AUTOSAVE = 2500;

test("emptying an equation leaves one Block, not two paragraphs", async ({ page }) => {
  const source = "Lead paragraph.\n\n$$\nx^2 + 2\n$$\n\nTail paragraph.\n";
  const opened = await openPage(page, "FigureIntegrity", source);
  const row = rows(page).nth(1);
  await expect(row).toHaveAttribute("data-block-kind", "block_math");
  const rowCountBefore = await rows(page).count();

  await activate(row);
  const field = row.locator("[data-figure-source-field]");
  await expect(field).toBeVisible();

  // Empty it the way a user does: select everything in the field, then delete.
  await field.press("ControlOrMeta+a");
  await field.press("Backspace");
  await clickAway(page);
  await page.waitForTimeout(AUTOSAVE);

  // The claim under test. If the delimiters were lost, this row is no longer an equation and the
  // Page has gained or lost rows.
  await expect(rows(page).nth(1)).toHaveAttribute("data-block-kind", "block_math");
  expect(await rows(page).count()).toBe(rowCountBefore);

  // And the bytes still describe one math Block with its fences intact.
  const after = await readSource(opened);
  expect(after).toContain("$$");
  expect(after.match(/\$\$/g)?.length).toBe(2);
  expect(after).toContain("Lead paragraph.");
  expect(after).toContain("Tail paragraph.");
});

test("emptying an equation collapses it to the one shape that can hold nothing", async ({
  page,
}) => {
  const source = "$$\nx^2 + 2\n$$\n";
  const opened = await openPage(page, "FigureRoundTrip", source);

  await activate(rows(page).first());
  const field = rows(page).first().locator("[data-figure-source-field]");
  await field.press("ControlOrMeta+a");
  await field.press("Backspace");
  await clickAway(page);
  await page.waitForTimeout(AUTOSAVE);

  // `$$\n\n$$` is what a naive splice would write, and it is a blank line between two `$$`
  // paragraphs — the Block would come apart. `$$ $$` is the only shape that holds an empty formula
  // and still parses as one equation, so that is what an emptied equation becomes.
  expect(await readSource(opened)).toBe("$$ $$\n");
  await expect(rows(page).first()).toHaveAttribute("data-block-kind", "block_math");
});

test("a newline typed into a collapsed equation promotes it back to the fenced shape", async ({
  page,
}) => {
  const opened = await openPage(page, "FigurePromote", "$$ $$\n");

  await activate(rows(page).first());
  const field = rows(page).first().locator("[data-figure-source-field]");
  await field.press("ControlOrMeta+a");
  await field.pressSequentially("x^2");
  await field.press("Enter");
  await clickAway(page);
  await page.waitForTimeout(AUTOSAVE);

  // The shape is the contract, not where the text landed: a newline promotes the one-line equation
  // to `$$` on its own line, because `$$x^2` / `…$$` on one line with a break in it is two
  // paragraphs and no longer an equation. The trailing blank is trimmed, so the payload stays "x^2".
  const after = await readSource(opened);
  expect(after).toMatch(/^\$\$\n[\s\S]*\n\$\$\n$/);
  expect(after).toContain("x^2");
  await expect(rows(page).first()).toHaveAttribute("data-block-kind", "block_math");
});
