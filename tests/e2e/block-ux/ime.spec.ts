import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  KIND_FIXTURES,
  activate,
  activateAt,
  caretOffset,
  pressLineStart,
  surfaceTextOf,
  openPage,
  readSource,
  rows,
  surfaceOf,
  typeWithIme,
  type KindFixture,
  type OpenedPage,
} from "./harness";

/**
 * IME composition, per Block kind.
 *
 * This is how the primary user types. A pinyin IME holds several keystrokes in a candidate window and
 * hands the editor one settled word at `compositionend`, so the editor must issue exactly one command
 * for the whole word and nothing at all for the candidates in flight. An English-only test never
 * reaches that path — `keyboard.type` emits one `input` per character and never composes — which is
 * why a regression here ships silently. `typeWithIme` drives real CDP composition instead.
 *
 * Three product facts decide how these tests are written, all read from the source rather than
 * assumed:
 *
 *   - Which surface a Block edits in is decided by `useSemanticInlineEditor` in
 *     markdown-block-row.tsx: a Block gets the contenteditable `SemanticInlineEditor` only when it is
 *     not source-only, holds no newline, is not a wiki embed, and its inline projection actually hides
 *     something (`inlineProjection.visibleText !== source`). Every KIND_FIXTURES source is plain text,
 *     so all of them edit in the raw `<textarea>`; reaching the semantic surface needs a Block whose
 *     source carries inline Markdown such as `**粗体**`. The two surface tests below assert what
 *     `surfaceOf` reports rather than trusting that reading.
 *   - A composition must issue exactly one document command. `data-revision` on
 *     `[data-native-markdown-document]` is the runtime's own command counter, so a composition that
 *     commits twice, or once per candidate, shows up as a revision delta other than 1 instead of as a
 *     subtly wrong file.
 *   - A Block's Markdown prefix and delimiters are projected out of the editing surface by
 *     `createBlockEditingProjection`, so a heading edits as `Heading hone alpha` with `# ` held
 *     outside the textarea. Only the bytes on disk prove that prefix came back, which is why every
 *     mutating test asserts the file.
 *
 * The caret is always placed with real arrow keys. A textarea's value is not in the DOM, so there is
 * no glyph rect to aim at a chosen character, and a click at a guessed point composes into the wrong
 * place.
 */

/** The settled word most tests commit. Two characters, so a per-candidate commit cannot hide. */
const COMPOSED = "中文";

/** For the undo tests: three characters, so undoing one at a time would leave 计算 behind. */
const COMPOSED_WORD = "计算机";

/** A sentence that is CJK on both sides of the composition point, full-width comma included. */
const CJK_SENTENCE = "你好世界，这是一段中文句子。";

/**
 * A paragraph whose inline `**` marks are hidden by the projection, which is what routes it to the
 * semantic editor. The composition point sits well inside the leading plain run so the insertion
 * cannot be absorbed into the bold span — that would be a separate defect, and this dimension is
 * composition, not mark boundaries.
 */
const MARKED_PARAGRAPH = "序言文字**粗体**结尾文字";

/** macOS binding first, since `Meta+ArrowUp` is what reaches offset 0 there. */
const START_OF_BLOCK = process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home";

/**
 * A word present in each kind's *editor* text, which is not always its rendered text.
 *
 * `KindFixture.word` names something rendered, and the equation renders through KaTeX so it has none.
 * Its raw source is nonetheless what the textarea holds, so `mc^2` is a perfectly good composition
 * anchor for it even though nothing in the DOM says so.
 */
const EDITOR_ANCHORS: Readonly<Record<string, string | undefined>> = { equation: "mc^2" };

/**
 * Every kind this dimension can be measured on, with the anchor the caret is placed after.
 *
 * Two kinds are left out, and neither omission is about IME:
 *   divider  - projects no text at all, so there is no position "in text" to compose at; appending to
 *              `---` measures reclassification instead.
 *   toggle   - pressing its `<summary>` opens the disclosure rather than activating the Block, so no
 *              editing surface ever appears. That defect is already asserted once in selection.spec.ts
 *              and re-reporting it here would bury the IME findings under it.
 */
const IME_TARGETS: readonly { fixture: KindFixture; anchor: string }[] = KIND_FIXTURES.flatMap(
  (fixture) => {
    if (fixture.label === "divider" || fixture.label === "toggle") return [];
    const anchor = EDITOR_ANCHORS[fixture.label] ?? fixture.word;
    return anchor ? [{ fixture, anchor }] : [];
  }
);

/**
 * The kinds whose Markdown prefix is projected out of the editing surface, so composing at offset 0
 * puts text *after* a prefix that is not on screen. A paragraph has no prefix, and source-only kinds
 * edit as their raw source, so neither can lose one.
 */
const PREFIXED_FIXTURES = KIND_FIXTURES.filter(
  (fixture) => !fixture.sourceOnly && fixture.label !== "paragraph"
);

function editorOf(row: Locator): Locator {
  return row.locator("[data-native-block-editor]").first();
}

/** The text the active surface holds, from wherever that surface keeps it. */
async function editorValue(row: Locator): Promise<string> {
  return editorOf(row).evaluate((el) =>
    el instanceof HTMLTextAreaElement ? el.value : (el.textContent ?? "")
  );
}

/**
 * Walk the caret to `offset` with real arrow keys, in the active surface's own offset space.
 *
 * A textarea counts raw source characters and the semantic editor counts visible ones, but every
 * fixture here is walked in the same space it is measured in, so the two never meet. Both the start
 * and the landing are read back rather than assumed: an off-by-one here would compose into the wrong
 * place and read as a product bug.
 */
async function placeCaret(page: Page, row: Locator, offset: number): Promise<void> {
  const editor = editorOf(row);
  await expect(editor, "the Block has no focused editing surface to compose into").toBeFocused();
  await page.keyboard.press(START_OF_BLOCK);
  let start = await caretOffset(page);
  if (start.offset !== 0) {
    // The same readback-and-retry the harness's own `selectWord` performs, and for the same reason:
    // whichever binding reaches the start of a field is a platform detail, and a press that does not
    // land would compose at the wrong offset in every test in this file — sixteen reports of a
    // product bug that is really one helper limitation. Pressing inside the surface puts the caret on
    // its first visual line, from which `Home` reaches offset 0 in either surface and whatever number
    // of lines the Block holds.
    const box = await editor.boundingBox();
    if (box) await page.mouse.click(box.x + 1, box.y + 2);
    await pressLineStart(page);
    start = await caretOffset(page);
  }
  expect(start.offset, "the caret never reached the start of the Block").toBe(0);
  for (let index = 0; index < offset; index += 1) await page.keyboard.press("ArrowRight");
  const landed = await caretOffset(page);
  expect(landed.offset, "the caret never reached the composition point").toBe(offset);
  expect(landed.collapsed, "something is selected, so a composition would replace it").toBe(true);
}

/** The runtime's command counter, which is how "exactly one command" is measured. */
async function revisionOf(page: Page): Promise<number> {
  const value = await page.locator("[data-native-markdown-document]").getAttribute("data-revision");
  expect(value, "the runtime published no revision to count commands with").not.toBeNull();
  return Number(value);
}

/** Assert the bytes on disk, allowing for the 1s autosave debounce after `compositionend`. */
async function expectSource(opened: OpenedPage, expected: string, why: string): Promise<void> {
  await expect.poll(() => readSource(opened), { message: why, timeout: 5000 }).toBe(expected);
}

/**
 * Composing after existing text, per Block kind.
 *
 * One test per kind so a failure names the Block. The file assertion is the real one: it proves the
 * settled word landed exactly once, that no candidate was left behind, and that the prefix or
 * delimiters the surface hides — `# `, `- [ ] `, the ``` fence lines, the `$$` pair, the table
 * pipes — all came back unchanged. The revision delta proves the editor spoke to the document once
 * rather than once per keystroke, which is the whole reason the composing value is held locally.
 */

for (const { fixture, anchor } of IME_TARGETS) {
  test(`${fixture.label}: composing after existing text commits the settled word once`, async ({
    page,
  }) => {
    const opened = await openPage(page, "Ime", `${fixture.source}\n`);
    const row = rows(page).first();
    await activateAt(row, anchor);

    const before = await editorValue(row);
    const at = before.indexOf(anchor);
    expect(at, `the editing surface does not hold ${anchor}`).toBeGreaterThanOrEqual(0);
    const composeAt = at + anchor.length;
    await placeCaret(page, row, composeAt);
    const revisionBefore = await revisionOf(page);

    await typeWithIme(page, COMPOSED);

    const expectedEditor = `${before.slice(0, composeAt)}${COMPOSED}${before.slice(composeAt)}`;
    await expect
      .poll(() => editorValue(row), {
        message: "the surface does not hold exactly the settled text",
        timeout: 5000,
      })
      .toBe(expectedEditor);
    await expectSource(
      opened,
      `${fixture.source.replace(anchor, `${anchor}${COMPOSED}`)}\n`,
      "the composed word did not land in the file at the caret, intact and once"
    );
    const revisionAfter = await revisionOf(page);
    expect(
      revisionAfter - revisionBefore,
      "a composition must be one command; more means a candidate was committed too"
    ).toBe(1);
  });
}

/**
 * One composition is one undo step, per Block kind.
 *
 * A user who types 计算机 and presses Mod+Z expects the word gone, not 计算 left on screen. The
 * runtime flushes the typing run at `compositionstart` and again at `compositionend`, so the whole
 * composition sits between two checkpoints; the file returning to its original bytes after a single
 * Mod+Z is the only thing that proves it. Per kind because reclassification decides whether an edit
 * may join the surrounding run at all, and reclassification is kind-dependent.
 */
for (const { fixture, anchor } of IME_TARGETS) {
  test(`${fixture.label}: one composition is one undo step`, async ({ page }) => {
    const source = `${fixture.source}\n`;
    const opened = await openPage(page, "Ime", source);
    const row = rows(page).first();
    await activateAt(row, anchor);

    const before = await editorValue(row);
    const at = before.indexOf(anchor);
    expect(at, `the editing surface does not hold ${anchor}`).toBeGreaterThanOrEqual(0);
    await placeCaret(page, row, at + anchor.length);

    await typeWithIme(page, COMPOSED_WORD);
    // Wait for the composition to reach disk first. Asserting the original bytes straight away would
    // pass on a file the composition had simply not been written to yet.
    await expectSource(
      opened,
      `${fixture.source.replace(anchor, `${anchor}${COMPOSED_WORD}`)}\n`,
      "the composition never reached the file, so there is no undo step to measure"
    );

    await page.keyboard.press("ControlOrMeta+z");

    await expectSource(
      opened,
      source,
      "one undo left part of the composed word behind instead of taking back the whole word"
    );
  });
}

/**
 * Composing at the very start of a Block, per prefixed kind.
 *
 * This is where a projected prefix is easiest to lose: offset 0 of the surface is offset `# `.length
 * of the file, and an insertion mapped one step short would write `中文# Heading…` — a heading turned
 * into a paragraph by typing at its start, which is catastrophic and completely invisible on screen
 * until the Page is reopened.
 */
for (const fixture of PREFIXED_FIXTURES) {
  test(`${fixture.label}: composing at the start of the Block keeps the Markdown prefix`, async ({
    page,
  }) => {
    const opened = await openPage(page, "Ime", `${fixture.source}\n`);
    const row = rows(page).first();
    await activate(row);

    const before = await editorValue(row);
    const prefixLength = fixture.source.length - before.length;
    // If the surface showed the prefix this would be zero and the test would be measuring nothing.
    expect(
      prefixLength,
      "the Markdown prefix is not projected out of the editing surface"
    ).toBeGreaterThan(0);
    await placeCaret(page, row, 0);

    await typeWithIme(page, COMPOSED);

    await expectSource(
      opened,
      `${fixture.source.slice(0, prefixLength)}${COMPOSED}${fixture.source.slice(prefixLength)}\n`,
      "composing at offset 0 did not land immediately after the Block's Markdown prefix"
    );
  });
}

test("an empty paragraph: composing commits exactly the settled text and nothing else", async ({
  page,
}) => {
  // The first thing a Chinese user does on a new Page. An empty Page holds no bytes of its own, so
  // the settled word is the whole file — nothing normalises a trailing newline into it.
  const opened = await openPage(page, "Ime", "");
  const row = rows(page).first();
  await expect(rows(page)).toHaveCount(1);
  await activate(row);
  await placeCaret(page, row, 0);
  const revisionBefore = await revisionOf(page);

  await typeWithIme(page, COMPOSED);

  // Exactly the settled text: an intermediate candidate left in the surface would show up here as
  // 中中文 or 中文中文, which is what a controlled `value` fighting the IME used to produce.
  await expect.poll(() => surfaceTextOf(row)).toBe(COMPOSED);
  await expect(rows(page), "the commit split the Block instead of inserting into it").toHaveCount(
    1
  );
  await expectSource(opened, COMPOSED, "the composed word is not the whole content of the Page");
  const revisionAfter = await revisionOf(page);
  expect(revisionAfter - revisionBefore, "a composition must be exactly one command").toBe(1);
});

test("a plain Chinese paragraph composes in the raw textarea, between the CJK either side", async ({
  page,
}) => {
  const opened = await openPage(page, "Ime", `${CJK_SENTENCE}\n`);
  const row = rows(page).first();
  await activate(row);
  // Nothing in this source is hidden by the inline projection, so the Block edits as raw source.
  expect(await surfaceOf(row), "a plain paragraph should edit in the raw textarea").toBe(
    "textarea"
  );

  await placeCaret(page, row, CJK_SENTENCE.indexOf("世界") + 2);
  const revisionBefore = await revisionOf(page);

  await typeWithIme(page, "插入");

  // The character after the caret is the full-width comma: a commit that overwrote or dropped its
  // neighbours would be visible here and nowhere else.
  await expectSource(
    opened,
    "你好世界插入，这是一段中文句子。\n",
    "the composition disturbed the CJK text around the caret"
  );
  const revisionAfter = await revisionOf(page);
  expect(revisionAfter - revisionBefore, "a composition must be exactly one command").toBe(1);
});

test("a textarea composition leaves the caret just after the inserted text", async ({ page }) => {
  const opened = await openPage(page, "Ime", `${CJK_SENTENCE}\n`);
  const row = rows(page).first();
  await activate(row);
  const composeAt = CJK_SENTENCE.indexOf("世界") + 2;
  await placeCaret(page, row, composeAt);

  await typeWithIme(page, "插入");

  const caret = await caretOffset(page);
  // A textarea counts raw source characters, and this paragraph has no projected prefix, so the
  // expected offset is simply the composition point plus what was inserted.
  expect(caret.space).toBe("source");
  expect(caret.offset, "the caret jumped away from the text it just committed").toBe(composeAt + 2);
  expect(caret.collapsed).toBe(true);

  // The behavioural version of the same claim: the next word must continue where the last one
  // stopped. If the caret had snapped to the end of the Block, 继续 would land after the full stop.
  await typeWithIme(page, "继续");
  await expectSource(
    opened,
    "你好世界插入继续，这是一段中文句子。\n",
    "the second composition did not continue from the first one's caret"
  );
});

test("a paragraph with inline Markdown composes in the semantic editor", async ({ page }) => {
  const opened = await openPage(page, "Ime", `${MARKED_PARAGRAPH}\n`);
  const row = rows(page).first();
  await activate(row);
  // What decides the surface is that the projection hides something: `**` is in the source but not in
  // the visible text, so this Block gets the contenteditable rather than the raw textarea.
  expect(
    await surfaceOf(row),
    "a paragraph with inline marks should edit in the semantic editor"
  ).toBe("contenteditable");

  // Visible offsets here, not source offsets: the semantic editor counts what is on screen.
  await placeCaret(page, row, 2);
  const revisionBefore = await revisionOf(page);

  await typeWithIme(page, "插入");

  await expectSource(
    opened,
    "序言插入文字**粗体**结尾文字\n",
    "the composition did not land at the caret with the bold delimiters left alone"
  );
  const caret = await caretOffset(page);
  expect(caret.space).toBe("visible");
  expect(caret.offset, "the caret jumped away from the text it just committed").toBe(4);
  const revisionAfter = await revisionOf(page);
  expect(revisionAfter - revisionBefore, "a composition must be exactly one command").toBe(1);
});

test("the semantic editor commits one composition as one undo step", async ({ page }) => {
  const source = `${MARKED_PARAGRAPH}\n`;
  const opened = await openPage(page, "Ime", source);
  const row = rows(page).first();
  await activate(row);
  expect(await surfaceOf(row)).toBe("contenteditable");
  await placeCaret(page, row, 2);

  await typeWithIme(page, COMPOSED_WORD);
  await expectSource(
    opened,
    `序言${COMPOSED_WORD}文字**粗体**结尾文字\n`,
    "the composition never reached the file, so there is no undo step to measure"
  );

  await page.keyboard.press("ControlOrMeta+z");

  await expectSource(
    opened,
    source,
    "one undo left part of the composed word behind on the semantic surface"
  );
});

test("a composed 、 at the start of a Block reaches the file and opens the Block menu", async ({
  page,
}) => {
  // `、` is the fullwidth slash trigger (SLASH_TRIGGER_PATTERN in markdown-block-row.tsx), so a CJK
  // keyboard can reach the insert menu without switching modes — Feishu's behaviour, per
  // docs/BLOCK_UX_REFERENCE.md. The risk is that the trigger swallows the character: the menu filters
  // on the live composing text, so the run is already open while `、` is still a candidate, and the
  // commit has to leave the literal character behind either way.
  const opened = await openPage(page, "Ime", "");
  const row = rows(page).first();
  await activate(row);
  await placeCaret(page, row, 0);

  await typeWithIme(page, "、");

  await expectSource(opened, "、", "the trigger character never reached the file");
  const menu = page.getByRole("listbox", { name: "Block commands" });
  await expect(menu, "the fullwidth trigger opened no Block command menu").toBeVisible();

  // Dismissing is never an edit: Escape closes the panel and leaves the character the user typed.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expectSource(opened, "、", "dismissing the menu deleted the character that opened it");
});

test("a composed 、 after Chinese text reaches the file and opens no menu", async ({ page }) => {
  // `slashRunAt` requires the trigger to start a word, which is what keeps ordinary punctuation
  // typeable: `、` after 好 is a comma in a sentence, not a command. It must still be exactly one
  // character in the file.
  const opened = await openPage(page, "Ime", "你好\n");
  const row = rows(page).first();
  await activate(row);
  await placeCaret(page, row, 2);

  await typeWithIme(page, "、");

  await expectSource(opened, "你好、\n", "the composed punctuation did not survive the commit");
  await expect(
    page.getByRole("listbox", { name: "Block commands" }),
    "punctuation inside a word opened the command menu"
  ).toHaveCount(0);
});
