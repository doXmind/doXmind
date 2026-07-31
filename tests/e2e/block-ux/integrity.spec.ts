import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  KIND_FIXTURES,
  activate,
  caretOffset,
  clickAway,
  everyKindSource,
  expectSourceUnchanged,
  gutter,
  kindsInOrder,
  openPage,
  readSource,
  rowWith,
  rows,
  surfaceOf,
  type OpenedPage,
} from "./harness";

/**
 * The file, per Block kind.
 *
 * Every other dimension in this matrix is cosmetic if the bytes are wrong. A user's Markdown file is
 * the product's only state, so the questions here are the ones that decide whether the editor can be
 * trusted with it: does looking at a Page leave it alone, does one keystroke and one undo return it
 * to exactly what it was, and does source the editor does not model come back unharmed.
 *
 * No kind is skipped. A kind whose structure the editor cannot project — a divider, an equation, a
 * raw HTML Block — still has bytes on disk, and those bytes are the whole point of this file.
 */

/**
 * Autosave is debounced by `EDITOR_DEBOUNCE_DELAY` (1000ms, src/lib/constants.ts), so a write
 * provoked by a gesture lands about a second after that gesture. Anything asserting that the file was
 * *not* written has to outlast that window, or it passes before the write it was looking for.
 */
const AUTOSAVE_SETTLE_MS = 1600;

/**
 * Assert the file still holds exactly `source`, now and after the autosave window has passed.
 *
 * `expectSourceUnchanged` alone would be satisfied by the first read, which happens while a stray
 * write is still sitting in the debounce — a Page that silently rewrites itself on open would look
 * clean. The second phase reads once, deliberately after the debounce could have fired.
 */
async function expectSourceStable(opened: OpenedPage, source: string): Promise<void> {
  await expectSourceUnchanged(opened, source);
  const settledAt = Date.now() + AUTOSAVE_SETTLE_MS;
  await expect
    .poll(
      async () =>
        Date.now() < settledAt ? "the autosave window is still open" : readSource(opened),
      { timeout: AUTOSAVE_SETTLE_MS + 5_000, intervals: [200] }
    )
    .toBe(source);
}

/** Wait for the autosave that carries an edit to disk, then answer with the bytes it wrote. */
async function readSourceAfterEdit(opened: OpenedPage, before: string): Promise<string> {
  await expect.poll(() => readSource(opened), { timeout: 5_000 }).not.toBe(before);
  return readSource(opened);
}

/**
 * Put a Block into its editing surface, choosing a gesture the kind can actually honour.
 *
 * Every kind but one activates from a press on its own glyphs. A toggle's whole `<summary>` is the
 * disclosure control and stops the press before it reaches the row, so a pointer cannot activate one
 * at all — a defect asserted once, on purpose, in selection.spec.ts. Re-reporting it in eighteen
 * integrity tests would say nothing new, and the row's own Enter reaches the same editing surface, so
 * the toggle is activated from the keyboard here. This dimension is about the bytes, not about which
 * gesture opens the Block.
 */
async function activateForEditing(row: Locator, kind: string): Promise<void> {
  void kind;
  await activate(row);
}

/**
 * Move the caret inside the active surface without changing a character.
 *
 * Arrow keys are the cheapest gesture that proves the surface is live: they run the row's key
 * handling, its selection bookkeeping and its caret projection, and none of those may emit a command.
 * A Block that saved on caret movement would rewrite a file the user only read.
 */
async function moveCaretWithin(page: Page, row: Locator): Promise<void> {
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  const caret = await caretOffset(page);
  expect(caret.space, `no caret in the ${await surfaceOf(row)} surface after activation`).not.toBe(
    "none"
  );
  expect(caret.collapsed, "moving the caret left a selection behind").toBe(true);
}

for (const fixture of KIND_FIXTURES) {
  test(`${fixture.label}: reading, hovering, activating and releasing writes nothing`, async ({
    page,
  }) => {
    const source = `${fixture.source}\n`;
    const opened = await openPage(page, `Bytes ${fixture.label}`, source);
    const row = rows(page).first();
    // The kind is asserted first because everything below is only meaningful if the Block being
    // pressed is the Block this fixture describes.
    await expect(row).toHaveAttribute("data-block-kind", fixture.kind);

    // Hover reveals the gutter by opacity (editor.css), so the reveal is what proves the pointer
    // reached the row rather than the page margin beside it.
    await row.hover();
    await expect(gutter(row)).toHaveCSS("opacity", "1");

    await activateForEditing(row, fixture.kind);
    // A divider is selected rather than edited: it renders a focusable shell so the Block still
    // answers Escape and Backspace, but there is no caret in it and there should not be.
    if (fixture.textSurface !== false) await moveCaretWithin(page, row);
    await clickAway(page);

    await expectSourceStable(opened, source);
  });
}

test("every kind at once: one row per Block, in the order the document declares", async ({
  page,
}) => {
  const source = everyKindSource();
  const opened = await openPage(page, "Bytes every kind", source);

  // A per-kind Page cannot see a Block being parsed as the wrong kind, because on its own almost any
  // source classifies. Neighbours are what break classification: a list item that swallows the Block
  // after it, or a fence that never closes, changes a kind two Blocks away.
  await expect(rows(page)).toHaveCount(KIND_FIXTURES.length);
  expect(await kindsInOrder(page)).toEqual(KIND_FIXTURES.map((fixture) => fixture.kind));

  await expectSourceStable(opened, source);
});

for (const fixture of KIND_FIXTURES.filter((candidate) => candidate.textSurface !== false)) {
  test(`${fixture.label}: one keystroke and one undo returns the exact original bytes`, async ({
    page,
  }) => {
    const source = `${fixture.source}\n`;
    const opened = await openPage(page, `Round trip ${fixture.label}`, source);
    const row = rows(page).first();
    await activateForEditing(row, fixture.kind);

    const editor = row.locator("[data-native-block-editor]").first();
    await expect(editor, "activation did not put the caret in the Block").toBeFocused();
    await page.keyboard.type("z");

    const typed = await readSourceAfterEdit(opened, source);
    expect(typed.length, "one keystroke changed more than one character in the file").toBe(
      source.length + 1
    );

    // Undo is handled by the row's editing surface rather than by a document-level listener, so the
    // press has to happen with the caret still inside the Block.
    await expect(page.locator("[data-native-block-editor]").first()).toBeFocused();
    await page.keyboard.press("ControlOrMeta+z");

    // Byte equality includes the final newline: an editor that "helpfully" trims or adds one turns
    // every Page in a Git repository into a diff the user did not make.
    await expectSourceUnchanged(opened, source);
  });
}

test("Tab in a ragged table never leaves the Block without an editor", async ({ page }) => {
  // A row with more pipes than the delimiter declares columns is tolerated rather than normalised, so
  // the parser keeps cells the grid does not draw. Tab walked into one: the address moved, no editor
  // mounted at it, and focus fell to `<body>` while the row still called itself active — every
  // keystroke after that went nowhere until the table was clicked again.
  const source = ["| a | b | c |", "| - | - | - |", "| x | y | z | extra |", ""].join("\n");
  await openPage(page, "Ragged tab", source);
  const row = rows(page).first();
  await activate(row);
  await row.locator("td", { hasText: "z" }).first().click();
  await page.keyboard.press("Tab");

  await expect(
    page.locator("[data-native-block-editor]"),
    "Tab left the table with no editing surface"
  ).toHaveCount(1);
  await expect(row).toHaveAttribute("data-active", "true");

  // The real symptom was silence, so prove a keystroke still reaches the document.
  await page.keyboard.type("typed");
  await expect(page.locator("[data-native-block-editor]").first()).toContainText("typed");
});

test("a ragged pipe table with bare edges and an escaped pipe survives activation", async ({
  page,
}) => {
  // Deliberately tolerated by markdown-table.ts: leading and trailing pipes are optional in GFM, a
  // row that disagrees with the header on column count is still a table the user can edit, and a
  // `\|` inside a cell is one cell, not two. None of that is normalized, so the file must come back
  // unchanged down to the padding.
  const source = [
    "head | two | three",
    "--- | :-: | ---",
    "a \\| b | c",
    "x | y | z | extra",
    "",
  ].join("\n");
  const opened = await openPage(page, "Bytes ragged table", source);
  const row = rows(page).first();
  await expect(rows(page)).toHaveCount(1);
  await expect(row).toHaveAttribute("data-block-kind", "table");

  await activateForEditing(row, "table");
  await moveCaretWithin(page, row);
  await clickAway(page);

  await expectSourceStable(opened, source);
});

test("setext headings stay exactly as written, and are headings", async ({ page }) => {
  // `Title` over `====` is a heading in CommonMark, and the scanner now says so: it used to fall to
  // `unsupported`, which kept the bytes safe but left the heading out of the outline and unreachable
  // as a `[[Page#Anchor]]` target. What has not changed, and is the point of this file, is that the
  // underline is never rewritten into `# Title` — the Block reports a level and still owns its exact
  // two lines.
  const source = "Setext title\n============\n\nSecond level\n------------\n\nBody paragraph.\n";
  const opened = await openPage(page, "Bytes setext", source);

  // The count is asserted with a retrying matcher before the kinds are read in one shot, because
  // `openPage` only waits for the first row: a Page whose content arrives after the first paint
  // would otherwise be measured mid-render and report a Block list that was never rendered.
  await expect(rows(page)).toHaveCount(3);
  expect(await kindsInOrder(page)).toEqual(["heading", "heading", "paragraph"]);
  await expect(rows(page).nth(0)).toHaveAttribute("data-block-level", "1");
  await expect(rows(page).nth(1)).toHaveAttribute("data-block-level", "2");

  const row = rows(page).first();
  await activateForEditing(row, "heading");
  await expect(row.locator("[data-native-block-editor]").first()).toHaveValue(
    "Setext title\n============"
  );
  await moveCaretWithin(page, row);
  await clickAway(page);

  await expectSourceStable(opened, source);
});

test("a list with irregular indentation keeps every one of its own spaces", async ({ page }) => {
  // Three, then five spaces: legal nesting, since the scanner measures a child against its parent's
  // content column rather than against a fixed step. Re-indenting this to two spaces per level would
  // be the editor rewriting a file it was only asked to show.
  const source = "- one\n   - two\n     - three\n- four\n";
  const opened = await openPage(page, "Bytes irregular list", source);

  await expect(rows(page)).toHaveCount(4);
  expect(await kindsInOrder(page)).toEqual([
    "bullet_list_item",
    "bullet_list_item",
    "bullet_list_item",
    "bullet_list_item",
  ]);

  const row = rowWith(page, "three");
  await activateForEditing(row, "bullet_list_item");
  await moveCaretWithin(page, row);
  await clickAway(page);

  await expectSourceStable(opened, source);
});

test("a CRLF document is not converted to LF by being opened and activated", async ({ page }) => {
  const source = "# CRLF heading\r\n\r\nParagraph on CRLF lines.\r\n";
  const opened = await openPage(page, "Bytes CRLF", source);

  await expect(rows(page)).toHaveCount(2);
  expect(await kindsInOrder(page)).toEqual(["heading", "paragraph"]);

  const row = rowWith(page, "Paragraph on CRLF lines.");
  await activateForEditing(row, "paragraph");
  await moveCaretWithin(page, row);
  await clickAway(page);

  await expectSourceStable(opened, source);
});

test("editing one line of a CRLF Block leaves the other lines' CRLF endings alone", async ({
  page,
}) => {
  // A textarea reports every line ending as LF, so the naive write-back normalizes the whole Block.
  // `minimalEditorPatch` exists to stop that by mapping the smallest changed range back into the
  // original source, and this is the gesture that proves it: type inside a multi-line CRLF Block and
  // the untouched lines must still end in CRLF.
  const source = ["```md", "line one", "line two", "```", ""].join("\r\n");
  const opened = await openPage(page, "Bytes CRLF code", source);
  const row = rows(page).first();
  await expect(rows(page)).toHaveCount(1);
  await expect(row).toHaveAttribute("data-block-kind", "fenced_code");

  await activateForEditing(row, "fenced_code");
  const editor = row.locator("[data-native-block-editor]").first();
  await expect(editor).toBeFocused();
  await page.keyboard.type("z");

  const typed = await readSourceAfterEdit(opened, source);
  expect(typed.length, "one keystroke changed more than one character in the file").toBe(
    source.length + 1
  );
  expect(/[^\r]\n/.test(typed), "an edit normalized a CRLF line ending to a bare LF").toBe(false);

  await expect(page.locator("[data-native-block-editor]").first()).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expectSourceUnchanged(opened, source);
});

test("a fenced code Block whose content is Markdown stays one Block", async ({ page }) => {
  // Fence recognition is top-level on purpose. If the heading and the list inside this fence were
  // scanned as Blocks, the code sample would be broken into rows that each edit independently, and
  // the closing fence would end up attached to whichever row happened to own it.
  const source = "```md\n# Not a heading\n\n- not a list\n\n> not a quote\n```\n";
  const opened = await openPage(page, "Bytes nested markdown", source);
  const row = rows(page).first();
  await expect(rows(page)).toHaveCount(1);
  await expect(row).toHaveAttribute("data-block-kind", "fenced_code");

  await activateForEditing(row, "fenced_code");
  // The payload projection hides the fence lines, so the surface holds the sample verbatim and
  // nothing else — including its blank lines, which a trimming editor would eat.
  await expect(row.locator("[data-native-block-editor]").first()).toHaveValue(
    "# Not a heading\n\n- not a list\n\n> not a quote"
  );
  await moveCaretWithin(page, row);
  await clickAway(page);

  await expectSourceStable(opened, source);
});

test("an unbreakable 200-character token is stored whole", async ({ page }) => {
  // A token this long cannot wrap, which is a layout problem the preview solves by breaking it
  // visually. The file must not be where that break is recorded: no soft hyphen, no zero-width
  // space, no inserted newline.
  const token = "u".repeat(200);
  const source = `Paragraph with ${token} inside.\n`;
  const opened = await openPage(page, "Bytes long token", source);
  const row = rows(page).first();
  await expect(row).toHaveAttribute("data-block-kind", "paragraph");

  await activateForEditing(row, "paragraph");
  await expect(row.locator("[data-native-block-editor]").first()).toHaveValue(
    `Paragraph with ${token} inside.`
  );
  await moveCaretWithin(page, row);
  await clickAway(page);

  await expectSourceStable(opened, source);
});

/**
 * Frontmatter the editor does not understand.
 *
 * `nested`, `spaced` and `unknown_key` are none of the Page's own properties. The storage boundary
 * splits the frontmatter prefix off byte-for-byte and re-prepends the same bytes on write, so keys it
 * has no model for — and the odd spacing inside them — have to survive both reading and saving.
 */
const FRONTMATTER = [
  "---",
  "id: integrity-frontmatter",
  'title: "Frontmatter integrity"',
  "unknown_key: kept verbatim",
  "nested:",
  "  - one",
  "  - two",
  "spaced:    three   spaces   kept",
  "---",
  "",
  "",
].join("\n");

test("frontmatter is not a Block and is untouched by reading the Page", async ({ page }) => {
  const source = `${FRONTMATTER}Body paragraph with words.\n`;
  const opened = await openPage(page, "Bytes frontmatter", source);

  // One row, for the body. Frontmatter appearing as an editable Block would let a caret walk into
  // the Page's identity and edit it as prose.
  await expect(rows(page)).toHaveCount(1);
  const row = rows(page).first();
  await expect(row).toHaveAttribute("data-block-kind", "paragraph");

  await activateForEditing(row, "paragraph");
  await moveCaretWithin(page, row);
  await clickAway(page);

  await expectSourceStable(opened, source);
});

test("a Block edit rewrites the body and returns the frontmatter byte-for-byte", async ({
  page,
}) => {
  const source = `${FRONTMATTER}Body paragraph with words.\n`;
  const opened = await openPage(page, "Bytes frontmatter save", source);
  const row = rows(page).first();
  await activateForEditing(row, "paragraph");
  await expect(row.locator("[data-native-block-editor]").first()).toBeFocused();
  await page.keyboard.type("z");

  const typed = await readSourceAfterEdit(opened, source);
  expect(
    typed.slice(0, FRONTMATTER.length),
    "saving the body rewrote the frontmatter it was not asked to touch"
  ).toBe(FRONTMATTER);
  expect(typed.length, "one keystroke changed more than one character in the file").toBe(
    source.length + 1
  );

  await expect(page.locator("[data-native-block-editor]").first()).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expectSourceUnchanged(opened, source);
});

/**
 * Source the editor has no model for at all.
 *
 * Each of these is legal Markdown that `blockFromSource` deliberately refuses to classify, and the
 * contract is the same for all three: it becomes an `unsupported` Block, it is shown and edited as
 * its own exact raw source, and it goes back to the file unchanged. Guessing at a structure here is
 * how a link reference definition turns into a paragraph and stops resolving links.
 */
const UNSUPPORTED_SOURCES: readonly { label: string; source: string }[] = [
  { label: "an HTML comment", source: "<!-- integrity comment, kept as written -->\n" },
  { label: "a link reference definition", source: '[ref]: https://example.com "Title"\n' },
  { label: "an indented code block", source: "    indented code line\n" },
];

for (const unsupported of UNSUPPORTED_SOURCES) {
  test(`${unsupported.label} renders as unsupported and returns to the file unchanged`, async ({
    page,
  }) => {
    const opened = await openPage(page, "Bytes unsupported", unsupported.source);
    const row = rows(page).first();
    await expect(rows(page)).toHaveCount(1);
    await expect(row).toHaveAttribute("data-block-kind", "unsupported");

    const raw = unsupported.source.replace(/\n$/, "");
    // The preview is a `<pre><code>` holding the source verbatim; `textContent` rather than a text
    // matcher because the leading indentation of the indented-code case is the whole point and
    // Playwright's text matching would normalize it away.
    const previewed = await row
      .locator("pre code")
      .first()
      .evaluate((el) => el.textContent);
    expect(previewed, "the unsupported preview is not the Block's own source").toBe(raw);

    await activateForEditing(row, "unsupported");
    await expect(row.locator("[data-native-block-editor]").first()).toHaveValue(raw);
    await moveCaretWithin(page, row);
    await clickAway(page);

    await expectSourceStable(opened, unsupported.source);
  });
}
