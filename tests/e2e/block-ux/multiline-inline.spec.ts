/**
 * A Block with a newline gets the same live rendering as one without.
 *
 * Every multi-line Block used to fall back to the raw textarea, so clicking a paragraph that
 * happened to contain a hard line break turned the whole paragraph into Markdown source —
 * `**bold**` and all — while the identical paragraph on one line rendered its marks. The only
 * difference between them was the newline.
 *
 * Two things had to hold before that fallback could go, and both are asserted here: Shift+Enter
 * must insert the soft break itself, because a contenteditable's default inserts a block element
 * that comes back through the projection as a blank line and so splits the Block; and a setext
 * heading must stay on the textarea, because `====` is `==highlight==` to the inline grammar and
 * the projection swallows the underline whole.
 */

import { expect, test } from "@playwright/test";
import { openPage, rows, activate, surfaceOf } from "./harness";

// One worker per file is what made this suite 38 minutes: `fullyParallel: false` in
// playwright.config.ts keeps a file's tests serial, so history.spec.ts alone held a worker for 18.4
// minutes while the other idled — Playwright's own run summary says "Consider running tests from
// slow files in parallel." Every test here opens its own `mkdtemp` workspace through `openPage`, so
// there is no shared state to serialise for. The specs that DO share a fixed directory
// (browsing-runtime, import-conflict, knowledge-editor-gui-acceptance, markdown-autosave-focus,
// native-markdown-gui-acceptance) are deliberately not given this.
test.describe.configure({ mode: "parallel" });

/**
 * The marks inside the surface being edited.
 *
 * Not `row.locator("strong")`: an active row holds the rendered preview as well as the editing
 * surface, so counting across the row counts every mark twice and says nothing about which of the
 * two is showing them.
 */
const editingMarks = (row: ReturnType<typeof rows>) =>
  row.locator("[data-semantic-inline-content] strong");

test("a paragraph with a hard line break renders its marks while being edited", async ({
  page,
}) => {
  await openPage(
    page,
    "Multiline inline",
    "one line **bold one** here\n\nfirst line **bold two** here\nsecond line **bold three** here\n"
  );
  await expect(rows(page)).toHaveCount(2);

  // The single-line Block is the control: it already rendered its marks.
  await activate(rows(page).nth(0), "bold one");
  expect(await surfaceOf(rows(page).nth(0))).toBe("contenteditable");

  await activate(rows(page).nth(1), "bold two");
  expect(await surfaceOf(rows(page).nth(1))).toBe("contenteditable");
  await expect(editingMarks(rows(page).nth(1))).toHaveCount(2);
  await expect(rows(page).nth(1).locator("[data-semantic-inline-content]")).not.toContainText("**");
});

test("Shift+Enter adds a line inside the Block instead of splitting it", async ({ page }) => {
  await openPage(page, "Multiline soft break", "alpha **bold** omega tail\n");
  await expect(rows(page)).toHaveCount(1);

  await activate(rows(page).first(), "omega");
  expect(await surfaceOf(rows(page).first())).toBe("contenteditable");

  // Mid-text, where a soft break is meaningful. At a line end the new newline would sit beside
  // the existing one and make a blank line, which is a paragraph break and correct Markdown.
  await page.keyboard.press("Shift+Enter");
  await expect(rows(page)).toHaveCount(1);
  await expect(editingMarks(rows(page).first())).toHaveCount(1);
});

test("a setext heading keeps the surface that can see its underline", async ({ page }) => {
  await openPage(page, "Multiline setext", "Setext title\n============\n\nBody paragraph.\n");
  await expect(rows(page)).toHaveCount(2);

  await activate(rows(page).first(), "Setext title");
  // The inline projection reaches only 13 of the 25 characters here — the underline is not a
  // marker it hides but bytes it drops — so the raw surface owns this Block.
  expect(await surfaceOf(rows(page).first())).toBe("textarea");
  await expect(rows(page).first().locator("[data-native-block-editor]")).toHaveValue(
    "Setext title\n============"
  );
});
