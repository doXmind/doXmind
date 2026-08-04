import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function Menu({ children }: { children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <input aria-label="Elsewhere" />
      {children}
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger>Block actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Copy Markdown</DropdownMenuItem>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/**
 * Measured on the packaged app: Escape closed the menu and left `document.activeElement` at BODY
 * for good — 20/20 sampled frames, 5/5 headed trials, with typing dead until the user pressed
 * Shift+Tab or clicked something. The focused row just unmounted and nothing handed focus back.
 */
describe("DropdownMenu focus restore", () => {
  it("hands focus back to the trigger when Escape closes the menu", async () => {
    const user = userEvent.setup();
    render(<Menu />);
    const trigger = screen.getByRole("button", { name: "Block actions" });

    await user.click(trigger);
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Copy Markdown" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("hands focus back after a row is picked", async () => {
    const user = userEvent.setup();
    render(<Menu />);
    const trigger = screen.getByRole("button", { name: "Block actions" });

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(trigger).toHaveFocus();
  });

  it("leaves focus alone when the click that closed the menu landed in another control", async () => {
    const user = userEvent.setup();
    render(<Menu />);

    await user.click(screen.getByRole("button", { name: "Block actions" }));
    await user.click(screen.getByRole("textbox", { name: "Elsewhere" }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Elsewhere" })).toHaveFocus();
  });
});

/**
 * The 100ms gate that keeps a menu from highlighting whatever the pointer is over while it animates
 * in is deliberate. What was not: `mouseenter` is edge-triggered, so a row the pointer reached
 * *before* the gate lifted never got a second chance and stayed dead for the life of the menu —
 * 0/4 recoveries after a 1px jiggle, 0/3 after a 30px move inside the same row, while crossing into
 * a different row recovered 4/4.
 */
describe("DropdownMenuItem hover", () => {
  const gate = () => act(() => new Promise((resolve) => setTimeout(resolve, 150)));

  it("answers a pointer that reached the row before the hover gate lifted", async () => {
    render(
      <DropdownMenu open anchorPoint={{ x: 0, y: 0 }}>
        <DropdownMenuContent>
          <DropdownMenuItem>Copy Markdown</DropdownMenuItem>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const row = screen.getByRole("menuitem", { name: "Copy Markdown" });
    // The pointer arrives inside the gate and then stops. This is the only event the row ever
    // gets: `mouseenter` does not fire again under a pointer that is not moving.
    fireEvent.mouseEnter(row);
    await gate();

    expect(row.className).toContain("bg-accent");
  });

  it("answers a move inside a row that produced no fresh mouseenter", async () => {
    render(
      <DropdownMenu open anchorPoint={{ x: 0, y: 0 }}>
        <DropdownMenuContent>
          <DropdownMenuItem>Copy Markdown</DropdownMenuItem>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const row = screen.getByRole("menuitem", { name: "Copy Markdown" });
    await gate();

    // The 1px jiggle that used to recover nothing.
    fireEvent.pointerMove(row);
    expect(row.className).toContain("bg-accent");
  });

  it("still moves the highlight when the pointer crosses to another row", async () => {
    render(
      <DropdownMenu open anchorPoint={{ x: 0, y: 0 }}>
        <DropdownMenuContent>
          <DropdownMenuItem>Copy Markdown</DropdownMenuItem>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const copy = screen.getByRole("menuitem", { name: "Copy Markdown" });
    const remove = screen.getByRole("menuitem", { name: "Delete" });
    await gate();

    fireEvent.pointerMove(copy);
    expect(copy.className).toContain("bg-accent");

    fireEvent.mouseLeave(copy);
    fireEvent.pointerMove(remove);
    expect(copy.className).not.toContain("bg-accent");
    expect(remove.className).toContain("bg-accent");
  });
});

/**
 * A sub-panel closed from the keyboard has to stay closed.
 *
 * The 150ms hover-open is armed by the `mouseenter` that precedes a click, and the pointer that
 * arms it is the same pointer that then presses the row — so a press followed within 150ms by
 * Escape left a timer in flight with nothing to cancel it. Measured on the block gutter's "Turn
 * into": closed at +0ms and +60ms after Escape, open again at +260ms, with the user's next press
 * landing in a panel they had already dismissed.
 */
describe("DropdownMenuSub close", () => {
  function SubMenu() {
    return (
      <DropdownMenu open anchorPoint={{ x: 0, y: 0 }}>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Turn into</DropdownMenuSubTrigger>
            <DropdownMenuSubContent aria-label="Turn into">
              <DropdownMenuItem>Text</DropdownMenuItem>
              <DropdownMenuItem>Heading 1</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem>Copy Markdown</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  it("does not let the hover timer the press armed reopen it after Escape", async () => {
    render(<SubMenu />);
    const trigger = screen.getByRole("menuitem", { name: "Turn into" });

    // The gesture as a pointer delivers it: enter the row, then press it well inside the 150ms.
    fireEvent.mouseEnter(trigger.parentElement!);
    fireEvent.click(trigger);
    expect(screen.getByRole("menu", { name: "Turn into" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Turn into" })).not.toBeInTheDocument();

    await act(() => new Promise((resolve) => setTimeout(resolve, 250)));
    expect(screen.queryByRole("menu", { name: "Turn into" })).not.toBeInTheDocument();
    // And the panel it belongs to is still open — Escape steps out one level, not two.
    expect(screen.getAllByRole("menu")).toHaveLength(1);
  });

  it("hands the roving ring back to the trigger row so the walk resumes below it", () => {
    render(<SubMenu />);
    const trigger = screen.getByRole("menuitem", { name: "Turn into" });

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(trigger).toHaveFocus();

    fireEvent.keyDown(trigger, { key: "ArrowRight" });
    expect(screen.getByRole("menu", { name: "Turn into" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Text" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(trigger).toHaveFocus();
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Copy Markdown" })).toHaveFocus();
  });
});
