import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { BlockGutterControls } from "@/editor/markdown-block/block-gutter-controls";

function renderControls(overrides: Partial<ComponentProps<typeof BlockGutterControls>> = {}) {
  const props: ComponentProps<typeof BlockGutterControls> = {
    currentKind: "paragraph",
    onAdd: vi.fn(),
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
    const add = screen.getByRole("button", { name: "Add block" });
    const actions = screen.getByRole("button", { name: "Block actions" });

    expect(controls).toContainElement(add);
    expect(controls).toContainElement(actions);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    await user.click(add);
    expect(props.onAdd).toHaveBeenCalledOnce();
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

  it("keeps the default action menu compact until Turn into is requested", async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByRole("button", { name: "Block actions" }));
    expect(screen.getByRole("menuitem", { name: "Turn into" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Heading 3" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Turn into" }));
    expect(screen.getByRole("menuitem", { name: "Back to block actions" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Heading 3" })).toBeVisible();
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

    expect(screen.getByRole("button", { name: "Add block" })).toHaveAttribute("tabindex", "-1");
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

  it("arrows onto the back row at the top of the Turn into list", async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByRole("button", { name: "Block actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Turn into" }));

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Back to block actions" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Text" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Home" });
    expect(screen.getByRole("menuitem", { name: "Back to block actions" })).toHaveFocus();
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
    const text = screen.getByRole("menuitem", { name: "Text" });

    expect(text).toBeDisabled();
    await user.click(text);
    expect(props.onTurnInto).not.toHaveBeenCalled();
  });
});
