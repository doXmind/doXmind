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
  caretOffset,
  expectSourceUnchanged,
  gutter,
  openBlockMenu,
  pressLineEnd,
  pressUndo,
  openPage,
  readSource,
  rows,
  surfaceOf,
  type OpenedPage,
} from "./harness";

/**
 * The two menus a Block is operated through: the gutter's Add button and Block actions menu, and the
 * caret-anchored slash menu.
 *
 * Both are portalled onto `document.body`, so both are places where a press can be delivered to the
 * React tree while its DOM ancestors are `<body>`. Every test that mutates asserts the Markdown file,
 * because a menu that rewrites the wrong prefix corrupts the user's document silently — the rendered
 * row can look right while the bytes on disk no longer say what the Block is.
 */

/** A second Block after every fixture, so an insertion or a move can be proved not to have eaten it. */
const TAIL = "Tail paragraph.\n";

/**
 * A Block before every fixture too, so the fixture is never the Page's first Block.
 *
 * Partly to exercise both of the anchor's boundaries, and partly because a Page that *starts* with
 * `---` is ambiguous — a leading blank line makes the divider fixture unambiguously a thematic break
 * rather than an unterminated frontmatter fence or a setext underline.
 */
const LEAD = "Lead paragraph.\n";

/** The one paragraph the Turn into cases convert back and forth. */
const TURN_TARGET = "Turn target alpha";

/**
 * The Turn into options, mirrored from `TURN_INTO_OPTIONS` in `block-gutter-controls.tsx` together
 * with the Markdown prefix `setKind` writes for each in `markdown-block-document.ts`.
 *
 * Duplicated rather than imported because the source of truth is a `.tsx` module that pulls in React
 * and `lucide-react`; the point of the duplication is that a prefix changing on one side without the
 * other is exactly the silent corruption these tests exist to catch.
 */
const TURN_INTO_OPTIONS: readonly { label: string; prefix: string }[] = [
  { label: "Text", prefix: "" },
  { label: "Heading 1", prefix: "# " },
  { label: "Heading 2", prefix: "## " },
  { label: "Heading 3", prefix: "### " },
  { label: "Heading 4", prefix: "#### " },
  { label: "Heading 5", prefix: "##### " },
  { label: "Heading 6", prefix: "###### " },
  { label: "Bulleted list", prefix: "- " },
  { label: "Numbered list", prefix: "1. " },
  { label: "To-do", prefix: "- [ ] " },
  { label: "Quote", prefix: "> " },
];

/** Assert the file on disk holds exactly `expected`, allowing for autosave's debounce. */
async function expectSource(opened: OpenedPage, expected: string): Promise<void> {
  await expect.poll(() => readSource(opened)).toBe(expected);
}

/**
 * Let the renderer finish the work a keystroke queued.
 *
 * An assertion that a menu did *not* open passes on its first evaluation, so read straight after
 * typing it proves nothing: the slash panel needs one commit to decide it is open and a second for
 * the effect that measures its caret anchor to place it. Without this barrier a menu that opens one
 * frame late reads as a menu that never opened, and the test that exists to keep `src/lib` typeable
 * would go green while the panel jumped in front of the user. Two frames, not a timeout, so the wait
 * is bounded by the renderer rather than by a guess.
 */
async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
}

/**
 * Press a row's gutter `+`.
 *
 * The controls carry `pointer-events: none` until the row is hovered, so the hover is part of the
 * gesture rather than a nicety. `above` is Option/Alt-click, which the button reads off `event.altKey`.
 */
async function pressAdd(row: Locator, placement: "below" | "above"): Promise<void> {
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  const add = gutter(row).getByRole("button", { name: "Add block" });
  await expect(add).toBeVisible();
  if (placement === "above") await add.click({ modifiers: ["Alt"] });
  else await add.click();
}

/**
 * Open a row's Block actions menu and step into its Turn into options, returning *that* panel.
 *
 * The options are a second `role="menu"` beside the actions rather than a swap of the actions'
 * rows, so the locator every caller here works against is the submenu, not the panel it hangs off.
 */
async function openTurnInto(row: Locator): Promise<Locator> {
  const menu = await openBlockMenu(row);
  await menu.getByRole("menuitem", { name: "Turn into", exact: true }).click();
  const options = row.page().getByRole("menu", { name: "Turn into" });
  await expect(options).toBeVisible();
  // The actions the press was aimed past are still on screen. A panel that had swapped its rows
  // instead would have moved every one of them under a pointer that had not moved.
  await expect(menu.getByRole("menuitem", { name: "Copy Markdown", exact: true })).toBeVisible();
  return options;
}

type Box = { x: number; y: number; width: number; height: number };

/**
 * A box read after it has stopped changing on its own.
 *
 * The panel enters with `zoom-in-95` over 0.15s, so a box read the instant it becomes visible is a
 * box mid-animation: the Turn into row measured 208.73px on the way in and 210.34px at rest, and
 * comparing the two reads a 1.6px scale step as a relayout.
 *
 * One matching pair is not enough to call that finished. The panel's placement is corrected by a
 * layout effect that deliberately runs on every commit of an open menu (see `dropdown-menu.tsx`), so
 * a correction can land *after* two consecutive polls have already matched — the box looks settled
 * for one 50ms window and then moves. That read the "Turn into" trigger 2.837px from where it
 * finished on CI, against 0.000 across five headless trials on an idle machine. Two matching pairs
 * close that window; the budget is 4s because under a full suite the frames this waits on compete
 * with every other worker.
 */
async function settledBox(target: Locator): Promise<Box> {
  let previous: Box | null = null;
  let stable = 0;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const box = await target.boundingBox();
    if (
      box &&
      previous &&
      Math.abs(box.x - previous.x) < 0.01 &&
      Math.abs(box.y - previous.y) < 0.01 &&
      Math.abs(box.width - previous.width) < 0.01 &&
      Math.abs(box.height - previous.height) < 0.01
    ) {
      stable += 1;
      if (stable >= 2) return box;
    } else {
      stable = 0;
    }
    previous = box;
    await target.page().waitForTimeout(50);
  }
  throw new Error("box never settled");
}

/** The menu row a viewport point lands on, named the way the user reads it. */
async function rowLabelAt(page: Page, x: number, y: number): Promise<string | null> {
  return page.evaluate(
    ([px, py]) => {
      const row = document.elementFromPoint(px, py)?.closest('[role="menuitem"]');
      return row ? (row.getAttribute("aria-label") ?? row.textContent?.trim() ?? null) : null;
    },
    [x, y] as const
  );
}

async function turnInto(row: Locator, label: string): Promise<void> {
  const menu = await openTurnInto(row);
  const option = menu.getByRole("menuitem", { name: label, exact: true });
  await expect(option).toBeEnabled();
  await option.click();
  await expect(menu).toBeHidden();
}

/** Choose an item in an already-open Block actions menu. */
async function chooseAction(row: Locator, label: string): Promise<void> {
  const menu = await openBlockMenu(row);
  const item = menu.getByRole("menuitem", { name: label, exact: true });
  await expect(item).toBeEnabled();
  await item.click();
  await expect(menu).toBeHidden();
}

/** The caret-anchored insert panel, portalled onto `document.body`. */
function slashMenu(page: Page): Locator {
  return page.getByRole("listbox", { name: "Block commands" });
}

/**
 * An empty first Block, created the way a user creates one: Option-clicking the gutter `+`.
 *
 * The slash cases need an empty Block to type a trigger into, and it has to be the Page's *first*
 * Block. `onRunSlashCommand` looks the caret's destination up by comparing a Block-relative offset
 * against document-relative Block spans, which only coincide at document offset 0 — see the separate
 * test that runs a command in a later Block and asserts the caret stays there.
 */
async function emptyFirstBlock(page: Page): Promise<Locator> {
  await pressAdd(rows(page).first(), "above");
  const created = rows(page).first();
  await expect(created).toHaveAttribute("data-active", "true");
  // Scoped to the new row on purpose. A page-wide match would also be satisfied by a focused editor
  // belonging to some other Block, which is exactly the failure the caret assertions here look for.
  await expect(created.locator("[data-native-block-editor]")).toBeFocused();
  return created;
}

/*
 * The gutter's Add button.
 *
 * One test per kind because insertion is kind-dependent: next to a list item the new Block continues
 * the list at the anchor's own prefix and depth, and it has to land after the anchor's whole subtree.
 * Getting that wrong reflows every following sibling in the user's file.
 */
for (const fixture of KIND_FIXTURES) {
  test(`${fixture.label}: the gutter Add button inserts a Block below`, async ({ page }) => {
    const source = `${LEAD}\n${fixture.source}\n\n${TAIL}`;
    const opened = await openPage(page, "Gutter", source);
    // Three Blocks, or the fixture is not the single Block this test assumes and every byte assertion
    // below would be measuring the wrong insertion point.
    await expect(rows(page)).toHaveCount(3);

    await pressAdd(rows(page).nth(1), "below");
    await expect(rows(page)).toHaveCount(4);
    const created = rows(page).nth(2);
    await expect(created).toHaveAttribute("data-active", "true");
    // Scoped to the new row: a page-wide match would pass just as happily if the caret had been
    // handed to a different Block, and the byte assertion below would then be the first sign of it.
    await expect(created.locator("[data-native-block-editor]")).toBeFocused();

    // Typing is what proves the caret landed in the new Block: an empty Block has no bytes of its
    // own, so a Page whose new Block was never focused would look identical on disk.
    await page.keyboard.type("Inserted");

    const listPrefix =
      fixture.kind === "bullet_list_item"
        ? "- "
        : fixture.kind === "ordered_list_item"
          ? "2. "
          : fixture.kind === "task_list_item"
            ? "- [ ] "
            : null;
    // A list sibling joins the same list with a single newline; anything else is a new paragraph and
    // needs the blank line that keeps it a separate Block.
    const expected = listPrefix
      ? `${LEAD}\n${fixture.source}\n${listPrefix}Inserted\n\n${TAIL}`
      : `${LEAD}\n${fixture.source}\n\nInserted\n\n${TAIL}`;
    await expectSource(opened, expected);
  });
}

test("Option-clicking Add inserts the new Block above the anchor", async ({ page }) => {
  const source = `Alpha paragraph.\n\n${TAIL}`;
  const opened = await openPage(page, "Above", source);

  await pressAdd(rows(page).first(), "above");
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).first()).toHaveAttribute("data-active", "true");
  await page.keyboard.type("Above");

  await expectSource(opened, `Above\n\nAlpha paragraph.\n\n${TAIL}`);
});

test("Option-clicking Add above a list item continues the list", async ({ page }) => {
  const source = `- Bullet one\n- Bullet two\n\n${TAIL}`;
  const opened = await openPage(page, "AboveList", source);

  await pressAdd(rows(page).nth(1), "above");
  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).nth(1)).toHaveAttribute("data-active", "true");
  await page.keyboard.type("Inserted above");

  // A bare paragraph here would end the list and reparse the following items at depth 0, so the new
  // Block must carry the anchor's own marker.
  await expectSource(opened, `- Bullet one\n- Inserted above\n- Bullet two\n\n${TAIL}`);
});

test("the Add button's tooltip records both placements", async ({ page }) => {
  const source = `Alpha paragraph.\n\n${TAIL}`;
  const opened = await openPage(page, "Tip", source);
  const row = rows(page).first();
  await row.hover();
  await gutter(row).getByRole("button", { name: "Add block" }).hover();

  // The tooltip is a portalled `<div>` with no `role="tooltip"` and no `aria-describedby` back to the
  // button, so its text is the only handle there is. Asserted anyway: Option-click is undiscoverable
  // unless the control says so.
  const secondLine = page.getByText("⌥-click to add above", { exact: true });
  await expect(secondLine).toBeVisible();
  const tooltip = secondLine.locator("..");
  await expect(tooltip).toContainText("Click to add below");
  await expect(tooltip).toContainText("⌥-click to add above");

  await expectSourceUnchanged(opened, source);
});

/*
 * Turn into.
 *
 * One test per target kind, asserting the file each time, because this is the single place where a
 * wrong prefix rewrites the meaning of a Block without changing anything the user can see until they
 * reopen the Page.
 */
for (const option of TURN_INTO_OPTIONS) {
  test(`${option.label}: Turn into writes the Markdown prefix and converts back`, async ({
    page,
  }) => {
    const source = `${TURN_TARGET}\n\n${TAIL}`;
    const opened = await openPage(page, "TurnInto", source);

    if (option.prefix === "") {
      // "Text" is what this Block already is. The menu must mark it as the current kind, and choosing
      // it must be byte-identical: a no-op conversion that rewrote the file would show up as a
      // spurious diff in the user's version control.
      const menu = await openTurnInto(rows(page).first());
      const current = menu.getByRole("menuitem", { name: option.label, exact: true });
      await expect(current).toHaveAttribute("aria-current", "true");
      await current.click();
      await expectSourceUnchanged(opened, source);
      return;
    }

    await turnInto(rows(page).first(), option.label);
    await expectSource(opened, `${option.prefix}${TURN_TARGET}\n\n${TAIL}`);

    // And back. A Block that came from a paragraph has to end up as exactly that paragraph again,
    // with the marker removed rather than left behind as literal text.
    await turnInto(rows(page).first(), "Text");
    await expectSource(opened, source);
  });
}

/**
 * The press that used to retype the Block.
 *
 * "Turn into" once swapped the panel's rows in place. Measured: the panel grew 270.5px -> 396.0px in
 * a single unanimated frame (computed `transition: all 0s`) under a pointer that had not moved, and
 * the pixel under that pointer changed from "Turn into" to "Text". A second press at the same
 * coordinates then converted the Block — `## Heading two alpha` became `Heading two alpha` on disk,
 * 4/4, at inter-press gaps of 80/120/200/350ms. Undoable, so a silent mis-type rather than data
 * loss, but an edit nobody asked for, and inherent to moving rows under a stationary pointer.
 *
 * A side-opening submenu removes it structurally rather than by timing: the parent panel's box never
 * changes, so the row under the pointer is still the row the pointer chose. That is what this
 * asserts — the geometry, and then the bytes.
 *
 * The read is deliberately late. Autosave debounces, and a file read sooner than ~2.5s after the
 * press reports the *old* contents and passes whether or not the Block was retyped.
 */
test("a second press on Turn into at the same point never retypes the Block", async ({ page }) => {
  const source = `## Heading two alpha\n\n${TAIL}`;
  const opened = await openPage(page, "TurnIntoStationary", source);
  const row = rows(page).first();
  const menu = await openBlockMenu(row);
  const trigger = menu.getByRole("menuitem", { name: "Turn into", exact: true });

  const panelBefore = await settledBox(menu);
  const rowBefore = await settledBox(trigger);
  const x = rowBefore.x + rowBefore.width / 2;
  const y = rowBefore.y + rowBefore.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  await expect(page.getByRole("menu", { name: "Turn into" })).toBeVisible();

  // Nothing under the pointer moved, and the panel is the height it was.
  //
  // The tolerance is 1px, not the 0.05px `toBeCloseTo(…, 1)` gives. The defect this pins moved the
  // panel 125.5px and the row out from under the pointer entirely, so a pixel is a decisive
  // threshold; anything tighter asserts on the tail of the `zoom-in-95` entry animation, which
  // measures 208.73px against 210.34px at rest and settles at whatever rate the machine allows.
  // The claim being made is "a human would see nothing move", and that is what 1px says.
  const panelAfter = await settledBox(menu);
  const rowAfter = await settledBox(trigger);
  expect(Math.abs(rowAfter.y - rowBefore.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(panelAfter.height - panelBefore.height)).toBeLessThanOrEqual(1);
  expect(await rowLabelAt(page, x, y)).toBe("Turn into");

  await page.waitForTimeout(120);
  await page.mouse.click(x, y);
  await expect(page.getByRole("menu", { name: "Turn into" })).toBeVisible();
  expect(await rowLabelAt(page, x, y)).toBe("Turn into");

  await page.waitForTimeout(2500);
  expect(await readSource(opened)).toBe(source);
  await expect(row).toHaveAttribute("data-block-kind", "heading");
});

/*
 * Which kinds Turn into applies to.
 *
 * The row passes `canTurnInto={block.editable && !sourceOnly}`, and the menu renders the options
 * disabled rather than hiding them, so the assertion is on the disabled state — a hidden-versus-
 * disabled difference is a product decision, and this records the one the source actually makes.
 */
for (const fixture of KIND_FIXTURES) {
  test(`${fixture.label}: Turn into is offered only where the kind is convertible`, async ({
    page,
  }) => {
    const source = `${LEAD}\n${fixture.source}\n\n${TAIL}`;
    const opened = await openPage(page, "Convertible", source);
    await expect(rows(page)).toHaveCount(3);
    const row = rows(page).nth(1);

    const menu = await openBlockMenu(row);
    // `toolbarType` is the product's own name for each settable kind; the kinds that have none are
    // exactly the source-only ones, which the menu heads with "Source block".
    const currentLabel = fixture.toolbarType ?? "Source block";
    // The heading is a plain `<div>` with no role, so its exact text is the only handle. It is worth
    // asserting: it is the only place the menu says which Block you are about to operate on.
    await expect(menu.getByText(currentLabel, { exact: true })).toBeVisible();

    await menu.getByRole("menuitem", { name: "Turn into", exact: true }).click();
    const options = page.getByRole("menu", { name: "Turn into" });
    await expect(options).toBeVisible();
    const text = options.getByRole("menuitem", { name: "Text", exact: true });
    const marked = options.locator('[role="menuitem"][aria-current="true"]');
    if (fixture.sourceOnly) {
      // A source-only Block edits as raw Markdown and `setKind` refuses it outright, so offering the
      // conversion as available would be a lie that ends in a thrown command.
      await expect(text).toBeDisabled();
      await expect(marked).toHaveCount(0);
    } else {
      await expect(text).toBeEnabled();
      await expect(marked).toHaveCount(1);
      await expect(marked).toHaveAttribute("aria-label", currentLabel);
    }

    // One level per press: the options go first, and only then the menu they opened from. Escaping
    // out of a submenu should never take the panel behind it with it.
    await page.keyboard.press("Escape");
    await expect(options).toBeHidden();
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    // Opening and closing a menu is never an edit.
    await expectSourceUnchanged(opened, source);
  });
}

/*
 * The structural actions, each one undo step.
 */

test("Duplicate copies the Block with its list subtree in one undo step", async ({ page }) => {
  const source = `- Parent\n  - Child\n\n${TAIL}`;
  const opened = await openPage(page, "Duplicate", source);
  await expect(rows(page)).toHaveCount(3);

  await chooseAction(rows(page).first(), "Duplicate");

  // The child comes with the parent. Duplicating the parent alone would leave the copy childless and
  // reparent nothing, which is not what "duplicate this Block" means for a nested list.
  await expect(rows(page)).toHaveCount(5);
  await expectSource(opened, `- Parent\n  - Child\n- Parent\n  - Child\n\n${TAIL}`);

  await pressUndo(page);
  await expectSource(opened, source);
  await expect(rows(page)).toHaveCount(3);
});

test("Delete removes the Block in one undo step", async ({ page }) => {
  const source = "Alpha paragraph.\n\nBeta paragraph.\n\nGamma paragraph.\n";
  const opened = await openPage(page, "Delete", source);

  await chooseAction(rows(page).nth(1), "Delete");

  await expect(rows(page)).toHaveCount(2);
  // The blank line between the survivors has to survive too, or Alpha and Gamma silently merge into
  // one paragraph the next time the file is read.
  await expectSource(opened, "Alpha paragraph.\n\nGamma paragraph.\n");

  await pressUndo(page);
  await expectSource(opened, source);
  await expect(rows(page)).toHaveCount(3);
});

test("Move up reorders the Block and is unavailable at the top", async ({ page }) => {
  const source = "Alpha paragraph.\n\nBeta paragraph.\n\nGamma paragraph.\n";
  const opened = await openPage(page, "MoveUp", source);

  const topMenu = await openBlockMenu(rows(page).first());
  // Nowhere to go. An enabled control that does nothing is worse than a disabled one.
  await expect(topMenu.getByRole("menuitem", { name: "Move up", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(topMenu).toBeHidden();

  await chooseAction(rows(page).nth(1), "Move up");
  await expectSource(opened, "Beta paragraph.\n\nAlpha paragraph.\n\nGamma paragraph.\n");

  await pressUndo(page);
  await expectSource(opened, source);
});

test("Move down reorders the Block and is unavailable at the bottom", async ({ page }) => {
  const source = "Alpha paragraph.\n\nBeta paragraph.\n\nGamma paragraph.\n\nDelta paragraph.\n";
  const opened = await openPage(page, "MoveDown", source);

  const bottomMenu = await openBlockMenu(rows(page).nth(3));
  const moveDown = bottomMenu.getByRole("menuitem", { name: "Move down", exact: true });
  await expect(moveDown).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(bottomMenu).toBeHidden();

  await chooseAction(rows(page).nth(1), "Move down");
  await expectSource(
    opened,
    "Alpha paragraph.\n\nGamma paragraph.\n\nBeta paragraph.\n\nDelta paragraph.\n"
  );

  await pressUndo(page);
  await expectSource(opened, source);
});

/*
 * Opening a menu from a live caret.
 *
 * Pressing the grip is deliberately a Block-level gesture: the row's `onPointerDownCapture` selects
 * the Block, which releases the caret. That is the documented intent, and it is asserted here so a
 * regression that leaves the caret live — and the menu acting on a Block the user is mid-word in —
 * shows up as a failure rather than as a mysterious lost keystroke.
 */

test("opening the Block actions menu from a live caret selects the Block and edits nothing", async ({
  page,
}) => {
  const source = `${TURN_TARGET}\n\n${TAIL}`;
  const opened = await openPage(page, "FromCaret", source);
  const row = rows(page).first();
  await activate(row);
  expect(await surfaceOf(row)).not.toBe("none");

  const menu = await openBlockMenu(row);
  await expect(row).toHaveAttribute("data-block-selected", "true");
  await expect(row).toHaveAttribute("data-active", "false");
  // The search box takes focus so the menu is immediately typeable, which is also what keeps the
  // keystrokes that follow out of the Block.
  await expect(menu.getByRole("searchbox", { name: "Search block actions" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expectSourceUnchanged(opened, source);
});

test("a Turn into press from a live caret still converts that Block", async ({ page }) => {
  const source = `${TURN_TARGET}\n\n${TAIL}`;
  const opened = await openPage(page, "CaretConvert", source);
  const row = rows(page).first();
  await activate(row);

  // The menu is portalled onto `document.body`, so its press arrives at the runtime as though it came
  // from the Page. If that press tore the row's subtree down before the click, the conversion would
  // apply nothing at all and the file would be unchanged — the same failure that once made clicking
  // Bold do nothing.
  await turnInto(row, "Heading 2");
  await expectSource(opened, `## ${TURN_TARGET}\n\n${TAIL}`);
});

/*
 * The slash menu, per kind.
 *
 * The source-only kinds are skipped: the row computes a slash run only when `!sourceOnly`, because a
 * Block edited as raw Markdown has no place for an insert panel — `/` there is literal source text.
 * Every remaining kind must be able to reach the menu; deriving the trigger from the whole Block
 * instead of the caret once meant no heading, list item or quote could reach it at all.
 */
for (const fixture of KIND_FIXTURES.filter((candidate) => !candidate.sourceOnly)) {
  test(`${fixture.label}: / at the caret opens the Block commands menu`, async ({ page }) => {
    const source = `${LEAD}\n${fixture.source}\n\n${TAIL}`;
    const opened = await openPage(page, "SlashKind", source);
    await expect(rows(page)).toHaveCount(3);
    const row = rows(page).nth(1);
    await activate(row);
    await pressLineEnd(page);
    await page.keyboard.type(" /");

    const menu = slashMenu(page);
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("option", { name: "Heading 1" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    // Dismissing is not an edit, so the character the user typed stays exactly where they typed it.
    await expectSource(opened, `${LEAD}\n${fixture.source} /\n\n${TAIL}`);
  });
}

/*
 * The slash menu's own behaviour, on an empty paragraph.
 */

test("/ filters by title and inserts the chosen kind over the trigger run", async ({ page }) => {
  const opened = await openPage(page, "SlashInsert", "Alpha paragraph.\n\nBeta paragraph.\n");
  await emptyFirstBlock(page);

  await page.keyboard.type("/");
  const menu = slashMenu(page);
  await expect(menu).toBeVisible();
  expect(await menu.getByRole("option").count()).toBeGreaterThan(1);

  await page.keyboard.type("quote");
  await expect(menu.getByRole("option")).toHaveCount(1);
  await expect(menu.getByRole("option").first()).toContainText("Quote");

  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  // The typed `/quote` is replaced, not appended to: the trigger run is scaffolding, never content.
  await page.keyboard.type("Quoted line");
  await expectSource(opened, "> Quoted line\n\nAlpha paragraph.\n\nBeta paragraph.\n");
});

test("the full-width 、 opens the same menu and pinyin narrows it", async ({ page }) => {
  const opened = await openPage(page, "SlashFullwidth", "Alpha paragraph.\n\nBeta paragraph.\n");
  await emptyFirstBlock(page);

  // `、` is where `/` sits on a CJK keyboard. Requiring a mode switch to reach the insert panel is
  // the difference between the menu being usable and being invisible to half its users.
  await page.keyboard.type("、");
  const menu = slashMenu(page);
  await expect(menu).toBeVisible();

  await page.keyboard.type("biaoti");
  // Toneless full pinyin for 标题: the three heading commands and nothing else.
  await expect(menu.getByRole("option")).toHaveCount(3);
  const first = menu.getByRole("option").first();
  await expect(first).toContainText("Heading 1");
  await expect(first).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await page.keyboard.type("Pinyin heading");
  await expectSource(opened, "# Pinyin heading\n\nAlpha paragraph.\n\nBeta paragraph.\n");
});

test("Escape leaves the typed trigger in place and does not reopen the menu", async ({ page }) => {
  const opened = await openPage(page, "SlashEscape", "Alpha paragraph.\n\nBeta paragraph.\n");
  await emptyFirstBlock(page);

  await page.keyboard.type("/");
  const menu = slashMenu(page);
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // The dismissal is keyed on the trigger character's offset, so typing on stays dismissed. Keying it
  // on the Block's text instead reopened the menu on the very next keystroke and fought the user.
  await page.keyboard.type("table");
  await settleFrames(page);
  await expect(menu).toBeHidden();
  await expectSource(opened, "/table\n\nAlpha paragraph.\n\nBeta paragraph.\n");
});

test("a / inside a word is a literal slash and never opens the menu", async ({ page }) => {
  const source = "Docs live in src/lib and 2026/07.\n";
  const opened = await openPage(page, "SlashLiteral", source);
  const row = rows(page).first();
  await activate(row);
  await pressLineEnd(page);

  const menu = slashMenu(page);
  // Neither slash starts a word, so neither is a trigger — a file path and a date have to be typeable.
  await settleFrames(page);
  await expect(menu).toHaveCount(0);

  await page.keyboard.type(" more/paths");
  await settleFrames(page);
  await expect(menu).toHaveCount(0);

  // Positive control in the same test, so an absent menu cannot be an absent trigger mechanism: at a
  // word boundary the very same character does open it.
  await page.keyboard.type(" /");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  await expectSource(opened, "Docs live in src/lib and 2026/07. more/paths /\n");
});

test("clicking a slash-menu option keeps the caret in the Block", async ({ page }) => {
  const opened = await openPage(page, "SlashClick", "Alpha paragraph.\n\nBeta paragraph.\n");
  const row = await emptyFirstBlock(page);

  await page.keyboard.type("/todo");
  const menu = slashMenu(page);
  await expect(menu).toBeVisible();
  const option = menu.getByRole("option", { name: "To-do" });
  await expect(option).toBeVisible();
  await option.click();

  // The panel is portalled onto `document.body` and exempted from the runtime's "pressed outside the
  // editor, release the caret" listener by `data-native-editor-overlay`. Without that exemption the
  // press would deactivate the Block before the click ran and the command would apply nothing.
  await expect(row).toHaveAttribute("data-active", "true");
  expect(await surfaceOf(row)).not.toBe("none");
  const caret = await caretOffset(page);
  expect(caret.space, "the caret was released by the menu press").not.toBe("none");

  await page.keyboard.type("Task text");
  await expectSource(opened, "- [ ] Task text\n\nAlpha paragraph.\n\nBeta paragraph.\n");
});

test("a slash command run in a later Block leaves the caret in that Block", async ({ page }) => {
  const opened = await openPage(page, "SlashLater", "Alpha paragraph.\n\nBeta paragraph.\n");
  // Deliberately the *second* Block. `onRunSlashCommand` computes the caret as a Block-relative
  // offset and then finds its destination by comparing it against document-relative Block spans, so
  // any Block that does not start at document offset 0 is at risk of handing the caret — and the text
  // typed next — to whichever Block happens to contain that offset from the start of the Page.
  await pressAdd(rows(page).first(), "below");
  const created = rows(page).nth(1);
  await expect(created).toHaveAttribute("data-active", "true");

  await page.keyboard.type("/quote");
  const menu = slashMenu(page);
  await expect(menu.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();

  await expect(created).toHaveAttribute("data-active", "true");
  await page.keyboard.type("Quoted line");
  await expectSource(opened, "Alpha paragraph.\n\n> Quoted line\n\nBeta paragraph.\n");
});
