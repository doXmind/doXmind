import { expect, test, type Page } from "@playwright/test";

import { activateAt, openPage, rowWith } from "./harness";

/**
 * Where the caret lands when an arrow key crosses out of one Block into the next.
 *
 * Three defects with one cause, and none of them is visible to a unit test: every one of them is a
 * measurement the browser makes and jsdom does not. A Block that draws a box rather than a line of
 * text — a code Block, a callout, a toggle, a table — used to hand its arrow back to the row with no
 * column and no direction attached, so the runtime had nothing to aim at and every crossing out of
 * one dropped the caret at offset 0 of whatever was below, while every crossing *into* one landed on
 * its first cell or its summary whichever way the caret had come from. Coming up the page, that made
 * a table's body rows and an expanded toggle's body unreachable by keyboard: one press stepped over
 * all of them into the header or the title, and the next left the Block again.
 *
 * The assertions are about which surface holds the caret and where in it, because that is the whole
 * of what the user experiences: they press Up and either the line they were aiming at takes the
 * caret or it does not.
 */

const SOURCE = `Paragraph above the code

\`\`\`js
const alpha = 1;
const bravo = 2;
\`\`\`

Paragraph below the code

| head one | head two |
| --- | --- |
| body a | body b |
| body c | body d |

Paragraph below the table

<details open>
<summary>Toggle summary</summary>

Toggle body text

</details>

Paragraph below the toggle
`;

interface CaretReport {
  /** The accessible name of the surface holding focus: which cell, which region, which Block. */
  readonly label: string | null;
  /** `data-container-region` of the region the caret is in, for a callout or a toggle. */
  readonly region: string | null;
  readonly text: string;
  /** The caret's offset in that surface's own text, or null when nothing holds a caret. */
  readonly caret: number | null;
}

/** What holds the caret, read from whichever kind of surface it turned out to be. */
async function caretReport(page: Page): Promise<CaretReport> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement) || !element.hasAttribute("data-native-block-editor")) {
      return { label: null, region: null, text: "", caret: null };
    }
    if (element instanceof HTMLTextAreaElement) {
      return {
        label: element.getAttribute("aria-label"),
        region: null,
        text: element.value,
        caret: element.selectionStart,
      };
    }
    const selection = window.getSelection();
    let caret: number | null = null;
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (element.contains(range.startContainer)) {
        const measured = document.createRange();
        measured.selectNodeContents(element);
        measured.setEnd(range.startContainer, range.startOffset);
        caret = measured.toString().length;
      }
    }
    return {
      label: element.getAttribute("aria-label"),
      region:
        element.closest("[data-container-region]")?.getAttribute("data-container-region") ?? null,
      text: element.textContent ?? "",
      caret,
    };
  });
}

/** Put the caret at the start of a paragraph and press Up out of it. */
async function arrowUpFrom(page: Page, paragraph: string): Promise<CaretReport> {
  await activateAt(rowWith(page, paragraph), paragraph);
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowUp");
  return caretReport(page);
}

/** Put the caret at the end of a paragraph and press Down out of it. */
async function arrowDownFrom(page: Page, paragraph: string): Promise<CaretReport> {
  await activateAt(rowWith(page, paragraph), paragraph);
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowDown");
  return caretReport(page);
}

test.describe("crossing a Block boundary with an arrow key", () => {
  test("enters a table's last row from below and its header from above", async ({ page }) => {
    await openPage(page, "Crossing", SOURCE);

    // Before this, both of these landed on `head one`: the address a table falls back to when it is
    // activated with no press to place the caret. Arriving from underneath, that stepped over both
    // body rows in one press, and nothing pressed after it could get back down to them.
    const fromBelow = await arrowUpFrom(page, "Paragraph below the table");
    expect(fromBelow.label).toBe("Table cell");
    expect(fromBelow.text.trim()).toBe("body c");
    expect(fromBelow.caret).toBe("body c".length);

    const fromAbove = await arrowDownFrom(page, "Paragraph below the code");
    expect(fromAbove.label).toBe("Table cell");
    expect(fromAbove.text.trim()).toBe("head one");
  });

  test("enters an expanded toggle's body from below and its summary from above", async ({
    page,
  }) => {
    await openPage(page, "Crossing", SOURCE);

    // The summary used to take the caret whichever way it arrived, which left the body of every
    // toggle on the Page unreachable from the Block underneath it.
    const fromBelow = await arrowUpFrom(page, "Paragraph below the toggle");
    expect(fromBelow.region).toBe("body");
    expect(fromBelow.text).toContain("Toggle body text");
    expect(fromBelow.caret).toBe("Toggle body text".length);

    const fromAbove = await arrowDownFrom(page, "Paragraph below the table");
    expect(fromAbove.region).toBe("heading");
    expect(fromAbove.text).toBe("Toggle summary");
  });

  test("keeps the column when the caret leaves a Block that edits in place", async ({ page }) => {
    await openPage(page, "Crossing", SOURCE);

    // Mid-line in the code payload, then straight down out of it. The column is measured in pixels
    // and the two Blocks are set in different faces, so the offset it maps to is a browser
    // measurement rather than a constant — but it was exactly 0 before, for every column, because
    // the row handed the crossing back with no column at all. Measured here: 7.
    const code = rowWith(page, "const bravo");
    await activateAt(code, "bravo");
    await page.keyboard.press("ArrowDown");

    const landed = await caretReport(page);
    expect(landed.text).toBe("Paragraph below the code");
    expect(landed.caret).toBeGreaterThan(0);
  });
});
