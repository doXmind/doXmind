/**
 * Tests for Popover components
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useState } from "react";

// Test wrapper for controlled popover
function ControlledPopover({
  onOpenChange,
  defaultOpen = false,
}: {
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    onOpenChange?.(newOpen);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button data-testid="trigger">Open Popover</button>
      </PopoverTrigger>
      <PopoverContent data-testid="content">
        <div>Popover Content</div>
        <button data-testid="action">Action</button>
      </PopoverContent>
    </Popover>
  );
}

describe("Popover", () => {
  afterEach(() => {
    // Clean up any event listeners
    document.body.innerHTML = "";
  });

  describe("Rendering", () => {
    it("renders trigger", () => {
      render(
        <Popover>
          <PopoverTrigger asChild>
            <button>Trigger</button>
          </PopoverTrigger>
          <PopoverContent>Content</PopoverContent>
        </Popover>
      );

      expect(screen.getByText("Trigger")).toBeInTheDocument();
    });

    it("does not render content initially", () => {
      render(
        <Popover>
          <PopoverTrigger asChild>
            <button>Trigger</button>
          </PopoverTrigger>
          <PopoverContent>Hidden Content</PopoverContent>
        </Popover>
      );

      expect(screen.queryByText("Hidden Content")).not.toBeInTheDocument();
    });

    it("wraps children in relative container", () => {
      render(
        <Popover>
          <PopoverTrigger asChild>
            <button data-testid="trigger">Trigger</button>
          </PopoverTrigger>
          <PopoverContent>Content</PopoverContent>
        </Popover>
      );

      const container = screen.getByTestId("trigger").closest(".relative");
      expect(container).toBeInTheDocument();
    });
  });

  describe("Uncontrolled Mode", () => {
    it("opens on trigger click", async () => {
      const user = userEvent.setup();

      render(
        <Popover>
          <PopoverTrigger asChild>
            <button>Open</button>
          </PopoverTrigger>
          <PopoverContent>Popover Content</PopoverContent>
        </Popover>
      );

      await user.click(screen.getByText("Open"));

      await waitFor(() => {
        expect(screen.getByText("Popover Content")).toBeInTheDocument();
      });
    });

    it("closes on trigger click when open", async () => {
      const user = userEvent.setup();

      render(
        <Popover>
          <PopoverTrigger asChild>
            <button>Toggle</button>
          </PopoverTrigger>
          <PopoverContent>Content</PopoverContent>
        </Popover>
      );

      // Open
      await user.click(screen.getByText("Toggle"));
      expect(screen.getByText("Content")).toBeInTheDocument();

      // Close
      await user.click(screen.getByText("Toggle"));

      await waitFor(() => {
        expect(screen.queryByText("Content")).not.toBeInTheDocument();
      });
    });
  });

  describe("Controlled Mode", () => {
    it("respects controlled open state", () => {
      render(
        <Popover open={true}>
          <PopoverTrigger asChild>
            <button>Trigger</button>
          </PopoverTrigger>
          <PopoverContent>Controlled Content</PopoverContent>
        </Popover>
      );

      expect(screen.getByText("Controlled Content")).toBeInTheDocument();
    });

    it("respects controlled closed state", () => {
      render(
        <Popover open={false}>
          <PopoverTrigger asChild>
            <button>Trigger</button>
          </PopoverTrigger>
          <PopoverContent>Hidden Content</PopoverContent>
        </Popover>
      );

      expect(screen.queryByText("Hidden Content")).not.toBeInTheDocument();
    });

    it("calls onOpenChange when toggling", async () => {
      const user = userEvent.setup();
      const handleOpenChange = vi.fn();

      render(<ControlledPopover onOpenChange={handleOpenChange} />);

      await user.click(screen.getByTestId("trigger"));

      expect(handleOpenChange).toHaveBeenCalledWith(true);
    });

    it("calls onOpenChange with false when closing", async () => {
      const user = userEvent.setup();
      const handleOpenChange = vi.fn();

      render(<ControlledPopover onOpenChange={handleOpenChange} defaultOpen={true} />);

      await user.click(screen.getByTestId("trigger"));

      expect(handleOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe("PopoverTrigger", () => {
    it("sets aria-expanded attribute when using asChild", async () => {
      const user = userEvent.setup();

      render(
        <Popover>
          <PopoverTrigger asChild>
            <button data-testid="trigger">Trigger</button>
          </PopoverTrigger>
          <PopoverContent>Content</PopoverContent>
        </Popover>
      );

      const trigger = screen.getByTestId("trigger");
      expect(trigger).toHaveAttribute("aria-expanded", "false");

      await user.click(trigger);

      expect(trigger).toHaveAttribute("aria-expanded", "true");
    });

    it("sets aria-haspopup attribute when using asChild", () => {
      render(
        <Popover>
          <PopoverTrigger asChild>
            <button data-testid="trigger">Trigger</button>
          </PopoverTrigger>
          <PopoverContent>Content</PopoverContent>
        </Popover>
      );

      expect(screen.getByTestId("trigger")).toHaveAttribute("aria-haspopup", "true");
    });

    it("renders button when not using asChild", () => {
      render(
        <Popover>
          <PopoverTrigger>Click me</PopoverTrigger>
          <PopoverContent>Content</PopoverContent>
        </Popover>
      );

      const button = screen.getByRole("button");
      expect(button).toBeInTheDocument();
    });

    it("clones child element when using asChild", async () => {
      const user = userEvent.setup();

      render(
        <Popover>
          <PopoverTrigger asChild>
            <button data-testid="custom-trigger">Custom Trigger</button>
          </PopoverTrigger>
          <PopoverContent>Content</PopoverContent>
        </Popover>
      );

      const trigger = screen.getByTestId("custom-trigger");
      expect(trigger).toBeInTheDocument();

      await user.click(trigger);

      expect(screen.getByText("Content")).toBeInTheDocument();
    });
  });

  describe("PopoverContent", () => {
    it("renders content when popover is open", async () => {
      const user = userEvent.setup();

      render(
        <Popover>
          <PopoverTrigger asChild>
            <button>Open</button>
          </PopoverTrigger>
          <PopoverContent>
            <div data-testid="inner">Inner Content</div>
          </PopoverContent>
        </Popover>
      );

      await user.click(screen.getByText("Open"));

      expect(screen.getByTestId("inner")).toBeInTheDocument();
    });

    it("has correct base classes", async () => {
      const user = userEvent.setup();

      render(
        <Popover>
          <PopoverTrigger asChild>
            <button>Open</button>
          </PopoverTrigger>
          <PopoverContent data-testid="content">Content</PopoverContent>
        </Popover>
      );

      await user.click(screen.getByText("Open"));

      const content = screen.getByTestId("content");
      expect(content).toHaveClass("absolute");
      expect(content).toHaveClass("z-50");
      expect(content).toHaveClass("rounded-md");
      expect(content).toHaveClass("border");
      expect(content).toHaveClass("bg-popover");
      expect(content).toHaveClass("shadow-md");
    });

    it("applies custom className", async () => {
      const user = userEvent.setup();

      render(
        <Popover>
          <PopoverTrigger asChild>
            <button>Open</button>
          </PopoverTrigger>
          <PopoverContent className="custom-class" data-testid="content">
            Content
          </PopoverContent>
        </Popover>
      );

      await user.click(screen.getByText("Open"));

      expect(screen.getByTestId("content")).toHaveClass("custom-class");
    });
  });

  describe("Alignment", () => {
    it("aligns to start", async () => {
      const user = userEvent.setup();

      render(
        <Popover>
          <PopoverTrigger asChild>
            <button>Open</button>
          </PopoverTrigger>
          <PopoverContent align="start" data-testid="content">
            Content
          </PopoverContent>
        </Popover>
      );

      await user.click(screen.getByText("Open"));

      expect(screen.getByTestId("content")).toHaveClass("left-0");
    });

    it("aligns to center (default)", async () => {
      const user = userEvent.setup();

      render(
        <Popover>
          <PopoverTrigger asChild>
            <button>Open</button>
          </PopoverTrigger>
          <PopoverContent data-testid="content">Content</PopoverContent>
        </Popover>
      );

      await user.click(screen.getByText("Open"));

      expect(screen.getByTestId("content")).toHaveClass("left-1/2");
      expect(screen.getByTestId("content")).toHaveClass("-translate-x-1/2");
    });

    it("aligns to end", async () => {
      const user = userEvent.setup();

      render(
        <Popover>
          <PopoverTrigger asChild>
            <button>Open</button>
          </PopoverTrigger>
          <PopoverContent align="end" data-testid="content">
            Content
          </PopoverContent>
        </Popover>
      );

      await user.click(screen.getByText("Open"));

      expect(screen.getByTestId("content")).toHaveClass("right-0");
    });
  });

  describe("Side Positioning", () => {
    it("positions at bottom by default", async () => {
      const user = userEvent.setup();

      render(
        <Popover>
          <PopoverTrigger asChild>
            <button>Open</button>
          </PopoverTrigger>
          <PopoverContent data-testid="content">Content</PopoverContent>
        </Popover>
      );

      await user.click(screen.getByText("Open"));

      const content = screen.getByTestId("content");
      expect(content).toHaveStyle({ top: "100%" });
    });

    it("positions at top when side is top", async () => {
      const user = userEvent.setup();

      render(
        <Popover>
          <PopoverTrigger asChild>
            <button>Open</button>
          </PopoverTrigger>
          <PopoverContent side="top" data-testid="content">
            Content
          </PopoverContent>
        </Popover>
      );

      await user.click(screen.getByText("Open"));

      const content = screen.getByTestId("content");
      expect(content).toHaveStyle({ bottom: "100%" });
    });
  });

  describe("Keyboard Interactions", () => {
    it("closes on Escape key", async () => {
      const user = userEvent.setup();

      render(
        <Popover>
          <PopoverTrigger asChild>
            <button>Open</button>
          </PopoverTrigger>
          <PopoverContent>Content</PopoverContent>
        </Popover>
      );

      await user.click(screen.getByText("Open"));
      expect(screen.getByText("Content")).toBeInTheDocument();

      fireEvent.keyDown(document, { key: "Escape" });

      await waitFor(() => {
        expect(screen.queryByText("Content")).not.toBeInTheDocument();
      });
    });
  });

  describe("Click Outside", () => {
    it("closes when clicking outside", async () => {
      const user = userEvent.setup();

      render(
        <>
          <button data-testid="outside">Outside</button>
          <Popover>
            <PopoverTrigger asChild>
              <button>Open</button>
            </PopoverTrigger>
            <PopoverContent>Content</PopoverContent>
          </Popover>
        </>
      );

      await user.click(screen.getByText("Open"));
      expect(screen.getByText("Content")).toBeInTheDocument();

      // Click outside - need to simulate mousedown
      fireEvent.mouseDown(screen.getByTestId("outside"));

      await waitFor(() => {
        expect(screen.queryByText("Content")).not.toBeInTheDocument();
      });
    });

    it("does not close when clicking inside content", async () => {
      const user = userEvent.setup();

      render(
        <Popover>
          <PopoverTrigger asChild>
            <button>Open</button>
          </PopoverTrigger>
          <PopoverContent data-testid="content">
            <button data-testid="inner-button">Inner Button</button>
          </PopoverContent>
        </Popover>
      );

      await user.click(screen.getByText("Open"));

      // Click inside
      await user.click(screen.getByTestId("inner-button"));

      // Should still be open
      expect(screen.getByText("Inner Button")).toBeInTheDocument();
    });
  });

  describe("Use Cases", () => {
    it("renders dropdown menu style popover", async () => {
      const user = userEvent.setup();

      render(
        <Popover>
          <PopoverTrigger asChild>
            <button>Options</button>
          </PopoverTrigger>
          <PopoverContent align="start">
            <div>
              <button>Edit</button>
              <button>Delete</button>
              <button>Share</button>
            </div>
          </PopoverContent>
        </Popover>
      );

      await user.click(screen.getByText("Options"));

      expect(screen.getByText("Edit")).toBeInTheDocument();
      expect(screen.getByText("Delete")).toBeInTheDocument();
      expect(screen.getByText("Share")).toBeInTheDocument();
    });

    it("renders color picker style popover", async () => {
      const user = userEvent.setup();

      render(
        <Popover>
          <PopoverTrigger asChild>
            <button>Pick Color</button>
          </PopoverTrigger>
          <PopoverContent>
            <div data-testid="color-picker">
              <div>Red</div>
              <div>Green</div>
              <div>Blue</div>
            </div>
          </PopoverContent>
        </Popover>
      );

      await user.click(screen.getByText("Pick Color"));

      expect(screen.getByTestId("color-picker")).toBeInTheDocument();
    });

    it("renders date picker style popover", async () => {
      const user = userEvent.setup();

      render(
        <Popover>
          <PopoverTrigger asChild>
            <button>Select Date</button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0">
            <div data-testid="calendar">Calendar Component</div>
          </PopoverContent>
        </Popover>
      );

      await user.click(screen.getByText("Select Date"));

      expect(screen.getByTestId("calendar")).toBeInTheDocument();
    });
  });
});
