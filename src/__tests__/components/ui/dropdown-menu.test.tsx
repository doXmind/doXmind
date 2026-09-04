import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

/**
 * The block gutter menu mounts its "Turn into" group only once the user types a query, and renders
 * it *above* the action rows that were already on screen. Registration order therefore stops
 * matching reading order, which is what arrow keys must follow.
 */
function FilterableMenu() {
  const [filtered, setFiltered] = useState(false);

  return (
    <>
      <button onClick={() => setFiltered(true)}>Filter</button>
      <DropdownMenu open anchorPoint={{ x: 0, y: 0 }}>
        <DropdownMenuContent>
          {filtered && <DropdownMenuItem>Text</DropdownMenuItem>}
          {filtered && <DropdownMenuItem>Heading 1</DropdownMenuItem>}
          <DropdownMenuItem>Copy Markdown</DropdownMenuItem>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

describe("DropdownMenuContent keyboard navigation", () => {
  it("follows DOM order after rows mount above the already-registered ones", async () => {
    const user = userEvent.setup();
    render(<FilterableMenu />);

    await user.click(screen.getByRole("button", { name: "Filter" }));

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toHaveTextContent("Text");

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toHaveTextContent("Heading 1");
  });

  it("walks backwards to the visually last row", async () => {
    const user = userEvent.setup();
    render(<FilterableMenu />);

    await user.click(screen.getByRole("button", { name: "Filter" }));

    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(document.activeElement).toHaveTextContent("Delete");
  });

  it("sends Home and End to the first and last visible rows", async () => {
    const user = userEvent.setup();
    render(<FilterableMenu />);

    await user.click(screen.getByRole("button", { name: "Filter" }));

    fireEvent.keyDown(document, { key: "End" });
    expect(document.activeElement).toHaveTextContent("Delete");

    fireEvent.keyDown(document, { key: "Home" });
    expect(document.activeElement).toHaveTextContent("Text");
  });

  it("walks past a disabled row instead of spending a keypress on it", () => {
    render(
      <DropdownMenu open anchorPoint={{ x: 0, y: 0 }}>
        <DropdownMenuContent>
          <DropdownMenuItem>Duplicate</DropdownMenuItem>
          <DropdownMenuItem disabled>Move up</DropdownMenuItem>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toHaveTextContent("Duplicate");

    // A disabled button cannot take DOM focus, so landing the roving ring on one dropped focus out
    // of the menu entirely and the press did nothing the user could see.
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toHaveTextContent("Delete");

    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(document.activeElement).toHaveTextContent("Duplicate");
  });

  it("skips a disabled row at the end of the walk", () => {
    render(
      <DropdownMenu open anchorPoint={{ x: 0, y: 0 }}>
        <DropdownMenuContent>
          <DropdownMenuItem>Duplicate</DropdownMenuItem>
          <DropdownMenuItem disabled>Move down</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    fireEvent.keyDown(document, { key: "End" });
    expect(document.activeElement).toHaveTextContent("Duplicate");
  });

  it("still closes on Escape when every row is disabled", () => {
    function AllDisabled() {
      const [open, setOpen] = useState(true);
      return (
        <DropdownMenu open={open} onOpenChange={setOpen} anchorPoint={{ x: 0, y: 0 }}>
          <DropdownMenuContent>
            <DropdownMenuItem disabled>Move up</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    render(<AllDisabled />);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("still cycles a menu whose rows all mounted together", () => {
    render(
      <DropdownMenu open anchorPoint={{ x: 0, y: 0 }}>
        <DropdownMenuContent>
          <DropdownMenuItem>One</DropdownMenuItem>
          <DropdownMenuItem>Two</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toHaveTextContent("One");

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toHaveTextContent("Two");

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toHaveTextContent("One");
  });
});
