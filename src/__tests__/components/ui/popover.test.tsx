import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function ControlledPopover({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange(nextOpen);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button>Toggle</button>
      </PopoverTrigger>
      <PopoverContent>Controlled content</PopoverContent>
    </Popover>
  );
}

describe("Popover", () => {
  it("toggles uncontrolled content from the trigger", async () => {
    const user = userEvent.setup();

    render(
      <Popover>
        <PopoverTrigger asChild>
          <button>Open</button>
        </PopoverTrigger>
        <PopoverContent>Popover content</PopoverContent>
      </Popover>
    );

    const trigger = screen.getByRole("button", { name: "Open" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Popover content")).toBeInTheDocument();

    await user.click(trigger);
    await waitFor(() => expect(screen.queryByText("Popover content")).not.toBeInTheDocument());
  });

  it("reports controlled state changes", async () => {
    const user = userEvent.setup();
    const handleOpenChange = vi.fn();

    render(<ControlledPopover onOpenChange={handleOpenChange} />);

    await user.click(screen.getByRole("button", { name: "Toggle" }));
    await user.click(screen.getByRole("button", { name: "Toggle" }));

    expect(handleOpenChange).toHaveBeenNthCalledWith(1, true);
    expect(handleOpenChange).toHaveBeenNthCalledWith(2, false);
  });

  it("closes on Escape and outside mouse down", async () => {
    const user = userEvent.setup();

    render(
      <>
        <button>Outside</button>
        <Popover>
          <PopoverTrigger asChild>
            <button>Open menu</button>
          </PopoverTrigger>
          <PopoverContent>Menu content</PopoverContent>
        </Popover>
      </>
    );

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByText("Menu content")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Menu content")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByText("Menu content")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("button", { name: "Outside" }));

    await waitFor(() => expect(screen.queryByText("Menu content")).not.toBeInTheDocument());
  });

  it("applies requested alignment and side placement", async () => {
    const user = userEvent.setup();

    render(
      <Popover>
        <PopoverTrigger asChild>
          <button>Open</button>
        </PopoverTrigger>
        <PopoverContent align="end" side="top" data-testid="content">
          Positioned content
        </PopoverContent>
      </Popover>
    );

    await user.click(screen.getByRole("button", { name: "Open" }));

    const content = screen.getByTestId("content");
    expect(content).toHaveClass("right-0");
    expect(content).toHaveStyle({ bottom: "100%" });
  });
});
