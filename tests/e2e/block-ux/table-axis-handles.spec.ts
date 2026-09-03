import { expect, test } from "@playwright/test";

import { openPage, readSource } from "./harness";

/**
 * The two pills that operate a table's rows and columns, measured where they actually land.
 *
 * The column pill could not be pressed at all. `DropdownMenu` wraps its trigger in an
 * `inline-block`, so the box inside the positioned wrapper was a line box rather than the 9px pill,
 * and `translate(-50%, -50%)` therefore lifted it by half of 28px instead of half of 9. Measured in
 * the packaged app: the pill drew at y 128.5–137.5 against a header cell whose top edge is 142.5 —
 * the whole pill floated 5px clear of the table, with a strip under it belonging to neither. Moving
 * the pointer up to it crossed that strip, left the `<table>`, and `onPointerLeave` cleared
 * `hovered`: the pill went `opacity: 0; pointer-events: none` before the pointer arrived.
 *
 * jsdom lays out no tables, so this is the only place the pixels can be asserted. Both halves are
 * here: where the pill sits, and that a pointer travelling to it from inside the cell arrives.
 */
const TABLE = `Lead paragraph.

| Action | One | Two |
| --- | --- | --- |
| Cast | down | S |
| Detonate | up | W |

Tail paragraph.
`;

test.describe("table axis handles", () => {
  test("straddles the border it names, instead of floating clear of the table", async ({
    page,
  }) => {
    await openPage(page, "Axis", TABLE);

    await page.locator("th", { hasText: "Two" }).first().click();
    const handle = page.locator("th [data-axis-handle]").nth(2);
    await expect(handle).toBeVisible();

    const geometry = await page.evaluate(() => {
      const table = document.querySelector("table[aria-label='Markdown table']")!;
      const header = [...table.querySelectorAll("th")][2];
      const pill = header.querySelector("[data-axis-handle]")!.getBoundingClientRect();
      const cell = header.getBoundingClientRect();
      const rowPill = table.querySelector("tbody [data-axis-handle]")!.getBoundingClientRect();
      const rowCell = table.querySelector("tbody td")!.getBoundingClientRect();
      return {
        pillTop: pill.top,
        pillBottom: pill.bottom,
        cellTop: cell.top,
        rowPillCentre: (rowPill.top + rowPill.bottom) / 2,
        rowCellCentre: (rowCell.top + rowCell.bottom) / 2,
      };
    });

    // Half of it inside the cell, which is the half a pointer coming from the cell can reach.
    expect(geometry.pillTop).toBeLessThan(geometry.cellTop);
    expect(geometry.pillBottom).toBeGreaterThan(geometry.cellTop);
    // Centred on the border, within a pixel of rounding.
    expect(Math.abs((geometry.pillTop + geometry.pillBottom) / 2 - geometry.cellTop)).toBeLessThan(
      1
    );
    // The row pill was 3px above its row's centre from the same cause.
    expect(Math.abs(geometry.rowPillCentre - geometry.rowCellCentre)).toBeLessThan(1);
  });

  test("stays under a pointer travelling to it from inside the cell", async ({ page }) => {
    const opened = await openPage(page, "Axis", TABLE);

    await page.locator("th", { hasText: "Two" }).first().click();
    // By its own name, not by index: the pill is mid-column, and picking the wrong one is exactly
    // the mistake this test exists to catch someone else making.
    const handle = page.getByRole("button", { name: "Column 3 actions" });
    const pill = (await handle.boundingBox())!;
    const cell = (await page.locator("th", { hasText: "Two" }).first().boundingBox())!;
    const x = pill.x + pill.width / 2;

    // Up the column's centre line, one pixel at a time, the way a pointer actually travels.
    let landed = false;
    for (let y = cell.y + 18; y >= pill.y; y -= 1) {
      await page.mouse.move(x, y);
      landed = await page.evaluate(
        ([px, py]) => !!document.elementFromPoint(px, py)?.closest("[data-axis-handle]"),
        [x, y] as const
      );
      if (landed) break;
    }
    expect(landed, "the pointer reaches the pill without it vanishing").toBe(true);

    // And the press it could never receive opens the menu and applies.
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.getByRole("menuitem", { name: "Insert right" })).toBeVisible();
    await page.getByRole("menuitem", { name: "Insert right" }).click();

    await expect.poll(() => readSource(opened)).toContain("| Action | One | Two |  |");
  });
});
