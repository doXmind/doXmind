/**
 * Hover, activation and caret placement, per Block kind.
 *
 * This is the dimension a user touches before any other: the pointer arrives, something has to say
 * "this Block is live", the press has to land where it was aimed, and letting go has to give the
 * caret back. Three product decisions are recorded here rather than inferred.
 *
 *   - Hovering reveals the gutter controls and paints nothing else. The row `::after` used to carry a
 *     tint bounded on the left by the content rail and running to `right: 0`, which turned a
 *     six-character paragraph into a 1016x40px band — see the note above the selection fill rule in
 *     src/app/styles/editor.css and the "Row hover tint" row of docs/BLOCK_UX_REFERENCE.md, both of
 *     which record Notion painting nothing at all on a text Block. So the tint is asserted absent,
 *     not present: reintroducing it is a regression.
 *   - A press keeps the caret where it landed. `onPointerDownCapture` on
 *     `[data-native-block-content]` in markdown-block-row.tsx resolves the point to an offset in the
 *     Block's *editor* text — the projection the surface will actually hold, so a heading's `# ` is
 *     already subtracted — and stashes it; the same element's `onClick` hands that offset to
 *     `onActivate`. When the mapping breaks, the rendered preview is swapped for an editing surface
 *     focused at end-of-Block and clicking into the middle of a Block silently jumps to its end.
 *   - The row's leading spacing strip is `padding-top` on the row, so it belongs to the row and not
 *     to any content. Nothing currently handles a press there: the activation handlers live on the
 *     content box, and `handleDocumentPointerDown` in markdown-block-runtime.tsx returns as soon as
 *     the target is inside a `[data-block-id]`. The tests below assert what a user expects — the
 *     Block activates and takes a caret — and are expected to fail.
 *
 * Every test opens its own Page. Each fixture Block is preceded by one lead paragraph, which does
 * two things: it gives the fixture row a preceding row, and `--row-lead` is set by
 * `[data-native-block-row] + [data-native-block-row]` in editor.css, so a fixture with nothing
 * before it would have no spacing strip at all for the padding tests to aim at; and it keeps a lone
 * `---` away from the top of the file, where it would have to be told apart from frontmatter.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  activate,
  caretOffset,
  clickAway,
  everyKindSource,
  expectSourceUnchanged,
  firstTextRect,
  gutter,
  KIND_FIXTURES,
  type KindFixture,
  kindsInOrder,
  openPage,
  rectOfText,
  rows,
  rowWith,
  surfaceOf,
} from "./harness";

/** Text of the paragraph that precedes every fixture Block. Chosen to share no word with them. */
const LEAD = "Lead paragraph.";

function pageSource(fixture: KindFixture): string {
  return `${LEAD}\n\n${fixture.source}\n`;
}

/**
 * The row holding the fixture Block.
 *
 * Kinds that render no text of their own — a divider, an equation whose payload becomes KaTeX — have
 * nothing to match on, so they are addressed positionally as the row after the lead paragraph.
 */
function fixtureRow(page: Page, fixture: KindFixture): Locator {
  return fixture.word === null ? rows(page).nth(1) : rowWith(page, fixture.word);
}

/**
 * The text of the row's mounted editing surface, in that surface's own coordinate space.
 *
 * A textarea's value is raw source; a contenteditable's `textContent` is the visible projection with
 * Markdown delimiters hidden. Reading the expectation from the same surface that reports the caret is
 * what keeps a source offset from ever being compared against a visible one.
 */
async function surfaceText(row: Locator): Promise<string> {
  return row
    .locator("[data-native-block-editor]")
    .first()
    .evaluate((el) => (el instanceof HTMLTextAreaElement ? el.value : (el.textContent ?? "")));
}

/** Whatever the row's `::after` paints, which is the only pseudo-element in the row's chrome. */
async function rowFillPaint(row: Locator): Promise<{ color: string; image: string }> {
  return row.evaluate((el) => {
    const style = window.getComputedStyle(el, "::after");
    return { color: style.backgroundColor, image: style.backgroundImage };
  });
}

/**
 * The spacing strip above a Block: the part of the row box that sits above its content box.
 *
 * Measured rather than hardcoded, because the value is per kind (`--row-lead` is 1.75rem above an h1
 * and 2px above a paragraph) and moving it in editor.css must move this test with it.
 */
async function leadingStrip(
  row: Locator
): Promise<{ top: number; height: number; contentX: number }> {
  return row.evaluate((el) => {
    const content = el.querySelector("[data-native-block-content]");
    if (!content) throw new Error("row has no content box to measure a leading strip against");
    const rowBox = el.getBoundingClientRect();
    const contentBox = content.getBoundingClientRect();
    return { top: rowBox.top, height: contentBox.top - rowBox.top, contentX: contentBox.left };
  });
}

const activeRows = (page: Page) => page.locator('[data-native-block-row][data-active="true"]');
const selectedRows = (page: Page) =>
  page.locator('[data-native-block-row][data-block-selected="true"]');
const editingSurfaces = (page: Page) => page.locator("[data-native-block-editor]");

for (const fixture of KIND_FIXTURES) {
  test(`${fixture.label}: hovering reveals the gutter controls and paints no row tint`, async ({
    page,
  }) => {
    await openPage(page, `hover ${fixture.label}`, pageSource(fixture));
    const row = fixtureRow(page, fixture);
    const controls = gutter(row);

    // At rest the controls are invisible and unclickable, so the Block reads as plain content.
    await expect(controls).toHaveCSS("opacity", "0");
    const atRest = await rowFillPaint(row);
    expect(atRest.color).toBe("rgba(0, 0, 0, 0)");
    // A gradient counts as paint too, so both channels are read here and again while hovered.
    expect(atRest.image).toBe("none");

    await row.hover();
    await expect(controls).toHaveCSS("opacity", "1");

    // The controls appearing are the entire hover affordance. A background here would be the removed
    // full-column tint coming back, which reads as a short Block inflating into a metre-wide button.
    const hovered = await rowFillPaint(row);
    expect(hovered.color).toBe("rgba(0, 0, 0, 0)");
    expect(hovered.image).toBe("none");
  });
}

/**
 * One Page for every kind rather than one test per kind: the property is that no pixel of the column
 * is dead, and sweeping a single seeded Page is how a pointer actually meets it.
 */
test("hovering anywhere across a row reveals its controls, gutter and spacing strip included", async ({
  page,
}) => {
  await openPage(page, "hover band", everyKindSource());
  const total = await rows(page).count();
  expect(total).toBeGreaterThan(1);

  for (let index = 0; index < total; index += 1) {
    const row = rows(page).nth(index);
    await row.scrollIntoViewIfNeeded();
    const geometry = await row.evaluate((el) => {
      const controls = el.querySelector("[data-native-block-controls]");
      if (!controls) throw new Error("row has no gutter controls");
      const rowBox = el.getBoundingClientRect();
      const controlsBox = controls.getBoundingClientRect();
      const content = el.querySelector("[data-native-block-content]");
      const contentBox = content?.getBoundingClientRect() ?? rowBox;
      return {
        gutterX: controlsBox.left + controlsBox.width / 2,
        contentX: contentBox.left + 8,
        farX: rowBox.left + rowBox.width * 0.95,
        centreY: rowBox.top + rowBox.height / 2,
        stripY: rowBox.top + (contentBox.top - rowBox.top) / 2,
        strip: contentBox.top - rowBox.top,
      };
    });
    const controls = gutter(row);
    const kind = await row.getAttribute("data-block-kind");

    // Over the gutter itself first. The controls are `pointer-events: none` while hidden, so this is
    // also a check that the row underneath still sees the pointer and can reveal them.
    for (const x of [geometry.gutterX, geometry.contentX, geometry.farX]) {
      await page.mouse.move(x, geometry.centreY);
      await expect(controls, `kind ${kind} at x=${Math.round(x)}`).toHaveCSS("opacity", "1");
    }

    // The spacing above a Block is padding on the row, so it is part of the hover band too. Sweeping
    // the gutter from one Block to the next must never cross a strip that drops the controls.
    if (geometry.strip >= 8) {
      await page.mouse.move(geometry.contentX, geometry.stripY);
      await expect(controls, `kind ${kind} in its leading strip`).toHaveCSS("opacity", "1");
    }
  }
});

/**
 * Where the caret lands when the glyphs themselves are pressed.
 *
 * The expectation is read out of the surface the row mounts, never out of the file: a heading's
 * textarea holds `Heading hone alpha` with the `# ` already projected away, so an offset measured
 * against the raw file would be two characters out for reasons that have nothing to do with the
 * press. Two things decide whether the mapping survives, and a failure here is almost always one of
 * them. `textOffsetWithin` counts every text node in the preview that is not `aria-hidden`, so any
 * chrome the preview renders as real text — a callout's `Note` type label, say — is counted as part
 * of the Block's own text and pushes the caret earlier than the press. And for a source-only kind
 * the surface holds the Block's syntax as well as its payload, so the offset the preview yields has
 * to be mapped forward past that syntax rather than used as-is.
 *
 * A toggle fails earlier than either: its `<summary>` calls `event.stopPropagation()`, so the row's
 * `onClick` never runs and `activate` times out waiting for `data-active`. Pressing the title of a
 * Block is how a user asks to edit it, so that is asserted as the caret test it is rather than
 * excused.
 */
for (const fixture of KIND_FIXTURES) {
  // A divider renders an `<hr>` and an equation renders KaTeX, so neither has rendered characters a
  // press can be aimed at or a caret offset can be checked against.
  if (fixture.word === null) continue;
  const word = fixture.word;

  test(`${fixture.label}: a press on the rendered text leaves the caret at the press point`, async ({
    page,
  }) => {
    const opened = await openPage(page, `press ${fixture.label}`, pageSource(fixture));
    const row = fixtureRow(page, fixture);

    // Measured before pressing so a broken aim reports itself as a missing glyph rect rather than as
    // a caret in the wrong place, which looks identical to the product bug this test hunts.
    const anchor = await rectOfText(row, word);
    expect(anchor, `"${word}" must be one rendered text run in this preview`).not.toBeNull();

    await activate(row, word);

    const surface = await surfaceOf(row);
    const text = await surfaceText(row);
    const expected = text.indexOf(word);
    expect(expected, `"${word}" must appear in the ${surface}'s own text`).toBeGreaterThanOrEqual(
      0
    );

    const caret = await caretOffset(page);
    expect(caret.space).not.toBe("none");
    expect(caret.collapsed).toBe(true);
    expect(caret.offset).not.toBeNull();
    const offset = caret.offset ?? -1;
    // `activate` presses 6px into the word, which is inside its first glyph for a wide character and
    // just past the midpoint of a narrow one, so one character of rounding is honest. Anything more
    // means the point-to-offset mapping is wrong; landing on `text.length` means the Block activated
    // with a fresh end-of-Block caret and threw the press away.
    expect(offset, `caret in ${caret.space} space`).toBeGreaterThanOrEqual(expected);
    expect(offset, `caret in ${caret.space} space`).toBeLessThanOrEqual(expected + 1);
    expect(offset).toBeLessThan(text.length);

    await expectSourceUnchanged(opened, pageSource(fixture));
  });
}

for (const fixture of KIND_FIXTURES) {
  // Source-only kinds render as a container — a `<pre>`, an `<aside>`, a grid — whose right-hand
  // space is chrome around the payload rather than the trailing space of a line of prose, so "beside
  // the end of the line" is not a place a user can press on them.
  if (fixture.sourceOnly) continue;

  test(`${fixture.label}: a press right of a short line puts the caret at the line's end`, async ({
    page,
  }) => {
    const opened = await openPage(page, `beside ${fixture.label}`, pageSource(fixture));
    const row = fixtureRow(page, fixture);

    const line = await firstTextRect(row);
    if (!line) throw new Error(`${fixture.label} renders no text to aim beside`);
    const box = await row.boundingBox();
    if (!box) throw new Error(`${fixture.label} row has no box`);

    // 95% of the row width, the measurement recorded in docs/BLOCK_UX_REFERENCE.md: a six-character
    // paragraph pressed there puts the caret at offset 6, which is what Notion does across its own
    // content column. The y stays on the Block's first line so this is "past the end of the text",
    // not "below it".
    await page.mouse.click(box.x + box.width * 0.95, line.y + line.h / 2);
    await expect(row).toHaveAttribute("data-active", "true");

    const text = await surfaceText(row);
    const caret = await caretOffset(page);
    expect(caret.collapsed).toBe(true);
    expect(caret.offset, `caret in ${caret.space} space`).toBe(text.length);

    await expectSourceUnchanged(opened, pageSource(fixture));
  });
}

for (const fixture of KIND_FIXTURES) {
  // Only headings carry a strip worth aiming at: `--row-lead` is 1.75rem above an h1 down to
  // 0.875rem above an h4, while every other kind gets 2px, which is below the width of a pointer and
  // is not a target a user could take aim at either way. The height is still measured, not assumed.
  if (fixture.kind !== "heading") continue;

  test(`${fixture.label}: a press in the row's leading spacing activates the Block`, async ({
    page,
  }) => {
    const opened = await openPage(page, `strip ${fixture.label}`, pageSource(fixture));
    const row = fixtureRow(page, fixture);

    const strip = await leadingStrip(row);
    // The strip has to exist before a press into it can mean anything; if editor.css stops spacing
    // headings with row padding this fails loudly here rather than silently pressing on the glyphs.
    expect(strip.height, `${fixture.label} leading strip height`).toBeGreaterThanOrEqual(8);

    // Over the content column, above the content box: this pixel belongs to the row and to no child,
    // and the pointer handlers that activate a Block are all on the content box. A user reading the
    // Page sees the gap above a heading as part of that heading and expects a caret from it, so this
    // is written for the behaviour they expect and is expected to fail until the row handles it.
    await page.mouse.click(strip.contentX + 24, strip.top + strip.height / 2);
    await expect(row).toHaveAttribute("data-active", "true");

    const caret = await caretOffset(page);
    expect(caret.space).not.toBe("none");
    expect(caret.offset).not.toBeNull();

    // Whatever the row decides to do with that press, it must not be an edit.
    await expectSourceUnchanged(opened, pageSource(fixture));
  });
}

for (const fixture of KIND_FIXTURES) {
  // A toggle's `<summary>` stops the click propagating (markdown-block-row.tsx, the toggle arm of
  // BlockPreview) so the disclosure can own its own gesture. `<details>` without `open` starts
  // closed, so that summary is the whole of the toggle's visible text and there is nowhere else on
  // the Block a pointer could aim instead — the Block cannot be activated by pointer at all. That is
  // asserted once, in the press-point test above; repeating the same failure through every test that
  // only needs an active Block as a precondition would report one product fact five times.
  if (fixture.kind === "toggle") continue;

  test(`${fixture.label}: pressing the margin releases the caret and edits nothing`, async ({
    page,
  }) => {
    const opened = await openPage(page, `release ${fixture.label}`, pageSource(fixture));
    const row = fixtureRow(page, fixture);

    await activate(row, fixture.word ?? undefined);
    await expect(editingSurfaces(page)).toHaveCount(1);

    // `clickAway` presses the editor's own right-hand margin and already asserts that no row stays
    // active. A Block that keeps rendering its editing surface after that looks focused and is not:
    // `document.activeElement` has fallen back to `<body>` while the raw delimiters are still shown.
    await clickAway(page);
    await expect(row).toHaveAttribute("data-active", "false");
    await expect(editingSurfaces(page)).toHaveCount(0);

    // A press in the margin must never append or rewrite anything. One click 60px below a one-line
    // Page once appended an empty paragraph and autosave wrote it to disk.
    await expectSourceUnchanged(opened, pageSource(fixture));
  });

  test(`${fixture.label}: Escape selects the Block, and Escape again selects nothing`, async ({
    page,
  }) => {
    const opened = await openPage(page, `escape ${fixture.label}`, pageSource(fixture));
    const row = fixtureRow(page, fixture);

    await activate(row, fixture.word ?? undefined);

    // Step one: the caret becomes a Block selection. This is the two-step Notion has, and it is what
    // makes the keyboard useful without a pointer — the Block is now the thing Backspace deletes.
    await page.keyboard.press("Escape");
    await expect(row).toHaveAttribute("data-block-selected", "true");
    await expect(row).toHaveAttribute("data-active", "false");
    await expect(editingSurfaces(page)).toHaveCount(0);
    // Focus has to follow the selection onto the row, or the second Escape reaches nothing.
    await expect(row).toBeFocused();

    // Step two: the selection clears. Escape collapsing straight past the selection in one press
    // would make "select this Block" unreachable from the keyboard.
    await page.keyboard.press("Escape");
    await expect(selectedRows(page)).toHaveCount(0);
    await expect(activeRows(page)).toHaveCount(0);

    await expectSourceUnchanged(opened, pageSource(fixture));
  });
}

test("activating a Block releases the previous one, so exactly one surface is ever mounted", async ({
  page,
}) => {
  const source = everyKindSource();
  const opened = await openPage(page, "one surface", source);
  const kinds = await kindsInOrder(page);
  expect(kinds.length).toBeGreaterThan(1);

  let previous: Locator | null = null;
  for (let index = 0; index < kinds.length; index += 1) {
    // A toggle cannot be activated by pointer at all; see the note above the release tests.
    if (kinds[index] === "toggle") continue;
    const row = rows(page).nth(index);
    await activate(row);
    if (previous) await expect(previous).toHaveAttribute("data-active", "false");
    // Two mounted surfaces means two carets, and the second keystroke goes somewhere the user is not
    // looking. This is the invariant that makes the whole Page behave like one document.
    await expect(activeRows(page)).toHaveCount(1);
    await expect(editingSurfaces(page)).toHaveCount(1);
    previous = row;
  }

  await expectSourceUnchanged(opened, source);
});

test("moving the caret between a raw and a semantic Block leaves one surface behind", async ({
  page,
}) => {
  // The two surfaces are different elements: a Block with inline marks projects them away and edits
  // through the contenteditable, a Block without them edits as a raw textarea. Crossing between the
  // two is where a stale surface would survive, because React unmounts one and mounts the other.
  const source = "Plain alpha text.\n\nMarked **bravo** text.\n";
  const opened = await openPage(page, "surface crossing", source);
  const plain = rowWith(page, "Plain");
  const marked = rowWith(page, "Marked");

  await activate(plain, "Plain");
  expect(await surfaceOf(plain)).toBe("textarea");
  await expect(editingSurfaces(page)).toHaveCount(1);

  await activate(marked, "Marked");
  expect(await surfaceOf(marked)).toBe("contenteditable");
  await expect(plain).toHaveAttribute("data-active", "false");
  await expect(activeRows(page)).toHaveCount(1);
  await expect(editingSurfaces(page)).toHaveCount(1);

  await activate(plain, "Plain");
  expect(await surfaceOf(plain)).toBe("textarea");
  await expect(marked).toHaveAttribute("data-active", "false");
  await expect(editingSurfaces(page)).toHaveCount(1);

  await expectSourceUnchanged(opened, source);
});
