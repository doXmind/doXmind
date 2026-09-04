import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { BlockGutterControls } from "@/editor/markdown-block/block-gutter-controls";

function renderControls(overrides: Partial<ComponentProps<typeof BlockGutterControls>> = {}) {
  const props: ComponentProps<typeof BlockGutterControls> = {
    currentKind: "paragraph",
    onAdd: vi.fn(),
    onInsertKind: vi.fn(),
    onTurnInto: vi.fn(),
    onCopyMarkdown: vi.fn(),
    onDuplicate: vi.fn(),
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };

  return { ...render(<BlockGutterControls {...props} />), props };
}

describe("BlockGutterControls", () => {
  it("offers separate Add and six-dot action buttons without a persistent type select", async () => {
    const user = userEvent.setup();
    const { props } = renderControls();

    const controls = screen.getByRole("group", { name: "Block controls" });
    const add = screen.getByRole("button", { name: "Insert block" });
    const actions = screen.getByRole("button", { name: "Block actions" });

    expect(controls).toContainElement(add);
    expect(controls).toContainElement(actions);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    // The + asks which Block before it writes one. Nothing reaches the document on the press
    // itself, which is the difference from the blank paragraph it used to insert.
    await user.click(add);
    expect(screen.getByRole("menu", { name: "Insert block" })).toBeVisible();
    expect(props.onAdd).not.toHaveBeenCalled();
    expect(props.onInsertKind).not.toHaveBeenCalled();
  });

  it("inserts the Block kind chosen from the + menu, and nothing before that", async () => {
    const user = userEvent.setup();
    const { props } = renderControls();

    await user.click(screen.getByRole("button", { name: "Insert block" }));
    const menu = screen.getByRole("menu", { name: "Insert block" });
    // The same fourteen the caret-anchored slash panel offers, from the same source.
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(14);

    await user.click(within(menu).getByRole("menuitem", { name: "Table" }));

    expect(props.onInsertKind).toHaveBeenCalledWith("table", "below");
    expect(props.onAdd).not.toHaveBeenCalled();
  });

  it("filters the + menu, and takes Enter as the first match", async () => {
    const user = userEvent.setup();
    const { props } = renderControls();

    await user.click(screen.getByRole("button", { name: "Insert block" }));
    await user.type(screen.getByRole("searchbox", { name: "Search blocks" }), "quo");

    const menu = screen.getByRole("menu", { name: "Insert block" });
    expect(within(menu).getByRole("menuitem", { name: "Quote" })).toBeVisible();
    expect(within(menu).queryByRole("menuitem", { name: "Table" })).not.toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(props.onInsertKind).toHaveBeenCalledWith("quote", "below");
  });

  /**
   * The gesture the tooltip has promised since before the menu existed. It has to survive the
   * button becoming a menu trigger, which is why the press is intercepted in the capture phase
   * rather than left to the trigger's own click.
   */
  it("keeps ⌥-click inserting a blank Block above, without opening the menu", async () => {
    const user = userEvent.setup();
    const { props } = renderControls();

    await user.keyboard("{Alt>}");
    await user.click(screen.getByRole("button", { name: "Insert block" }));
    await user.keyboard("{/Alt}");

    expect(props.onAdd).toHaveBeenCalledWith("above");
    expect(props.onInsertKind).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu", { name: "Insert block" })).not.toBeInTheDocument();
  });

  it("opens a searchable Turn into menu from the grip", async () => {
    const user = userEvent.setup();
    const { props } = renderControls();

    await user.click(screen.getByRole("button", { name: "Block actions" }));

    const search = await screen.findByRole("searchbox", { name: "Search block actions" });
    expect(search).toHaveFocus();
    expect(screen.getByRole("menu", { name: "Block actions menu" })).toBeInTheDocument();

    await user.type(search, "heading 3");
    expect(screen.queryByRole("menuitem", { name: "Text" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Heading 3" }));

    expect(props.onTurnInto).toHaveBeenCalledWith("heading", 3);
    expect(screen.queryByRole("menu", { name: "Block actions menu" })).not.toBeInTheDocument();
  });

  it("opens the Turn into options beside the actions rather than over them", async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByRole("button", { name: "Block actions" }));
    expect(screen.getByRole("menuitem", { name: "Turn into" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Heading 3" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Turn into" }));
    const options = screen.getByRole("menu", { name: "Turn into" });
    expect(within(options).getByRole("menuitem", { name: "Heading 3" })).toBeVisible();

    // The whole point of the second panel: the rows that were already on screen are still on
    // screen, so the panel's box — and the row under a stationary pointer — never changes.
    const actions = screen.getByRole("menu", { name: "Block actions menu" });
    expect(within(actions).getByRole("menuitem", { name: "Turn into" })).toBeVisible();
    expect(within(actions).getByRole("menuitem", { name: "Copy Markdown" })).toBeVisible();
    expect(within(actions).getByRole("menuitem", { name: "Delete" })).toBeVisible();
  });

  /**
   * The gesture this submenu exists to make harmless.
   *
   * Picking "Turn into" used to swap the panel's rows in place, which put "Text" under a pointer
   * that had not moved: a second press at the same point retyped the Block, 4/4, at gaps of
   * 80/120/200/350ms. Here the same node is pressed twice, which is what a stationary pointer
   * delivers; the pixel-level version, with the file read after autosave, is in
   * tests/e2e/block-ux/menus.spec.ts.
   */
  it("never converts the Block when Turn into is pressed twice without moving", async () => {
    const user = userEvent.setup();
    const { props } = renderControls({ currentKind: "heading", currentLevel: 2 });

    await user.click(screen.getByRole("button", { name: "Block actions" }));
    const turnInto = screen.getByRole("menuitem", { name: "Turn into" });
    await user.click(turnInto);
    await user.click(turnInto);

    expect(screen.getByRole("menu", { name: "Turn into" })).toBeInTheDocument();
    expect(props.onTurnInto).not.toHaveBeenCalled();
  });

  it("copies the canonical Markdown through its callback", async () => {
    const user = userEvent.setup();
    const { props } = renderControls();

    await user.click(screen.getByRole("button", { name: "Block actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Copy Markdown" }));

    expect(props.onCopyMarkdown).toHaveBeenCalledOnce();
  });

  it("duplicates the block from the compact menu", async () => {
    const user = userEvent.setup();
    const { props } = renderControls();

    await user.click(screen.getByRole("button", { name: "Block actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Duplicate" }));

    expect(props.onDuplicate).toHaveBeenCalledOnce();
  });

  it("keeps boundary moves disabled while routing an available move", async () => {
    const user = userEvent.setup();
    const { props } = renderControls({ canMoveUp: false, canMoveDown: true });

    await user.click(screen.getByRole("button", { name: "Block actions" }));
    const moveUp = await screen.findByRole("menuitem", { name: "Move up" });
    const moveDown = screen.getByRole("menuitem", { name: "Move down" });

    expect(moveUp).toBeDisabled();
    await user.click(moveUp);
    expect(props.onMoveUp).not.toHaveBeenCalled();

    await user.click(moveDown);
    expect(props.onMoveDown).toHaveBeenCalledOnce();
  });

  it("routes the destructive Delete action and closes the menu", async () => {
    const user = userEvent.setup();
    const { props } = renderControls();

    await user.click(screen.getByRole("button", { name: "Block actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(props.onDelete).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu", { name: "Block actions menu" })).not.toBeInTheDocument();
  });

  it("searches both block types and block actions", async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByRole("button", { name: "Block actions" }));
    const search = await screen.findByRole("searchbox", { name: "Search block actions" });
    await user.type(search, "duplicate");

    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Copy Markdown" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Text" })).not.toBeInTheDocument();
    expect(screen.queryByText("No matching actions")).not.toBeInTheDocument();
  });

  it("opens from the keyboard and closes with Escape", async () => {
    const user = userEvent.setup();
    renderControls();
    const trigger = screen.getByRole("button", { name: "Block actions" });

    trigger.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("searchbox", { name: "Search block actions" })).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Block actions menu" })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("can remove inactive gutter controls from the tab order", () => {
    renderControls({ buttonTabIndex: -1, describedBy: "block-description" });

    expect(screen.getByRole("button", { name: "Insert block" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("button", { name: "Block actions" })).toHaveAttribute(
      "aria-describedby",
      "block-description"
    );
  });

  it("arrows onto the Turn into row instead of skipping it", async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByRole("button", { name: "Block actions" }));
    await screen.findByRole("searchbox", { name: "Search block actions" });

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Turn into" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Copy Markdown" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "Turn into" })).toHaveFocus();
  });

  it("walks the Turn into options, which are a second menu with a ring of their own", async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByRole("button", { name: "Block actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Turn into" }));

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Text" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "End" });
    expect(screen.getByRole("menuitem", { name: "Quote" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Home" });
    expect(screen.getByRole("menuitem", { name: "Text" })).toHaveFocus();
  });

  it("opens the options with ArrowRight and steps back out with ArrowLeft", async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByRole("button", { name: "Block actions" }));
    await screen.findByRole("searchbox", { name: "Search block actions" });

    fireEvent.keyDown(document, { key: "ArrowDown" });
    const turnInto = screen.getByRole("menuitem", { name: "Turn into" });
    expect(turnInto).toHaveFocus();

    fireEvent.keyDown(turnInto, { key: "ArrowRight" });
    expect(screen.getByRole("menu", { name: "Turn into" })).toBeInTheDocument();

    // One level per press. ArrowLeft leaves the options, not the menu, and hands the row back the
    // focus it was opened from — without that the ring is cleared and ArrowDown resumes at the top.
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(screen.queryByRole("menu", { name: "Turn into" })).not.toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "Block actions menu" })).toBeInTheDocument();
    expect(turnInto).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Copy Markdown" })).toHaveFocus();
  });

  it("keeps Escape working when a query unmounts the open Turn into row", async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByRole("button", { name: "Block actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Turn into" }));
    expect(screen.getByRole("menu", { name: "Turn into" })).toBeInTheDocument();

    // A query replaces the panel's whole navigation half, so the row the options hang off unmounts
    // while they are still open. Nothing else tells the panel that the level went away.
    fireEvent.change(screen.getByRole("searchbox", { name: "Search block actions" }), {
      target: { value: "heading" },
    });
    expect(screen.queryByRole("menu", { name: "Turn into" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Heading 3" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Block actions menu" })).not.toBeInTheDocument();
  });

  it("keeps Escape stepping out one level at a time", async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByRole("button", { name: "Block actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Turn into" }));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Turn into" })).not.toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "Block actions menu" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Block actions menu" })).not.toBeInTheDocument();
  });

  it("walks the filtered rows in visual order once a query hides the navigation rows", async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByRole("button", { name: "Block actions" }));
    await user.type(
      await screen.findByRole("searchbox", { name: "Search block actions" }),
      "heading"
    );
    expect(screen.queryByRole("menuitem", { name: "Turn into" })).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Heading 1" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "End" });
    expect(screen.getByRole("menuitem", { name: "Heading 6" })).toHaveFocus();
  });

  it("arrows straight from Duplicate to Move down when Move up is unavailable", async () => {
    const user = userEvent.setup();
    renderControls({ canMoveUp: false });

    await user.click(screen.getByRole("button", { name: "Block actions" }));
    await screen.findByRole("searchbox", { name: "Search block actions" });

    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Copy Markdown" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toHaveFocus();

    // The disabled Move up cannot hold DOM focus, so stopping on it spent a press for nothing.
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Move down" })).toHaveFocus();
  });

  it("tells the reader how to reach the menu without a pointer", async () => {
    const user = userEvent.setup();
    renderControls();

    await user.hover(screen.getByRole("button", { name: "Block actions" }));

    // The gutter menu has exactly one keyboard route from the text, and nothing named it.
    expect(await screen.findByText("⌘/ or Ctrl+/ to open")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Block actions" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Meta+/ Control+/"
    );
  });

  it("keeps Turn into unavailable for source-only Markdown blocks", async () => {
    const user = userEvent.setup();
    const { props } = renderControls({ currentKind: "table", canTurnInto: false });

    await user.click(screen.getByRole("button", { name: "Block actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Turn into" }));
    const text = within(screen.getByRole("menu", { name: "Turn into" })).getByRole("menuitem", {
      name: "Text",
    });

    expect(text).toBeDisabled();
    await user.click(text);
    expect(props.onTurnInto).not.toHaveBeenCalled();
  });

  it("holds the + and the grip in one 24px line box so they sit level", () => {
    // `DropdownMenu` wraps the grip's trigger in an `inline-block`, so the grip's flex item is a
    // line box rather than the button. At the row's inherited 28px line-height that item measured
    // 28px against the `+`'s 24px, and `items-center` then dropped the `+` exactly 2.00px below the
    // grip on all 48 rows of a fixture — measured in the packaged app. With no leading to add, the
    // line box is the 24px button and both items resolve alike.
    renderControls();

    const controls = screen.getByRole("group", { name: "Block controls" });
    expect(controls.className).toContain("items-center");
    expect(controls.className).toContain("leading-[0]");
    for (const name of ["Insert block", "Block actions"]) {
      expect(screen.getByRole("button", { name }).className).toContain("h-6 w-6");
    }
  });
});
