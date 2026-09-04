import { expect, test, type Locator, type Page } from "@playwright/test";

// One worker per file is what made this suite 38 minutes: `fullyParallel: false` in
// playwright.config.ts keeps a file's tests serial, so history.spec.ts alone held a worker for 18.4
// minutes while the other idled — Playwright's own run summary says "Consider running tests from
// slow files in parallel." Every test here opens its own `mkdtemp` workspace through `openPage`, so
// there is no shared state to serialise for. The specs that DO share a fixed directory
// (browsing-runtime, import-conflict, knowledge-editor-gui-acceptance, markdown-autosave-focus,
// native-markdown-gui-acceptance) are deliberately not given this.
test.describe.configure({ mode: "parallel" });

import {
  KIND_FIXTURES,
  activate,
  expectSourceUnchanged,
  openBlockMenu,
  activeSurfaceText,
  surfaceTextOf,
  openPage,
  readSource,
  rowWith,
  rows,
  selectWord,
  selectionState,
  surfaceOf,
  type KindFixture,
  type OpenedPage,
} from "./harness";

/**
 * Undo and redo granularity, per Block kind.
 *
 * Granularity is the whole story here. An editor whose Mod+Z takes back one character at a time is
 * unusable even though every individual step is "correct", and one whose Mod+Z swallows a structural
 * command together with the words typed after it loses work the user cannot get back. The document
 * folds a typing run by *position* rather than by a clock — the run continues only while the next
 * edit starts exactly where the last one ended, in the same Block, without whitespace and without
 * changing the Block's kind (`MarkdownBlockDocument.continuesTypingRun`) — and every structural
 * command ends the run before it applies (`apply` clears `lastTypedEdit` for anything that is not a
 * `replaceText`). Both halves are asserted below, against the file rather than the view.
 *
 * The file is the only state that matters, so each step waits for autosave to land before the next
 * keystroke. That is not only about patience: autosave is debounced by `EDITOR_DEBOUNCE_DELAY`, so a
 * command followed immediately by Mod+Z coalesces into a single write of the *undone* state and the
 * intermediate state a granularity test has to observe would never reach the disk at all.
 */

/** One uninterrupted typing run. Three characters, so "undo took back only the last one" fails. */
const RUN = "xyz";
/** A second run, typed after the caret has moved off the end of the first. */
const SECOND_RUN = "w";
/** What the Block reads once the second run has been typed one character before the first's end. */
const INTERLEAVED = `${RUN.slice(0, -1)}${SECOND_RUN}${RUN.slice(-1)}`;

/**
 * Kinds whose typing runs can be measured.
 *
 * `word` is the anchor a caret is placed against, so the two kinds that expose none are out:
 * a divider renders no text at all, and the equation's rendered output is not its literal source.
 * Both keep their `$$`/`---` delimiters in the editing surface, so every offset near their edges is
 * a character whose insertion changes what kind of Block it is — its own history checkpoint, which
 * would hide the run folding this section is about. Their history is still covered per kind by the
 * structural Duplicate and Delete tests further down.
 *
 * The toggle is out for a different and known reason: its whole `<summary>` is the disclosure
 * control, so pressing its text opens and closes the toggle instead of activating the Block and no
 * editing surface ever appears. That is an activation defect, owned and reported by selection.spec.ts
 * and activation.spec.ts; repeating it here would only duplicate the finding.
 */
const TYPING_FIXTURES = KIND_FIXTURES.filter(
  (candidate): candidate is AnchoredFixture =>
    candidate.word !== null && candidate.kind !== "toggle"
);

/** Kinds that offer inline formatting and a structural Enter — the ones with a text projection. */
const TEXT_FIXTURES = KIND_FIXTURES.filter(
  (candidate): candidate is AnchoredFixture => candidate.word !== null && !candidate.sourceOnly
);

/** A fixture that names a word to aim a caret at, so `word` needs no null handling below. */
interface AnchoredFixture extends KindFixture {
  readonly word: string;
}

for (const fixture of TYPING_FIXTURES) {
  const word = fixture.word;
  const source = `${fixture.source}\n`;
  const afterRun = `${fixture.source.replace(word, `${word}${RUN}`)}\n`;

  test(`${fixture.label}: a run of typed characters collapses into one undo step`, async ({
    page,
  }) => {
    // The single most felt property of an editor's undo. If this fails with the file holding
    // `${word}xy`, Mod+Z is walking back one character at a time and the user has to hold it down to
    // take back a word they mistyped.
    const opened = await openPage(page, "Hist", source);
    const row = rows(page).first();
    await activate(row);
    await anchorCaretAfterWord(page, row, word);

    await page.keyboard.type(RUN);
    await expectSavedSource(opened, afterRun);

    await pressUndo(page);
    await expectSavedSource(opened, source);
    // The view has to follow the file, or the next keystroke edits a Block that no longer says what
    // the screen shows.
    await expect.poll(() => activeSurfaceText(page)).not.toMatch(new RegExp(RUN));
  });

  test(`${fixture.label}: moving the caret between two runs makes two undo steps`, async ({
    page,
  }) => {
    // The run is keyed on position, so stepping the caret back over one character starts a fresh
    // history entry. Breaking this in the other direction is the worse failure: one Mod+Z would take
    // back everything typed since the Block was opened.
    const opened = await openPage(page, "Hist", source);
    const row = rows(page).first();
    await activate(row);
    await anchorCaretAfterWord(page, row, word);

    await page.keyboard.type(RUN);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type(SECOND_RUN);
    const afterBothRuns = `${fixture.source.replace(word, `${word}${INTERLEAVED}`)}\n`;
    await expectSavedSource(opened, afterBothRuns);

    // First step: only the second run goes away, and the first survives intact.
    await pressUndo(page);
    await expectSavedSource(opened, afterRun);

    // Second step: the first run goes away, and the Block is exactly the bytes the file opened with.
    await pressUndo(page);
    await expectSavedSource(opened, source);
  });

  test(`${fixture.label}: redo returns the run, and typing after an undo discards it`, async ({
    page,
  }) => {
    const opened = await openPage(page, "Hist", source);
    const row = rows(page).first();
    await activate(row);
    await anchorCaretAfterWord(page, row, word);

    await page.keyboard.type(RUN);
    await expectSavedSource(opened, afterRun);
    await pressUndo(page);
    await expectSavedSource(opened, source);

    await pressRedo(page);
    await expectSavedSource(opened, afterRun);
    await pressUndo(page);
    await expectSavedSource(opened, source);

    // Typing after an undo starts a new branch of history. A redo stack that survived it would let
    // one keystroke resurrect text the user had already taken back, on top of what they just typed.
    await anchorCaretAfterWord(page, row, word);
    await page.keyboard.type(SECOND_RUN);
    const branched = `${fixture.source.replace(word, `${word}${SECOND_RUN}`)}\n`;
    await expectSavedSource(opened, branched);

    await pressRedo(page);
    // The document applies redo synchronously, so a surviving stack shows up in the surface at once.
    // That is the decisive check: polling the file can only prove a state arrived, never that one
    // stayed away, because autosave has a second of debounce to hide it in.
    const editor = activeEditor(page);
    await expect.poll(() => surfaceTextOf(row)).toMatch(new RegExp(`${word}${SECOND_RUN}`));
    await expect.poll(() => surfaceTextOf(row)).not.toMatch(new RegExp(RUN));
    expect(await readSource(opened), "redo resurrected a discarded state").toBe(branched);
  });
}

/**
 * Structural commands, one undo step each.
 *
 * `apply` clears the typing run for every command that is not a `replaceText`, and each structural
 * branch calls `recordHistory` exactly once, so a split, a duplicate or a delete must be reachable
 * and reversible with a single Mod+Z. The reverse failure — a structural command folded into the
 * keystrokes around it — is how an undo silently destroys a Block the user only wanted to unsplit.
 */
for (const fixture of TEXT_FIXTURES) {
  const word = fixture.word;
  const source = `${fixture.source}\n`;
  // A quote is the one kind where Enter mid-content deliberately does not split the Block: the
  // document's split branch inserts a newline plus the `> ` prefix so the quote continues, which is
  // what both reference products do. The granularity claim is the same either way — one step, and
  // the file back to the bytes it opened with.
  const rowsAfterEnter = fixture.kind === "blockquote" ? 1 : 2;

  test(`${fixture.label}: Enter then undo restores the single original Block`, async ({ page }) => {
    const opened = await openPage(page, "Hist", source);
    const row = rows(page).first();
    await activate(row);
    await anchorCaretAfterWord(page, row, word);

    await page.keyboard.press("Enter");
    await expect(rows(page)).toHaveCount(rowsAfterEnter);
    await expectSavedSourceDiffers(opened, source);

    await pressUndo(page);
    await expect(rows(page)).toHaveCount(1);
    await expectSavedSource(opened, source);
  });
}

for (const fixture of KIND_FIXTURES) {
  // A lead and a tail paragraph, so the Block under test has real neighbours: deleting the only
  // Block in a Page empties it in place instead of removing it, which is a different code path.
  const source = `Lead paragraph.\n\n${fixture.source}\n\nTail paragraph.\n`;

  test(`${fixture.label}: a gutter Duplicate is one undo step`, async ({ page }) => {
    const opened = await openPage(page, "Hist", source);
    // Every fixture is exactly one Block, so a count other than three means the fixture did not
    // parse the way the matrix assumes and nothing below it is meaningful.
    await expect(rows(page)).toHaveCount(3);

    const menu = await openBlockMenu(rows(page).nth(1));
    await menu.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(rows(page)).toHaveCount(4);
    await expectSavedSourceDiffers(opened, source);

    await pressUndo(page);
    await expect(rows(page)).toHaveCount(3);
    await expectSavedSource(opened, source);
  });

  test(`${fixture.label}: a gutter Delete is one undo step that restores the Block`, async ({
    page,
  }) => {
    const opened = await openPage(page, "Hist", source);
    await expect(rows(page)).toHaveCount(3);

    const menu = await openBlockMenu(rows(page).nth(1));
    await menu.getByRole("menuitem", { name: "Delete" }).click();
    await expect(rows(page)).toHaveCount(2);
    await expectSavedSourceDiffers(opened, source);

    await pressUndo(page);
    await expect(rows(page)).toHaveCount(3);
    await expectSavedSource(opened, source);
    // Restoring the Block has to restore its text too — a Block that comes back empty is the same
    // lost work as one that does not come back at all.
    if (fixture.word !== null) await expect(rowWith(page, fixture.word)).toBeVisible();
  });
}

for (const fixture of TEXT_FIXTURES) {
  const word = fixture.word;
  const source = `${fixture.source}\n`;

  test(`${fixture.label}: bold from the inline toolbar is one undo step`, async ({ page }) => {
    const opened = await openPage(page, "Hist", source);
    const row = rows(page).first();
    await activate(row);
    const { technique } = await selectWord(page, row, word);
    expect(technique, "no way to select in this surface").not.toBe("unavailable");

    const toolbar = page.getByRole("toolbar", { name: "Text formatting" });
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole("button", { name: "Bold" }).click();
    await expectSavedSource(opened, `${fixture.source.replace(word, `**${word}**`)}\n`);

    await pressUndo(page);
    await expectSavedSource(opened, source);
    // Adding `**` flips the Block from the raw textarea to the semantic surface, because the row
    // chooses its surface from whether the projection hides anything, so undo has to flip it back.
    // The surface is checked first and separately: `toHaveValue` throws "not an input element" on a
    // contenteditable, which would report a real regression as a broken test.
    expect(await surfaceOf(row), "undo left the semantic surface mounted").toBe("textarea");
    // And the delimiters have to be gone from the surface itself, not merely hidden by a projection.
    await expect.poll(() => activeSurfaceText(page)).not.toMatch(/\*\*/);
  });
}

test("undo with nothing to undo neither edits the file nor raises a runtime error", async ({
  page,
}) => {
  // One test rather than one per kind: an empty undo stack is a document-level state and the
  // early-return in `MarkdownBlockDocument.undo` never reaches a Block, so a per-kind loop here
  // would only re-measure activation.
  const runtimeErrors = observeRuntimeErrors(page);
  const source = "Paragraph alpha bravo charlie.\n";
  const opened = await openPage(page, "Hist", source);
  const row = rows(page).first();
  await activate(row);

  await pressUndo(page);
  await pressUndo(page);

  // Inert, not merely harmless: the caret stays where it was and the Block keeps its text, because
  // an exception thrown out of a key handler tears down the editing surface under the user.
  await expect(row).toHaveAttribute("data-active", "true");
  await expect.poll(() => activeSurfaceText(page)).toBe("Paragraph alpha bravo charlie.");
  await expectSourceUnchanged(opened, source);
  expect(runtimeErrors, "undo with an empty history logged a runtime error").toEqual([]);
});

/** The one editing surface on screen: only the active Block renders one. */
function activeEditor(page: Page): Locator {
  return page.locator("[data-native-block-editor]");
}

/**
 * Press Mod+Z where the caret is.
 *
 * Aimed at the editing surface rather than at the page, because there is no window-level undo
 * binding: Mod+Z is handled by the active Block's surface and by a Block-selection row, and the
 * app-menu route through `editor-ref-store` only exists in the Electron shell. After a command that
 * re-mounts rows the focus is briefly contested — the gutter menu returns focus to its grip while
 * the published selection focuses the new Block — so a bare `page.keyboard.press` can land on
 * `<body>` and do nothing at all, which reads exactly like a broken undo.
 */
async function pressUndo(page: Page): Promise<void> {
  await activeEditor(page).press("ControlOrMeta+z");
}

async function pressRedo(page: Page): Promise<void> {
  await activeEditor(page).press("ControlOrMeta+Shift+z");
}

/**
 * Put a collapsed caret immediately after `word` inside the active Block.
 *
 * Every typing run starts here rather than at the Block's end, because the end of a raw source often
 * sits next to a delimiter the projection keeps visible — `$$`, ```` ``` ````, `</div>` — and a
 * character typed there changes what kind of Block it is. That is its own history checkpoint by
 * design, so it would quietly turn a one-step run into two and measure the wrong thing.
 *
 * The selection is verified before it is collapsed: if the gesture did not land in the surface that
 * is about to receive the typing, everything asserted afterwards would be about text in a place
 * nobody chose. Which gesture reaches a given surface is selection.spec.ts's dimension, not this
 * file's.
 */
async function anchorCaretAfterWord(page: Page, row: Locator, word: string): Promise<void> {
  const { technique } = await selectWord(page, row, word);
  expect(technique, "no way to place a caret in this surface").not.toBe("unavailable");
  const selection = await selectionState(page);
  expect(selection.text, `wanted ${JSON.stringify(word)} selected before typing`).toContain(word);
  // Collapse to the right-hand edge of the selection, which is where the next character lands.
  await page.keyboard.press("ArrowRight");
}

/** Wait for the Page's own autosave to put exactly `expected` on disk. */
async function expectSavedSource(opened: OpenedPage, expected: string): Promise<void> {
  await expect.poll(() => readSource(opened), { timeout: 6000 }).toBe(expected);
}

/**
 * Wait until the file no longer holds `from`.
 *
 * Used where the exact bytes a structural command writes are decided by boundary rules that are not
 * what this file is measuring — how many blank lines a duplicate inserts is `duplicateBlocks`'
 * business. What matters is that the command reached the file at all, so that the byte-exact
 * assertion after the undo means something.
 */
async function expectSavedSourceDiffers(opened: OpenedPage, from: string): Promise<void> {
  await expect.poll(() => readSource(opened), { timeout: 6000 }).not.toBe(from);
}

/** Runtime errors, the way the acceptance spec observes them: page exceptions and console errors. */
function observeRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}
