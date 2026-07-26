/**
 * Real-GUI primitives for the per-Block interaction matrix.
 *
 * These exist because the matrix is only worth what its primitives are worth. Every Block has two
 * possible editing surfaces — a raw `<textarea>` and a contenteditable `SemanticInlineEditor` — and
 * they behave differently under a pointer:
 *
 *   - A contenteditable's text lives in DOM text nodes, so a `Range` gives real client rects and a
 *     drag across them is a faithful user selection.
 *   - A textarea's value is NOT in the DOM. `document.createTreeWalker` finds nothing, `Range` gives
 *     a zero-width rect, and a drag computed from that rect silently lands somewhere else. A probe
 *     built on ranges alone reports "selected nothing" for every textarea-backed Block and looks
 *     exactly like a product bug.
 *
 * So `selectWord` picks its technique from the surface actually present, and `expectSelected` reads
 * the selection from whichever surface owns it. Anything asserting on selection must go through
 * these, or the matrix will lie.
 */

import { expect, type Locator, type Page } from "@playwright/test";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type SurfaceKind = "textarea" | "contenteditable" | "none";

export interface OpenedPage {
  readonly dir: string;
  readonly path: string;
}

/**
 * Write a one-Page workspace and open it, returning the file path for byte assertions.
 *
 * `assets` writes extra files into the workspace first. An image Block whose file is missing renders
 * a placeholder rather than an `<img>` — correctly — so a test about how an image behaves has to
 * provide a real one or it measures the placeholder instead.
 */
export async function openPage(
  page: Page,
  name: string,
  source: string,
  assets: Readonly<Record<string, Buffer | string>> = {}
): Promise<OpenedPage> {
  const dir = await mkdtemp(join(tmpdir(), "doxmind-block-ux-"));
  const path = join(dir, `${name}.md`);
  await writeFile(path, source, "utf8");
  for (const [relative, contents] of Object.entries(assets)) {
    const target = join(dir, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/editor?folder=${encodeURIComponent(dir)}`);
  await page.getByText(name, { exact: true }).first().click();
  await expect(page.getByTestId("markdown-block-runtime")).toBeVisible();
  await expect(page.locator("[data-native-block-row]").first()).toBeVisible();
  return { dir, path };
}

export function rows(page: Page): Locator {
  return page.locator("[data-native-block-row]");
}

/** The row whose rendered text contains `text`. Kind-agnostic, so it works for every Block. */
export function rowWith(page: Page, text: string): Locator {
  return rows(page).filter({ hasText: text }).first();
}

export async function rowIndexWith(page: Page, text: string): Promise<number> {
  return page.evaluate((needle) => {
    const all = [...document.querySelectorAll("[data-native-block-row]")];
    return all.findIndex((row) => (row.textContent ?? "").includes(needle));
  }, text);
}

/**
 * Release the caret and any Block selection.
 *
 * Presses the editor's own right-hand margin. Not the left margin: rows carry `margin-left: -4rem`
 * so they span it, and not the sidebar either, which would move focus out of the editor entirely and
 * make the next assertion about a different surface.
 */
export async function clickAway(page: Page): Promise<void> {
  const geom = await page.evaluate(() => {
    const scroll = document.querySelector("[data-native-markdown-scroll]") as HTMLElement | null;
    const frame = document.querySelector(".editor-page-frame") as HTMLElement | null;
    if (!scroll || !frame) return null;
    const s = scroll.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    return { x: (f.x + f.width + s.x + scroll.clientWidth) / 2, y: f.y + 40 };
  });
  if (geom) await page.mouse.click(geom.x, geom.y);
  await expect(page.locator('[data-native-block-row][data-active="true"]')).toHaveCount(0);
}

/** Which editing surface, if any, the given row is currently showing. */
export async function surfaceOf(row: Locator): Promise<SurfaceKind> {
  return row.evaluate((el) => {
    const editor = el.querySelector("[data-native-block-editor]");
    if (!editor) return "none";
    return editor.tagName === "TEXTAREA" ? "textarea" : "contenteditable";
  });
}

/**
 * Activate a row by pressing its rendered text, which is what a user aims at.
 *
 * Deliberately not a fixed offset into the row box. Row spacing is `padding-top` on the row itself —
 * up to 28px above an h1 — and a press in that leading strip activates nothing, so a helper clicking
 * a constant `y: 10` silently failed to activate every heading and turned into 38 phantom failures
 * across this suite. Aiming at the glyphs keeps the matrix measuring the product instead of the
 * helper. Whether that leading strip *should* activate is a separate question, asked once and
 * explicitly in activation.spec.ts rather than contaminating every test here.
 */
export async function activate(row: Locator, anchorText?: string): Promise<void> {
  await row.scrollIntoViewIfNeeded();
  const page = row.page();
  const rect = anchorText ? await rectOfText(row, anchorText) : await firstTextRect(row);
  if (rect) {
    await page.mouse.click(rect.x + Math.min(6, rect.w / 2), rect.y + rect.h / 2);
  } else {
    const box = await row.boundingBox();
    if (box) await page.mouse.click(box.x + 100, box.y + box.height / 2);
  }
  await expect(row).toHaveAttribute("data-active", "true");
  // `data-active` flips when React re-renders the row, which is BEFORE the editing surface has
  // mounted and taken focus. Returning there let the next keystroke go to the document instead of
  // the Block: a test that pressed End and typed "/" produced "P /aragraph…" rather than a trailing
  // slash, and read as nine kinds unable to reach the slash menu. Wait for the surface to hold focus.
  await expect(row.locator("[data-native-block-editor]")).toBeFocused();
}

/** Client rect of the row's first non-empty rendered text, ignoring the gutter controls. */
export async function firstTextRect(
  row: Locator
): Promise<{ x: number; y: number; w: number; h: number } | null> {
  return row.evaluate((el) => {
    const content = el.querySelector("[data-native-block-content]") ?? el;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const value = (node.nodeValue ?? "").trim();
      const owner = node.parentElement;
      if (value && owner && !owner.closest("[data-native-block-controls], .sr-only")) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const r = range.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return { x: r.x, y: r.y, w: r.width, h: r.height };
      }
      node = walker.nextNode();
    }
    // A textarea holds its text outside the DOM; its own box is the best available target.
    const editor = content.querySelector("[data-native-block-editor]");
    if (editor) {
      const r = editor.getBoundingClientRect();
      if (r.width > 0) return { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    return null;
  });
}

/** Client rect of a substring inside a row, or null when it is not in the DOM (a textarea). */
export async function rectOfText(
  row: Locator,
  needle: string
): Promise<{ x: number; y: number; w: number; h: number } | null> {
  return row.evaluate((el, text) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const value = node.nodeValue ?? "";
      const at = value.indexOf(text);
      if (at >= 0) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + text.length);
        const r = range.getBoundingClientRect();
        if (r.width > 0) return { x: r.x, y: r.y, w: r.width, h: r.height };
      }
      node = walker.nextNode();
    }
    return null;
  }, needle);
}

/**
 * Select a word the way a user does, choosing the technique the present surface can honour.
 *
 * `technique` reports what was used so a failing assertion says whether the gesture was a real drag
 * or the double-click fallback — the two exercise different code and a matrix entry that does not
 * say which is not reproducible.
 */
export async function selectWord(
  page: Page,
  row: Locator,
  word: string
): Promise<{ technique: "drag" | "keyboard" | "unavailable" }> {
  // A table edits one cell at a time, so a drag aimed at a word in some *other* cell only moves the
  // active cell — the press lands on a rendered cell, not on an editing surface, and nothing gets
  // selected. Put the caret in the cell that holds the word first, then select inside it.
  const cell = row.locator("th,td").filter({ hasText: word }).first();
  if (
    (await cell.count()) > 0 &&
    (await cell.locator("[data-native-block-editor]").count()) === 0
  ) {
    await cell.click();
    await expect(cell.locator("[data-native-block-editor]")).toBeFocused();
  }
  const rect = await rectOfText(row, word);
  if (rect) {
    await page.mouse.move(rect.x + 1, rect.y + rect.h / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.w * 0.5, rect.y + rect.h / 2, { steps: 5 });
    await page.mouse.move(rect.x + rect.w - 1, rect.y + rect.h / 2, { steps: 5 });
    await page.mouse.up();
    return { technique: "drag" };
  }
  // A textarea's value is not in the DOM, so there are no glyph rects to drag across. Aiming a
  // double-click at a guessed offset just selects whichever word happens to be there — it reported
  // "Paragraph" when asked for "bravo". Real arrow keys reach an exact range in either surface.
  const editor = row.locator("[data-native-block-editor]").first();
  if ((await editor.count()) === 0) return { technique: "unavailable" };
  const at = await editor.evaluate((el, text) => {
    const value = (el as HTMLTextAreaElement).value ?? el.textContent ?? "";
    return value.indexOf(text);
  }, word);
  if (at < 0) return { technique: "unavailable" };

  await editor.click();
  // To the very start of the field, then forward by exact offsets. Cmd+Up is the macOS binding and
  // Control+Home the other one; the caret is read back rather than assumed.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home");
  let start = await editor.evaluate((el) => (el as HTMLTextAreaElement).selectionStart ?? -1);
  if (start !== 0) {
    const box = await editor.boundingBox();
    if (box) await page.mouse.click(box.x + 1, box.y + 2);
    await page.keyboard.press("Home");
    start = await editor.evaluate((el) => (el as HTMLTextAreaElement).selectionStart ?? -1);
  }
  if (start !== 0) return { technique: "unavailable" };
  for (let index = 0; index < at; index += 1) await page.keyboard.press("ArrowRight");
  for (let index = 0; index < word.length; index += 1)
    await page.keyboard.press("Shift+ArrowRight");
  return { technique: "keyboard" };
}

export interface SelectionState {
  readonly surface: SurfaceKind;
  readonly text: string;
  readonly insideEditor: boolean;
}

/** The current selection, read from whichever surface owns it. */
export async function selectionState(page: Page): Promise<SelectionState> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const isTextarea = active?.tagName === "TEXTAREA";
    if (isTextarea) {
      const ta = active as HTMLTextAreaElement;
      const from = ta.selectionStart ?? 0;
      const to = ta.selectionEnd ?? 0;
      return {
        surface: "textarea" as const,
        text: ta.value.slice(from, to),
        insideEditor: true,
      };
    }
    const selection = window.getSelection();
    const anchor = selection?.anchorNode ?? null;
    const anchorElement =
      anchor && anchor.nodeType === 1 ? (anchor as Element) : (anchor?.parentElement ?? null);
    const insideEditor = !!anchorElement?.closest("[data-native-block-row]");
    return {
      surface: active?.isContentEditable ? ("contenteditable" as const) : ("none" as const),
      text: selection && !selection.isCollapsed && insideEditor ? selection.toString() : "",
      insideEditor,
    };
  });
}

export interface ToolbarState {
  readonly present: boolean;
  readonly typeLabel: string;
  readonly pressed: Record<string, string | null>;
}

/** The floating inline format toolbar, portalled onto `document.body`. */
export async function toolbarState(page: Page): Promise<ToolbarState> {
  return page.evaluate(() => {
    const toolbar = document.querySelector('[role="toolbar"][aria-label="Text formatting"]');
    if (!toolbar) return { present: false, typeLabel: "", pressed: {} };
    const pressed: Record<string, string | null> = {};
    for (const button of [...toolbar.querySelectorAll("button[aria-label]")]) {
      pressed[button.getAttribute("aria-label")!] = button.getAttribute("aria-pressed");
    }
    const type = toolbar.querySelector('button[aria-label^="Change block type"]');
    return {
      present: true,
      typeLabel: (type?.getAttribute("aria-label") ?? "").replace("Change block type: ", ""),
      pressed,
    };
  });
}

/**
 * The text an editing surface is showing, whichever kind of surface it is.
 *
 * `toHaveValue` throws "not an input element" on a contenteditable, and a table cell is one, so any
 * assertion that has to hold for every kind goes through this instead.
 */
export async function surfaceTextOf(row: Locator): Promise<string> {
  return row
    .locator("[data-native-block-editor]")
    .first()
    .evaluate((el) => (el instanceof HTMLTextAreaElement ? el.value : (el.textContent ?? "")));
}

export async function activeSurfaceText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector(
      '[data-native-block-row][data-active="true"] [data-native-block-editor]'
    );
    if (!el) return "";
    return el instanceof HTMLTextAreaElement ? el.value : (el.textContent ?? "");
  });
}

/** The gutter controls for a row, which only exist while it is hovered, focused or menu-open. */
export function gutter(row: Locator): Locator {
  return row.locator("[data-native-block-controls]");
}

/** Open a row's Block actions menu, revealing the gutter first the way a pointer would. */
export async function openBlockMenu(row: Locator): Promise<Locator> {
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  await gutter(row).getByRole("button", { name: "Block actions" }).click();
  const menu = row.page().getByRole("menu", { name: "Block actions menu" });
  await expect(menu).toBeVisible();
  return menu;
}

/**
 * The caret offset inside the active surface, in that surface's own coordinates.
 *
 * A textarea counts raw source characters; the semantic editor counts *visible* characters, with
 * Markdown delimiters hidden. The two are not comparable, so `space` says which one this is and any
 * assertion has to respect it.
 */
export async function caretOffset(
  page: Page
): Promise<{ space: "source" | "visible" | "none"; offset: number | null; collapsed: boolean }> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active?.tagName === "TEXTAREA") {
      const ta = active as HTMLTextAreaElement;
      return {
        space: "source" as const,
        offset: ta.selectionStart,
        collapsed: ta.selectionStart === ta.selectionEnd,
      };
    }
    if (active?.isContentEditable) {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return { space: "visible" as const, offset: null, collapsed: true };
      }
      const range = selection.getRangeAt(0).cloneRange();
      const measure = range.cloneRange();
      measure.selectNodeContents(active);
      measure.setEnd(range.startContainer, range.startOffset);
      return {
        space: "visible" as const,
        offset: measure.toString().length,
        collapsed: selection.isCollapsed,
      };
    }
    return { space: "none" as const, offset: null, collapsed: true };
  });
}

/**
 * Type text through a real IME composition, as a Chinese or Japanese input method does.
 *
 * Playwright's `keyboard.type` produces one input event per character and never composes, so it
 * cannot exercise the composition path at all — and that path is where a Block editor most easily
 * breaks, because the editor must emit exactly one command at `compositionend` rather than one per
 * intermediate candidate. This drives CDP directly: `imeSetComposition` for each in-flight state,
 * then `insertText` to commit, which is the sequence Chromium itself produces.
 */
export async function typeWithIme(page: Page, text: string): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    for (let length = 1; length <= text.length; length += 1) {
      const partial = text.slice(0, length);
      await session.send("Input.imeSetComposition", {
        text: partial,
        selectionStart: partial.length,
        selectionEnd: partial.length,
      });
    }
    await session.send("Input.insertText", { text });
  } finally {
    await session.detach();
  }
}

/**
 * Undo, or redo, through whatever the app left focused.
 *
 * The invariant worth holding is that a command leaves *some* keyboard route back, not that it leaves
 * one particular kind of route. A gutter command leaves a caret in the Block, not a Block selection —
 * measured: after Duplicate the row is `data-active="true"`, focus is on the Block's editor, nothing
 * is `data-block-selected`, and Ctrl/Cmd+Z from there restores both the row count and the file.
 * Helpers that insisted on a selected row instead reported 32 failures against behaviour that was
 * correct. So this asserts the real requirement — focus is somewhere in the editor — and sends the
 * keystroke there.
 */
export async function pressUndo(page: Page): Promise<void> {
  await expect(page.locator("[data-native-markdown-runtime] :focus")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
}

export async function pressRedo(page: Page): Promise<void> {
  await expect(page.locator("[data-native-markdown-runtime] :focus")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+Shift+z");
}

/**
 * Move the caret to the start or end of its line using the binding the platform actually has.
 *
 * On macOS, `Home` and `End` do not move the caret in a text field at all — they are scroll keys, and
 * end-of-line is Cmd+Right. Pressing `End` there is silently inert, which made nine kinds look unable
 * to reach the slash menu: the test pressed End, typed "/", and the characters landed at offset 1, so
 * the file read `P /aragraph…` instead of a trailing slash. The menu had opened correctly the whole
 * time. Anything needing line-edge motion must go through these.
 */
export async function pressLineEnd(page: Page): Promise<void> {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowRight" : "End");
}

export async function pressLineStart(page: Page): Promise<void> {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowLeft" : "Home");
}

/** Every row's kind, in document order — the cheapest way to assert a structural change. */
export async function kindsInOrder(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-native-block-row]")].map(
      (row) => (row as HTMLElement).dataset.blockKind ?? "?"
    )
  );
}

export async function readSource(opened: OpenedPage): Promise<string> {
  return readFile(opened.path, "utf8");
}

/** Assert the file on disk still holds exactly `source`, allowing for autosave's debounce. */
export async function expectSourceUnchanged(opened: OpenedPage, source: string): Promise<void> {
  await expect.poll(() => readFile(opened.path, "utf8"), { timeout: 3000 }).toBe(source);
}

/** Every Block kind the editor renders, with a fixture line and a word safe to select inside it. */
export interface KindFixture {
  readonly kind: string;
  readonly label: string;
  readonly source: string;
  /** A word present in the rendered output, for selection tests. Null when the kind renders no text. */
  readonly word: string | null;
  /** True when the kind has no inline projection, so it edits as raw source. */
  readonly sourceOnly: boolean;
  /** What the inline toolbar's type chip says for this kind, in the product's own wording. */
  readonly toolbarType?: string;
}

export const KIND_FIXTURES: readonly KindFixture[] = [
  {
    kind: "paragraph",
    label: "paragraph",
    source: "Paragraph alpha bravo charlie.",
    word: "bravo",
    sourceOnly: false,
    toolbarType: "Text",
  },
  {
    kind: "heading",
    label: "heading 1",
    source: "# Heading hone alpha",
    word: "hone",
    sourceOnly: false,
    toolbarType: "Heading 1",
  },
  {
    kind: "heading",
    label: "heading 2",
    source: "## Heading htwo alpha",
    word: "htwo",
    sourceOnly: false,
    toolbarType: "Heading 2",
  },
  {
    kind: "heading",
    label: "heading 3",
    source: "### Heading hthree alpha",
    word: "hthree",
    sourceOnly: false,
    toolbarType: "Heading 3",
  },
  {
    kind: "heading",
    label: "heading 4",
    source: "#### Heading hfour alpha",
    word: "hfour",
    sourceOnly: false,
    toolbarType: "Heading 4",
  },
  {
    kind: "heading",
    label: "heading 5",
    source: "##### Heading hfive alpha",
    word: "hfive",
    sourceOnly: false,
    toolbarType: "Heading 5",
  },
  {
    kind: "heading",
    label: "heading 6",
    source: "###### Heading hsix alpha",
    word: "hsix",
    sourceOnly: false,
    toolbarType: "Heading 6",
  },
  {
    kind: "bullet_list_item",
    label: "bulleted list",
    source: "- Bullet bitem alpha",
    word: "bitem",
    sourceOnly: false,
    toolbarType: "Bulleted list",
  },
  {
    kind: "ordered_list_item",
    label: "numbered list",
    source: "1. Ordered oitem alpha",
    word: "oitem",
    sourceOnly: false,
    toolbarType: "Numbered list",
  },
  {
    kind: "task_list_item",
    label: "to-do",
    source: "- [ ] Task titem alpha",
    word: "titem",
    sourceOnly: false,
    toolbarType: "To-do",
  },
  {
    kind: "blockquote",
    label: "quote",
    source: "> Quote qitem alpha",
    word: "qitem",
    sourceOnly: false,
    toolbarType: "Quote",
  },
  {
    kind: "fenced_code",
    label: "code",
    source: "```ts\nconst codeword = 1;\n```",
    word: "codeword",
    sourceOnly: true,
  },
  {
    kind: "block_math",
    label: "equation",
    source: "$$\nE = mc^2\n$$",
    word: null,
    sourceOnly: true,
  },
  {
    kind: "callout",
    label: "callout",
    source: "> [!NOTE]\n> Callout citem alpha",
    word: "citem",
    sourceOnly: true,
  },
  {
    kind: "toggle",
    label: "toggle",
    source: "<details>\n<summary>Toggle titem</summary>\n\nBody\n\n</details>",
    word: "titem",
    sourceOnly: true,
  },
  {
    kind: "table",
    label: "table",
    source: "| head | two |\n| - | - |\n| cellword | 2 |",
    word: "cellword",
    sourceOnly: true,
  },
  { kind: "thematic_break", label: "divider", source: "---", word: null, sourceOnly: true },
  {
    kind: "unsupported",
    label: "unsupported",
    source: "<div>raw uitem block</div>",
    word: "uitem",
    sourceOnly: true,
  },
];

/** One Page containing every kind above, separated so each becomes its own Block. */
export function everyKindSource(): string {
  return `${KIND_FIXTURES.map((fixture) => fixture.source).join("\n\n")}\n`;
}
