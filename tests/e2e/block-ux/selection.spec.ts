import { expect, test } from "@playwright/test";

import {
  KIND_FIXTURES,
  activate,
  clickAway,
  openPage,
  rectOfText,
  rows,
  selectWord,
  selectionState,
  surfaceOf,
  toolbarState,
} from "./harness";

/**
 * Selecting text, per Block kind.
 *
 * One test per kind so a failure names the Block rather than "selection is broken". Each kind gets
 * its own Page so indices are unambiguous and one kind's Blocks cannot shift another's.
 */

for (const fixture of KIND_FIXTURES.filter((candidate) => candidate.word !== null)) {
  const word = fixture.word!;

  test(`${fixture.label}: a drag across a word selects it when the Block is already active`, async ({
    page,
  }) => {
    // Known defect, tracked rather than asserted away: a toggle's whole `<summary>` is the
    // disclosure control, so pressing its text opens and closes the toggle instead of activating the
    // Block, and no editing surface ever appears. Delete this annotation when the toggle separates
    // its triangle from its label.
    if (fixture.kind === "toggle") test.fail();
    await openPage(page, "Sel", `${fixture.source}\n`);
    const row = rows(page).first();
    await activate(row);

    const { technique } = await selectWord(page, row, word);
    expect(technique, "no way to select in this surface").not.toBe("unavailable");
    const selection = await selectionState(page);
    expect(
      selection.text,
      `selected ${JSON.stringify(selection.text)} via ${technique} on a ${await surfaceOf(row)}`
    ).toContain(word);
  });

  test(`${fixture.label}: a drag across a word selects it when the Block is NOT yet active`, async ({
    page,
  }) => {
    // Known defects for the three kinds whose preview is not a linear rendering of their source, so
    // a point in the preview cannot be mapped to a source offset the way it can for prose:
    //   toggle   - the press never activates the Block at all (see the note above)
    //   callout  - the icon and "Note" label shift the mapping, so the range comes back short
    //              ("Callo" when asked for "citem")
    //   table    - a grid has no linear point-to-offset mapping; cells carry their own offsets
    //              instead, which gives a caret but not a range
    // All three are the same underlying gap: these kinds swap their rendered view for raw Markdown
    // on activation. Delete each annotation as that kind gains in-place editing.
    if (fixture.kind === "toggle" || fixture.kind === "callout" || fixture.kind === "table") {
      test.fail();
    }
    await openPage(page, "Sel", `${fixture.source}\n`);
    const row = rows(page).first();
    await clickAway(page);

    // The press both activates the Block and starts the drag — what a user does when they select
    // text in a Block they are not already editing.
    const rect = await rectOfText(row, word);
    expect(rect, "the word is not rendered in the unfocused Block").not.toBeNull();
    await page.mouse.move(rect!.x + 1, rect!.y + rect!.h / 2);
    await page.mouse.down();
    await page.mouse.move(rect!.x + rect!.w * 0.5, rect!.y + rect!.h / 2, { steps: 5 });
    await page.mouse.move(rect!.x + rect!.w - 1, rect!.y + rect!.h / 2, { steps: 5 });
    await page.mouse.up();

    const selection = await selectionState(page);
    expect(
      selection.text,
      `a cold drag selected ${JSON.stringify(selection.text)} on a ${await surfaceOf(row)}`
    ).toContain(word);
  });

  test(`${fixture.label}: a double-click selects a word`, async ({ page }) => {
    // Same toggle defect: without activation there is no surface to double-click into.
    if (fixture.kind === "toggle") test.fail();
    await openPage(page, "Sel", `${fixture.source}\n`);
    const row = rows(page).first();
    await activate(row);

    const rect = await rectOfText(row, word);
    const editor = row.locator("[data-native-block-editor]").first();
    const box = rect ?? (await editor.boundingBox());
    expect(box, "nothing to double-click").not.toBeNull();
    const x = rect ? rect.x + rect.w / 2 : (box as { x: number }).x + 20;
    const y = rect ? rect.y + rect.h / 2 : (box as { y: number }).y + 10;
    await page.mouse.dblclick(x, y);

    const selection = await selectionState(page);
    expect(selection.text.trim(), "double-click selected nothing").not.toBe("");
  });
}

/**
 * The inline format toolbar, per Block kind.
 *
 * `sourceOnly` kinds edit as raw Markdown, where the delimiters are literal text and inline
 * formatting is not a meaningful operation, so they are expected NOT to offer the toolbar. Text kinds
 * must offer it, and must report the format under the selection correctly.
 */
for (const fixture of KIND_FIXTURES.filter(
  (candidate) => candidate.word !== null && !candidate.sourceOnly
)) {
  const word = fixture.word!;

  test(`${fixture.label}: selecting text offers the inline toolbar`, async ({ page }) => {
    await openPage(page, "Bar", `${fixture.source}\n`);
    const row = rows(page).first();
    await activate(row);
    await selectWord(page, row, word);

    const toolbar = await toolbarState(page);
    const selection = await selectionState(page);
    expect(
      toolbar.present,
      `no toolbar for a ${JSON.stringify(selection.text)} selection on a ${await surfaceOf(row)}`
    ).toBe(true);
  });

  test(`${fixture.label}: the toolbar reports inline code under the selection`, async ({
    page,
  }) => {
    // `codetoken` is wrapped in backticks, so the projection hides the delimiters and the surface is
    // the semantic editor. The toolbar must mark Inline code active and nothing else.
    const source = fixture.source.replace(word, "`codetoken`");
    await openPage(page, "Bar", `${source}\n`);
    const row = rows(page).first();
    await activate(row);
    const { technique } = await selectWord(page, row, "codetoken");
    expect(technique).not.toBe("unavailable");

    const toolbar = await toolbarState(page);
    const selection = await selectionState(page);
    expect(toolbar.present, `no toolbar; selection was ${JSON.stringify(selection.text)}`).toBe(
      true
    );
    expect(toolbar.pressed["Inline code"], "Inline code not reported as active").toBe("true");
    expect(toolbar.pressed.Bold, "Bold wrongly reported active").toBe("false");
    expect(toolbar.pressed.Italic, "Italic wrongly reported active").toBe("false");
  });

  test(`${fixture.label}: the toolbar reports bold under the selection`, async ({ page }) => {
    const source = fixture.source.replace(word, "**boldtoken**");
    await openPage(page, "Bar", `${source}\n`);
    const row = rows(page).first();
    await activate(row);
    const { technique } = await selectWord(page, row, "boldtoken");
    expect(technique).not.toBe("unavailable");

    const toolbar = await toolbarState(page);
    expect(toolbar.present).toBe(true);
    expect(toolbar.pressed.Bold, "Bold not reported as active").toBe("true");
    expect(toolbar.pressed["Inline code"], "Inline code wrongly reported active").toBe("false");
  });

  test(`${fixture.label}: the toolbar names the Block type`, async ({ page }) => {
    await openPage(page, "Bar", `${fixture.source}\n`);
    const row = rows(page).first();
    await activate(row);
    await selectWord(page, row, word);

    const toolbar = await toolbarState(page);
    expect(toolbar.present).toBe(true);
    // The product's own wording, not the fixture's: a paragraph's chip reads "Text".
    expect(toolbar.typeLabel, "the toolbar names the wrong Block type").toBe(fixture.toolbarType);
  });
}
