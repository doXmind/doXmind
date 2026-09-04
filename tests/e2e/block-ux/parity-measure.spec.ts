/**
 * A measurement harness, not an assertion suite.
 *
 * `docs/BLOCK_UX_REFERENCE.md` recorded numbers taken against live Notion and live Feishu on
 * 2026-07-24 and last updated 2026-07-25. Commit fdc325a then rewrote the four files those numbers
 * describe — `dropdown-menu.tsx`, `block-gutter-controls.tsx`, `markdown-block-row.tsx` and
 * `editor.css` — on 2026-08-04. The mechanisms survived; the execution order did not, and nothing
 * re-took the measurements against the result.
 *
 * This spec re-takes them. It asserts almost nothing on purpose: an assertion that fails tells you a
 * number moved, but not to what, and the point here is to produce the new column so a human can
 * decide whether the movement is drift or an improvement. It writes one JSON report and prints it.
 *
 * It does run with the suite — it is cheap (~10s) and the few things it does assert are worth a net:
 * if the gutter stops revealing, or the slash panel stops opening, this fails like any other spec.
 * To re-take the numbers on their own and keep the JSON somewhere you choose:
 *
 *   PARITY_REPORT=/tmp/parity.json npx playwright test tests/e2e/block-ux/parity-measure.spec.ts --reporter=line
 */

import { test, expect, type Locator, type Page } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { openPage } from "./harness";

// One worker per file is what made this suite 38 minutes: `fullyParallel: false` in
// playwright.config.ts keeps a file's tests serial, so history.spec.ts alone held a worker for 18.4
// minutes while the other idled — Playwright's own run summary says "Consider running tests from
// slow files in parallel." Every test here opens its own `mkdtemp` workspace through `openPage`, so
// there is no shared state to serialise for. The specs that DO share a fixed directory
// (browsing-runtime, import-conflict, knowledge-editor-gui-acceptance, markdown-autosave-focus,
// native-markdown-gui-acceptance) are deliberately not given this.
test.describe.configure({ mode: "parallel" });

const REPORT = process.env.PARITY_REPORT ?? "/tmp/doxmind-parity-report.json";

/** Every kind the gutter has to align against, in the order the fixture writes them. */
const SOURCE = [
  "# Heading one alpha",
  "",
  "## Heading two alpha",
  "",
  "### Heading three alpha",
  "",
  "#### Heading four alpha",
  "",
  "##### Heading five alpha",
  "",
  "###### Heading six alpha",
  "",
  "A plain paragraph long enough to own a real first line box.",
  "",
  "- Bulleted list item alpha",
  "",
  "1. Numbered list item alpha",
  "",
  "- [ ] A to-do item alpha",
  "",
  "> A blockquote long enough to own a real first line box.",
  "",
  "```ts",
  'const fenced = "code";',
  "```",
  "",
  "$$",
  "x^2 + 2",
  "$$",
  "",
  "> [!NOTE]",
  "> A callout long enough to own a real first line box.",
  "",
  "| Column A | Column B |",
  "| -------- | -------- |",
  "| cell one | cell two |",
  "",
  "---",
  "",
  "Trailing paragraph so the tail region exists.",
].join("\n");

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * The centre of a Block's first *line box*, which is what the gutter aligns to.
 *
 * Not the centre of the Block: a two-line paragraph, a callout with its own padding and a table with
 * a header row all put their first line somewhere the Block box cannot tell you.
 */
async function firstLineCentre(row: Locator): Promise<number | null> {
  return row.evaluate((el) => {
    const content = el.querySelector("[data-native-block-content]") ?? el;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node && !(node.textContent ?? "").trim()) node = walker.nextNode();
    if (!node) return null;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(1, node.textContent?.length ?? 0));
    const rects = range.getClientRects();
    const rect = rects.length ? rects[0] : range.getBoundingClientRect();
    if (!rect || rect.height === 0) return null;
    return rect.top + rect.height / 2;
  });
}

/** The x of a Block's first glyph — the thing the gutter's 10px gap is measured against. */
async function firstGlyphX(row: Locator): Promise<number | null> {
  return row.evaluate((el) => {
    const content = el.querySelector("[data-native-block-content]") ?? el;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node && !(node.textContent ?? "").trim()) node = walker.nextNode();
    if (!node) return null;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(1, node.textContent?.length ?? 0));
    const rect = range.getBoundingClientRect();
    return rect.width || rect.height ? rect.x : null;
  });
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  return box
    ? { x: round(box.x), y: round(box.y), w: round(box.width), h: round(box.height) }
    : null;
}

test("measure block UX geometry against the recorded Notion reference", async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, "Parity", SOURCE);

  const report: Record<string, unknown> = {
    takenAgainst: "current main",
    viewport: page.viewportSize(),
  };

  // ---- CSS custom properties the reference names by name -------------------------------------
  report.cssVars = await page.evaluate(() => {
    const surface =
      document.querySelector("[data-native-block-row]")?.closest("[class]") ?? document.body;
    const read = (name: string) =>
      getComputedStyle(surface as Element)
        .getPropertyValue(name)
        .trim();
    return {
      "--editor-content-rail": read("--editor-content-rail"),
      "--controls-lead(paragraph)": read("--controls-lead"),
    };
  });

  const rows = page.locator("[data-native-block-row]");
  const count = await rows.count();

  // ---- Per-kind: control centre vs first text line centre -------------------------------------
  const alignment: Array<Record<string, unknown>> = [];
  const rowBoxes: Array<{ kind: string; top: number; bottom: number }> = [];

  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const kind = (await row.getAttribute("data-block-kind")) ?? "?";
    const level = await row.getAttribute("data-block-level");
    const rowBox = await boxOf(row);
    if (rowBox)
      rowBoxes.push({
        kind: level ? `${kind}${level}` : kind,
        top: rowBox.y,
        bottom: rowBox.y + rowBox.h,
      });

    await row.hover();
    const controls = row.locator("[data-native-block-controls]");
    const add = row.getByRole("button", { name: "Insert block" });
    const grip = row.getByRole("button", { name: "Block actions" });

    const [controlsBox, addBox, gripBox, textCentre, glyphX] = await Promise.all([
      boxOf(controls),
      boxOf(add),
      boxOf(grip),
      firstLineCentre(row),
      firstGlyphX(row),
    ]);

    const clusterCentre = gripBox
      ? gripBox.y + gripBox.h / 2
      : controlsBox
        ? controlsBox.y + controlsBox.h / 2
        : null;

    alignment.push({
      kind: level ? `${kind} ${level}` : kind,
      controlCentreMinusTextCentre:
        clusterCentre != null && textCentre != null ? round(clusterCentre - textCentre) : null,
      addSize: addBox ? `${addBox.w}x${addBox.h}` : null,
      gripSize: gripBox ? `${gripBox.w}x${gripBox.h}` : null,
      gripRightToFirstGlyph:
        gripBox && glyphX != null ? round(glyphX - (gripBox.x + gripBox.w)) : null,
      addRightToGripRight:
        addBox && gripBox ? round(gripBox.x + gripBox.w - (addBox.x + addBox.w)) : null,
      gutterWidth: controlsBox ? controlsBox.w : null,
    });
  }
  report.alignment = alignment;

  // ---- Hover band: any vertical gap between consecutive rows is a pointer dead zone ------------
  const gaps: Array<{ between: string; gap: number }> = [];
  for (let i = 1; i < rowBoxes.length; i += 1) {
    gaps.push({
      between: `${rowBoxes[i - 1].kind} → ${rowBoxes[i].kind}`,
      gap: round(rowBoxes[i].top - rowBoxes[i - 1].bottom),
    });
  }
  report.rowGaps = { max: gaps.length ? Math.max(...gaps.map((g) => g.gap)) : null, all: gaps };

  // ---- Controls at rest and on hover ----------------------------------------------------------
  const firstRow = rows.first();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  report.controlsAtRest = await firstRow.locator("[data-native-block-controls]").evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      opacity: cs.opacity,
      pointerEvents: cs.pointerEvents,
      transitionProperty: cs.transitionProperty,
      transitionDuration: cs.transitionDuration,
      transitionDelay: cs.transitionDelay,
      transitionTimingFunction: cs.transitionTimingFunction,
    };
  });
  await firstRow.hover();
  await page.waitForTimeout(200);
  report.controlsOnHover = await firstRow.locator("[data-native-block-controls]").evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      opacity: cs.opacity,
      transitionDuration: cs.transitionDuration,
      transitionDelay: cs.transitionDelay,
    };
  });
  report.addButtonStyle = await firstRow
    .getByRole("button", { name: "Insert block" })
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        borderRadius: cs.borderRadius,
        transitionProperty: cs.transitionProperty,
        transitionDuration: cs.transitionDuration,
      };
    });

  // ---- Row hover tint: the reference says a text Block paints nothing --------------------------
  report.rowHoverTint = await firstRow.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { backgroundColor: cs.backgroundColor, backgroundImage: cs.backgroundImage };
  });

  // ---- Block actions menu ---------------------------------------------------------------------
  await firstRow.hover();
  await firstRow.getByRole("button", { name: "Block actions" }).click();
  const menu = page.getByRole("menu", { name: "Block actions menu" });
  await expect(menu).toBeVisible();
  await page.waitForTimeout(400);
  report.blockMenu = await menu.evaluate((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const item = el.querySelector('[role="menuitem"]');
    const ics = item ? getComputedStyle(item) : null;
    const ir = item ? item.getBoundingClientRect() : null;
    return {
      width: Math.round(r.width * 100) / 100,
      maxHeight: cs.maxHeight,
      borderRadius: cs.borderRadius,
      boxShadow: cs.boxShadow,
      backdropFilter: cs.backdropFilter,
      backgroundColor: cs.backgroundColor,
      itemHeight: ir ? Math.round(ir.height * 100) / 100 : null,
      itemRadius: ics ? ics.borderRadius : null,
      itemTransitionDuration: ics ? ics.transitionDuration : null,
    };
  });
  await page.keyboard.press("Escape");

  // ---- Slash menu -----------------------------------------------------------------------------
  // It is a listbox named "Block commands", not a menu, and it only opens from an empty Block — the
  // same way `menus.spec.ts` reaches it, via an Option-click on the gutter `+`.
  const firstForSlash = rows.first();
  await firstForSlash.hover();
  await firstForSlash.getByRole("button", { name: "Insert block" }).click({ modifiers: ["Alt"] });
  await expect(rows.first()).toHaveAttribute("data-active", "true");
  await page.keyboard.type("/");
  const slash = page.getByRole("listbox", { name: "Block commands" });
  await expect(slash).toBeVisible();
  await page.waitForTimeout(400);
  report.slashMenu = await slash.evaluate((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const item = el.querySelector('[role="option"]');
    const ics = item ? getComputedStyle(item) : null;
    const ir = item ? item.getBoundingClientRect() : null;
    const selected = el.querySelector('[role="option"][aria-selected="true"]');
    return {
      width: Math.round(r.width * 100) / 100,
      height: Math.round(r.height * 100) / 100,
      maxHeight: cs.maxHeight,
      borderRadius: cs.borderRadius,
      boxShadow: cs.boxShadow,
      optionCount: el.querySelectorAll('[role="option"]').length,
      itemHeight: ir ? Math.round(ir.height * 100) / 100 : null,
      itemRadius: ics ? ics.borderRadius : null,
      selectedBackground: selected ? getComputedStyle(selected).backgroundColor : null,
    };
  });
  // The caret anchor: the reference records Notion opening 8px below the caret's line.
  report.slashAnchor = await page.evaluate(() => {
    const box = document.querySelector('[role="listbox"][aria-label="Block commands"]');
    const row = document.querySelector('[data-native-block-row][data-active="true"]');
    if (!box || !row) return null;
    const b = box.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    return {
      listboxTopMinusRowBottom: Math.round((b.top - r.bottom) * 100) / 100,
      listboxLeftMinusRowLeft: Math.round((b.left - r.left) * 100) / 100,
    };
  });
  await page.keyboard.press("Escape");

  // ---- Inline code ratio, and the selection colour --------------------------------------------
  report.selectionColour = await page.evaluate(() => {
    const out: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules)) {
          const t = (rule as CSSRule).cssText ?? "";
          if (/35,\s*131,\s*226/.test(t) && t.length < 300) out.push(t);
        }
      } catch {
        /* cross-origin sheet */
      }
    }
    return Array.from(new Set(out)).slice(0, 6);
  });

  await mkdir(dirname(REPORT), { recursive: true });
  await writeFile(REPORT, JSON.stringify(report, null, 2), "utf8");
  console.log(
    "\n===== PARITY REPORT =====\n" +
      JSON.stringify(report, null, 2) +
      "\n=========================\n"
  );
});
