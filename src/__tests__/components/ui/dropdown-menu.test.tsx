import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  useDropdownMenuItemFocus,
} from "@/components/ui/dropdown-menu";

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

  it("walks rows that a menu renders for itself rather than as DropdownMenuItems", () => {
    function OwnRow({ id, children }: { id: string; children: string }) {
      return (
        <button type="button" role="menuitem" {...useDropdownMenuItemFocus(id)}>
          {children}
        </button>
      );
    }

    render(
      <DropdownMenu open anchorPoint={{ x: 0, y: 0 }}>
        <DropdownMenuContent>
          <OwnRow id="turn-into">Turn into</OwnRow>
          <DropdownMenuItem>Copy Markdown</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toHaveTextContent("Turn into");
    expect(document.activeElement).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toHaveTextContent("Copy Markdown");
    expect(screen.getByRole("menuitem", { name: "Turn into" })).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(document.activeElement).toHaveTextContent("Turn into");
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
