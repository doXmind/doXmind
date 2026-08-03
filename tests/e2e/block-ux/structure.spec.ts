import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  KIND_FIXTURES,
  activate,
  caretOffset,
  expectSourceUnchanged,
  kindsInOrder,
  pressLineStart,
  openPage,
  readSource,
  rowWith,
  rows,
  surfaceOf,
  type OpenedPage,
} from "./harness";

/**
 * Structure: splitting, merging, indenting, and moving the caret between Blocks.
 *
 * This is the dimension where a mistake is written to the user's file. Every other dimension can fail
 * and leave the Markdown untouched; Enter, Backspace and Tab all rewrite source bytes, so every test
 * here ends at the file rather than at the DOM. Where a keystroke is supposed to be inert — arrows,
 * and Tab on prose — the file being byte-identical *is* the assertion.
 *
 * Source-only kinds are skipped throughout. `isMarkdownSourceOnlyBlockKind` in
 * markdown-block-document.ts refuses `split` for them and `mergeBackward` returns the snapshot
 * unchanged, and the row handler lets Enter fall through to the textarea so it inserts a literal
 * newline inside the one Block. A fenced code Block, an equation, a callout, a toggle, a table, a
 * divider and a raw HTML Block therefore have no split, merge or indent behaviour to measure here:
 * Tab means two literal spaces for code and equations, and cell navigation for a table. Those belong
 * to their own dimensions.
 */

interface TextBlockFixture {
  readonly label: string;
  readonly kind: string;
  readonly source: string;
  /** The Markdown marker the editing projection hides, so `text` is what the surface shows. */
  readonly marker: string;
  /** The Block's payload — the exact value of its textarea. */
  readonly text: string;
  readonly word: string;
}

/**
 * The Markdown markers `createBlockEditingProjection` strips from the editing surface.
 *
 * Matched in this order deliberately: a to-do's `- [ ] ` has to win over a bullet's `- `, or every
 * offset computed for a to-do would be four characters out.
 */
const BLOCK_MARKER = /^(?:#{1,6} |- \[ \] |[-+*] |\d+[.)] |> )/;

const LIST_KINDS = new Set(["bullet_list_item", "ordered_list_item", "task_list_item"]);

const TEXT_BLOCKS: readonly TextBlockFixture[] = KIND_FIXTURES.flatMap((fixture) => {
  if (fixture.sourceOnly || fixture.word === null) return [];
  const marker = fixture.source.match(BLOCK_MARKER)?.[0] ?? "";
  return [
    {
      label: fixture.label,
      kind: fixture.kind,
      source: fixture.source,
      marker,
      text: fixture.source.slice(marker.length),
      word: fixture.word,
    },
  ];
});

/** The marker a following sibling of the same kind carries; an ordered item advances its ordinal. */
function continuationMarker(fixture: TextBlockFixture): string {
  if (fixture.kind === "ordered_list_item") {
    return fixture.marker.replace(/^\d+/, (ordinal) => String(Number(ordinal) + 1));
  }
  return fixture.marker;
}

/**
 * Poll the file until it holds exactly `expected`.
 *
 * Autosave is debounced, so a bare read races the write. The harness only has the "still unchanged"
 * form; anything that mutates needs this one.
 */
async function expectSource(opened: OpenedPage, expected: string): Promise<void> {
  await expect.poll(() => readSource(opened), { timeout: 5000 }).toBe(expected);
}

/**
 * Put the caret at an exact offset in the active row's textarea.
 *
 * Deliberately keyboard-driven rather than a click at a computed point: a click lands on whichever
 * glyph happens to be under it, and being one character out would surface later as a split in the
 * wrong place — a failure that reads like a product bug in `split` rather than a bad test. Going to
 * the very start of the field first and then stepping forward is the technique `selectWord` uses, for
 * the same reason.
 *
 * None of the fixtures here carry inline Markdown, so `inlineProjection.visibleText === source` and
 * the surface is always the raw textarea. That is what makes every offset in this file a source
 * offset over the Block's payload, and it is asserted rather than assumed.
 */
async function placeCaret(page: Page, row: Locator, offset: number): Promise<void> {
  const editor = row.locator("[data-native-block-editor]").first();
  await expect(editor).toBeFocused();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home");
  if ((await caretOffset(page)).offset !== 0) {
    // The same fallback `selectWord` carries, and for the same reason: "go to the very start" has no
    // one binding across platforms, and a helper that quietly stayed where it was would report a
    // split in the wrong place, which reads as a bug in `split` rather than in the test. Every
    // fixture here has a single-line payload, so the line-start binding is offset 0.
    await pressLineStart(page);
  }
  await expect.poll(async () => (await caretOffset(page)).offset).toBe(0);
  for (let index = 0; index < offset; index += 1) await page.keyboard.press("ArrowRight");
  const caret = await caretOffset(page);
  expect(caret.space, `expected a textarea, got a ${await surfaceOf(row)} surface`).toBe("source");
  expect(caret.offset, "the caret could not be placed").toBe(offset);
}

/*
 * Enter at the end of a Block.
 *
 * The user's expectation is "give me a fresh Block below and put my caret in it". A list item has to
 * continue the list at the same marker and depth — landing in a paragraph would end the list and
 * reflow every following sibling — while a heading must not spawn another heading, because nobody
 * writes two headings in a row and both reference products drop to plain text there. The new Block
 * carries no bytes until something is typed into it, so the file is asserted after typing a word:
 * that is the only way to prove the new Block is wired to the right place in the source.
 */
for (const fixture of TEXT_BLOCKS) {
  test(`${fixture.label}: Enter at the end of the Block opens a new empty Block after it`, async ({
    page,
  }) => {
    const opened = await openPage(page, "Split", `${fixture.source}\n`);
    const row = rows(page).first();
    await activate(row);
    await placeCaret(page, row, fixture.text.length);

    await page.keyboard.press("Enter");

    await expect(rows(page)).toHaveCount(2);
    const continued = LIST_KINDS.has(fixture.kind);
    expect(await kindsInOrder(page)).toEqual([
      fixture.kind,
      continued ? fixture.kind : "paragraph",
    ]);
    const next = rows(page).nth(1);
    await expect(next).toHaveAttribute("data-active", "true");
    await expect(next.locator("[data-native-block-editor]")).toHaveValue("");

    // Typing lands in the new Block, and the file gains exactly one line for it: a single newline
    // inside a list, a blank line between two prose Blocks.
    await page.keyboard.type("next");
    const boundary = continued ? "\n" : "\n\n";
    const tail = continued ? continuationMarker(fixture) : "";
    await expectSource(opened, `${fixture.source}${boundary}${tail}next\n`);
  });
}

/*
 * Enter in the middle of a Block.
 *
 * The text divides at the caret and the tail keeps the Block's identity, which for a Markdown file
 * means the tail is written with its own marker. An ordered item advances its ordinal. A heading
 * stays a heading, the way splitting a heading does in both Notion and Feishu — the "drop to plain
 * text" rule belongs to Enter at the *end* of a heading, not to a cut through its words. A list
 * split already writes the tail's marker, from `listItemSyntax`'s `nextPrefix`; a heading's tail is
 * built by handing the bare text to `blockFromSource`, which has no `#` to classify and so returns a
 * paragraph. A user who cuts a long heading in two gets a heading and a stray line of body text.
 *
 * A blockquote is the one deliberate exception in the product's model: `split` inserts a `> `
 * continuation line rather than cutting a second Block, so the file keeps one blockquote that any
 * Markdown reader renders as two lines of the same quote.
 */
for (const fixture of TEXT_BLOCKS) {
  test(`${fixture.label}: Enter in the middle divides the Block at the caret`, async ({ page }) => {
    const opened = await openPage(page, "Split", `${fixture.source}\n`);
    const row = rows(page).first();
    await activate(row);
    // Two characters into the fixture's landmark word, so the cut lands inside a word rather than on
    // whitespace, where a stray trailing space could hide a boundary bug.
    const at = fixture.text.indexOf(fixture.word) + 2;
    await placeCaret(page, row, at);
    const left = fixture.text.slice(0, at);
    const right = fixture.text.slice(at);

    await page.keyboard.press("Enter");

    if (fixture.kind === "blockquote") {
      await expect(rows(page)).toHaveCount(1);
      expect(await kindsInOrder(page)).toEqual(["blockquote"]);
      await expectSource(opened, `> ${left}\n> ${right}\n`);
      // The caret sits at the start of the second quote line, so typing continues it.
      //
      // This offset used to count the `> ` markers as well, because a multi-line quote gave up on
      // projecting and put its raw source in the surface. It no longer does — every line's marker is
      // hidden now — so the caret is measured where the user sees it: the text before the cut, plus
      // the newline. The surface is still a textarea (a quote holding a newline cannot use the
      // semantic editor), which is asserted rather than assumed, but what it holds is the projection.
      const caret = await caretOffset(page);
      expect(caret.space, "a multi-line quote still edits in a textarea").toBe("source");
      expect(caret.offset).toBe(left.length + 1);
      return;
    }

    await expect(rows(page)).toHaveCount(2);
    expect(await kindsInOrder(page)).toEqual([fixture.kind, fixture.kind]);
    const boundary = LIST_KINDS.has(fixture.kind) ? "\n" : "\n\n";
    await expectSource(
      opened,
      `${fixture.marker}${left}${boundary}${continuationMarker(fixture)}${right}\n`
    );
    // The caret is at the start of the tail's payload, in front of the text that moved down with it.
    await expect(rows(page).nth(1)).toHaveAttribute("data-active", "true");
    expect((await caretOffset(page)).offset).toBe(0);
  });
}

/*
 * Enter on an empty list item.
 *
 * Two presses, two different meanings, and neither may add another empty item — an editor that
 * stacked empty bullets would make leaving a list impossible without reaching for the mouse. On a
 * nested item Enter outdents by one level; on a top-level item it ends the list and leaves a
 * paragraph behind. Each run starts from a real nested item, so the first press also proves a
 * continuation keeps its parent's marker *and* its depth, which is what stops the following siblings
 * reflowing.
 */
interface NestedListCase {
  readonly label: string;
  readonly parent: string;
  readonly child: string;
  /** Marker of a fresh sibling of `child`, at `child`'s depth. */
  readonly continued: string;
  /** Marker that same item carries once it has been outdented to the top level. */
  readonly outdented: string;
}

const NESTED_LIST_CASES: readonly NestedListCase[] = [
  {
    label: "bulleted list",
    parent: "- Alpha",
    child: "  - Bravo",
    continued: "  - ",
    outdented: "- ",
  },
  {
    label: "numbered list",
    parent: "1. Alpha",
    child: "   1. Bravo",
    continued: "   2. ",
    outdented: "2. ",
  },
  {
    label: "to-do",
    parent: "- [ ] Alpha",
    child: "  - [ ] Bravo",
    continued: "  - [ ] ",
    outdented: "- [ ] ",
  },
];

for (const listCase of NESTED_LIST_CASES) {
  test(`${listCase.label}: Enter on an empty nested item outdents, then ends the list`, async ({
    page,
  }) => {
    const source = `${listCase.parent}\n${listCase.child}\n`;
    const opened = await openPage(page, "Lists", source);
    const child = rowWith(page, "Bravo");
    await activate(child);
    await placeCaret(page, child, "Bravo".length);

    // One: continue the list at the child's own depth, carrying the child's own marker.
    await page.keyboard.press("Enter");
    await expect(rows(page)).toHaveCount(3);
    const fresh = rows(page).nth(2);
    await expect(fresh).toHaveAttribute("data-block-depth", "1");
    await expect(fresh.locator("[data-native-block-editor]")).toHaveValue("");
    await expectSource(opened, `${source}${listCase.continued}\n`);

    // Two: the item is empty, so Enter lifts it out one level instead of adding another one.
    await page.keyboard.press("Enter");
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).nth(2)).toHaveAttribute("data-block-depth", "0");
    await expectSource(opened, `${source}${listCase.outdented}\n`);

    // Three: nowhere left to outdent to, so the list ends and the Block becomes prose.
    await page.keyboard.press("Enter");
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).nth(2)).toHaveAttribute("data-block-kind", "paragraph");
    await page.keyboard.type("next");
    await expectSource(opened, `${source}\nnext\n`);
  });
}

/*
 * Backspace at offset 0.
 *
 * The keystroke has to leave the caret exactly where the two texts met, or the next character lands
 * in the wrong place and the user's sentence comes out scrambled. For a list item or a quote the
 * first press strips the marker in place — Notion's two-step, where Backspace first turns the item
 * into plain text and only the second press joins it upwards — so both presses are exercised and the
 * file is checked in between.
 */
for (const fixture of TEXT_BLOCKS) {
  test(`${fixture.label}: Backspace at offset 0 joins the Block into the one above`, async ({
    page,
  }) => {
    const opened = await openPage(page, "Merge", `Alpha\n\n${fixture.source}\n`);
    const row = rows(page).nth(1);
    await activate(row);
    await placeCaret(page, row, 0);

    if (LIST_KINDS.has(fixture.kind) || fixture.kind === "blockquote") {
      await page.keyboard.press("Backspace");
      // Still two Blocks and both texts, but the marker is gone and the caret has not moved.
      await expect(rows(page)).toHaveCount(2);
      await expect(rows(page).nth(1)).toHaveAttribute("data-block-kind", "paragraph");
      await expectSource(opened, `Alpha\n\n${fixture.text}\n`);
      expect((await caretOffset(page)).offset).toBe(0);
    }

    await page.keyboard.press("Backspace");

    await expect(rows(page)).toHaveCount(1);
    // A marker is a delimiter, not prose. Joining a heading onto a paragraph must not leave a literal
    // `#` sitting in the middle of the user's sentence. `mergeBackward` takes the joined text from
    // `contentFrom` of the *list* syntax only, which is 0 for a heading, so the `#` travels with the
    // words; `plainBlockContent`, one function away, is what already strips a marker on the list and
    // quote unwrap path.
    await expectSource(opened, `Alpha${fixture.text}\n`);
    expect(
      (await caretOffset(page)).offset,
      "the caret must land at the join, not at either end of the merged Block"
    ).toBe("Alpha".length);

    await page.keyboard.type("X");
    await expectSource(opened, `AlphaX${fixture.text}\n`);
  });
}

/*
 * Backspace at offset 0 of the very first Block.
 *
 * There is nothing above to join to, so the Block and its text have to survive. For prose the
 * keystroke is completely inert and the file stays byte-identical — losing the only Block on a Page
 * to a stray Backspace would be data loss. For a list item or a quote the marker still comes off,
 * because that is an edit within the one Block and it is how both reference products let you leave a
 * list you started by mistake; the text itself still survives.
 */
for (const fixture of TEXT_BLOCKS) {
  test(`${fixture.label}: Backspace at offset 0 of the first Block keeps the Block and its text`, async ({
    page,
  }) => {
    const source = `${fixture.source}\n`;
    const opened = await openPage(page, "First", source);
    const row = rows(page).first();
    await activate(row);
    await placeCaret(page, row, 0);

    await page.keyboard.press("Backspace");

    await expect(rows(page)).toHaveCount(1);
    await expect(row).toHaveAttribute("data-active", "true");
    await expect(row.locator("[data-native-block-editor]")).toHaveValue(fixture.text);
    expect((await caretOffset(page)).offset).toBe(0);
    if (LIST_KINDS.has(fixture.kind) || fixture.kind === "blockquote") {
      await expectSource(opened, `${fixture.text}\n`);
      return;
    }
    await expectSourceUnchanged(opened, source);
  });
}

/*
 * Tab and Shift+Tab on a list item.
 *
 * Indenting is a source rewrite: the item gains leading whitespace measured against its new parent's
 * content column, and `data-block-depth` is the rendered consequence. Getting the width wrong is not
 * cosmetic — four leading spaces make Markdown read the line as indented code and the item silently
 * stops being a list item. Outdenting has to hand back the original bytes exactly, and neither
 * direction may move the caret, because Tab is a structural key here and the user is still typing.
 */
interface IndentCase {
  readonly label: string;
  readonly first: string;
  readonly second: string;
  /** `second` after one indent step, measured against `first`'s content column. */
  readonly indented: string;
}

const INDENT_CASES: readonly IndentCase[] = [
  { label: "bulleted list", first: "- Alpha", second: "- Bravo", indented: "  - Bravo" },
  { label: "numbered list", first: "1. Alpha", second: "2. Bravo", indented: "   2. Bravo" },
  {
    label: "to-do",
    first: "- [ ] Alpha",
    second: "- [ ] Bravo",
    indented: "  - [ ] Bravo",
  },
];

for (const indentCase of INDENT_CASES) {
  test(`${indentCase.label}: Tab indents the item and Shift+Tab puts it back`, async ({ page }) => {
    const source = `${indentCase.first}\n${indentCase.second}\n`;
    const opened = await openPage(page, "Indent", source);
    const row = rowWith(page, "Bravo");
    await activate(row);
    await expect(row).toHaveAttribute("data-block-depth", "0");
    await placeCaret(page, row, 3);

    await page.keyboard.press("Tab");

    await expect(row).toHaveAttribute("data-block-depth", "1");
    await expectSource(opened, `${indentCase.first}\n${indentCase.indented}\n`);
    expect((await caretOffset(page)).offset, "indenting moved the caret").toBe(3);

    await page.keyboard.press("Shift+Tab");

    await expect(row).toHaveAttribute("data-block-depth", "0");
    await expectSource(opened, source);
    expect((await caretOffset(page)).offset, "outdenting moved the caret").toBe(3);
  });
}

/*
 * Tab on prose.
 *
 * Nothing about a paragraph, a heading or a quote is indentation-significant, so Tab has nothing to
 * do — but it must not do it *badly*: no literal tab written into the file, no leading spaces that
 * would turn the line into indented code, and no losing the caret to the browser's next tab stop,
 * which would drop the user's place in the Page.
 */
for (const fixture of TEXT_BLOCKS.filter((candidate) => !LIST_KINDS.has(candidate.kind))) {
  test(`${fixture.label}: Tab leaves the source untouched`, async ({ page }) => {
    const source = `${fixture.source}\n`;
    const opened = await openPage(page, "Inert", source);
    const row = rows(page).first();
    await activate(row);
    await placeCaret(page, row, 3);

    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");

    // The editor's value is the live detector: had Tab written anything, the surface would show it.
    await expect(row.locator("[data-native-block-editor]")).toHaveValue(fixture.text);
    await expect(row).toHaveAttribute("data-active", "true");
    await expect(row).toHaveAttribute("data-block-kind", fixture.kind);
    await expectSourceUnchanged(opened, source);
  });
}

/*
 * Crossing Blocks with the arrow keys.
 *
 * A Page of Blocks has to feel like one long field. Two paragraphs carrying identical text make the
 * goal column testable: identical glyphs mean the column the caret left is the same character offset
 * it should arrive at, so a caret that collapsed to 0 or jumped to the end is unambiguous.
 */
const COLUMN_LINE = "Alpha bravo charlie delta echo foxtrot.";
const COLUMN_SOURCE = `${COLUMN_LINE}\n\n${COLUMN_LINE}\n`;
const GOAL_COLUMN = 10;

test("ArrowDown from the last line enters the next Block at the same column", async ({ page }) => {
  const opened = await openPage(page, "Columns", COLUMN_SOURCE);
  const first = rows(page).nth(0);
  await activate(first);
  await placeCaret(page, first, GOAL_COLUMN);

  await page.keyboard.press("ArrowDown");

  await expect(rows(page).nth(1)).toHaveAttribute("data-active", "true");
  const landed = await caretOffset(page);
  // Both paragraphs carry the same plain text, so both surfaces are the raw textarea and the
  // arrival offset is in the same space as the departure offset. Comparing a visible offset against
  // a source column would be meaningless, so the space is checked rather than trusted.
  expect(landed.space, "the destination is not the raw textarea the column was measured in").toBe(
    "source"
  );
  expect(landed.offset, "the caret collapsed instead of keeping its column").not.toBe(0);
  // Hit-testing the destination's glyphs rounds to the nearest character boundary, so a character
  // either side is the same column; anything further means the column was thrown away.
  expect(Math.abs((landed.offset ?? -1) - GOAL_COLUMN)).toBeLessThanOrEqual(2);
  await expectSourceUnchanged(opened, COLUMN_SOURCE);
});

test("ArrowUp from the first line enters the previous Block at the same column", async ({
  page,
}) => {
  const opened = await openPage(page, "Columns", COLUMN_SOURCE);
  const second = rows(page).nth(1);
  await activate(second);
  await placeCaret(page, second, GOAL_COLUMN);

  await page.keyboard.press("ArrowUp");

  await expect(rows(page).nth(0)).toHaveAttribute("data-active", "true");
  const landed = await caretOffset(page);
  expect(landed.space, "the destination is not the raw textarea the column was measured in").toBe(
    "source"
  );
  expect(landed.offset, "the caret collapsed instead of keeping its column").not.toBe(0);
  expect(Math.abs((landed.offset ?? -1) - GOAL_COLUMN)).toBeLessThanOrEqual(2);
  await expectSourceUnchanged(opened, COLUMN_SOURCE);
});

test("keyboard navigation keeps the active Block clear of fixed editor chrome", async ({
  page,
}) => {
  const source = Array.from({ length: 30 }, (_, index) => `Block ${index + 1}.`).join("\n\n");
  const opened = await openPage(page, "Chrome clearance", source);
  const target = rows(page).nth(20);
  const current = rows(page).nth(21);

  await page.locator("[data-native-markdown-scroll]").evaluate((scroll, targetIndex) => {
    const targetRow = scroll.querySelectorAll<HTMLElement>("[data-native-block-row]")[targetIndex];
    if (targetRow) scroll.scrollTop = targetRow.offsetTop - 60;
  }, 20);
  await activate(current);
  await placeCaret(page, current, 0);
  await page.keyboard.press("ArrowUp");

  await expect(target).toHaveAttribute("data-active", "true");
  await expect
    .poll(() =>
      target.evaluate((row) => {
        const scroll = row.closest<HTMLElement>("[data-native-markdown-scroll]");
        if (!scroll) return false;
        return row.getBoundingClientRect().top >= scroll.getBoundingClientRect().top + 80;
      })
    )
    .toBe(true);
  await expectSourceUnchanged(opened, source);
});

test("ArrowDown walks a wrapped paragraph's own lines before leaving it", async ({ page }) => {
  // Long enough to wrap several times at the 1440px viewport the harness sets, so the caret has
  // visual lines of its own to walk. A Block that handed ArrowDown straight to the next Block would
  // make the middle of a long paragraph unreachable from the keyboard.
  const sentence = "Wrapped paragraph text that has to run past the end of one rendered line. ";
  const wrapped = `${sentence.repeat(5)}End.`;
  const source = `${wrapped}\n\nFollowing paragraph.\n`;
  const opened = await openPage(page, "Wrapped", source);
  const first = rows(page).nth(0);
  await activate(first);
  await placeCaret(page, first, 0);

  await page.keyboard.press("ArrowDown");

  await expect(first).toHaveAttribute("data-active", "true");
  await expect(rows(page).nth(1)).toHaveAttribute("data-active", "false");
  const insideBlock = await caretOffset(page);
  expect(
    insideBlock.offset,
    "the caret did not move onto the paragraph's second visual line"
  ).not.toBe(0);

  // Keep going and the caret does leave, from the last visual line.
  let crossed = false;
  for (let press = 0; press < 12 && !crossed; press += 1) {
    await page.keyboard.press("ArrowDown");
    crossed = (await rows(page).nth(1).getAttribute("data-active")) === "true";
  }
  expect(crossed, "ArrowDown never reached the Block below the wrapped paragraph").toBe(true);
  await expectSourceUnchanged(opened, source);
});

test("arrows and Tab alone never touch the file", async ({ page }) => {
  // Tab is pressed only on prose here. On a list item Tab is an indent and is supposed to rewrite
  // the source, which is asserted separately above.
  const source = "# Title alpha\n\nBody paragraph beta.\n\n- Item gamma\n- Item delta\n";
  const opened = await openPage(page, "Walk", source);
  const heading = rowWith(page, "Title alpha");
  const body = rowWith(page, "Body paragraph beta.");
  await activate(heading);
  await placeCaret(page, heading, 0);
  await page.keyboard.press("Tab");
  await expect(heading).toHaveAttribute("data-active", "true");

  await page.keyboard.press("ArrowDown");
  await expect(body).toHaveAttribute("data-active", "true");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(body).toHaveAttribute("data-active", "true");

  await page.keyboard.press("ArrowDown");
  await expect(rowWith(page, "Item gamma")).toHaveAttribute("data-active", "true");
  await page.keyboard.press("ArrowDown");
  await expect(rowWith(page, "Item delta")).toHaveAttribute("data-active", "true");
  // Each hop is asserted on its own. Three presses followed by one assertion cannot say which
  // crossing failed, and a walk back up the Page is exactly where an off-by-one in the target search
  // hides.
  await page.keyboard.press("ArrowUp");
  await expect(rowWith(page, "Item gamma")).toHaveAttribute("data-active", "true");
  await page.keyboard.press("ArrowUp");
  await expect(body).toHaveAttribute("data-active", "true");
  await page.keyboard.press("ArrowUp");
  await expect(heading).toHaveAttribute("data-active", "true");

  // Horizontal crossings land on the Blocks' source edges: ArrowRight past the end of a Block puts
  // the caret at offset 0 of the next one, and ArrowLeft at offset 0 puts it back at the end.
  await placeCaret(page, heading, "Title alpha".length);
  await page.keyboard.press("ArrowRight");
  await expect(body).toHaveAttribute("data-active", "true");
  expect((await caretOffset(page)).offset).toBe(0);
  await page.keyboard.press("ArrowLeft");
  await expect(heading).toHaveAttribute("data-active", "true");
  expect((await caretOffset(page)).offset).toBe("Title alpha".length);

  await expect(heading.locator("[data-native-block-editor]")).toBeFocused();
  await expectSourceUnchanged(opened, source);
});
