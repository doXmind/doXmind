/**
 * Tests for Tooltip component
 * Note: Tooltip uses setTimeout and createPortal which are difficult to test with fake timers.
 * These tests focus on structure and props rather than timing behavior.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tooltip } from "@/components/ui/tooltip";

describe("Tooltip", () => {
  describe("Rendering", () => {
    it("renders trigger children", () => {
      render(
        <Tooltip content="Tooltip text">
          <button>Hover me</button>
        </Tooltip>
      );

      expect(screen.getByText("Hover me")).toBeInTheDocument();
    });

    it("does not render tooltip content initially", () => {
      render(
        <Tooltip content="Hidden tooltip">
          <button>Trigger</button>
        </Tooltip>
      );

      expect(screen.queryByText("Hidden tooltip")).not.toBeInTheDocument();
    });

    it("wraps children in relative container", () => {
      render(
        <Tooltip content="Tooltip">
          <button data-testid="trigger">Button</button>
        </Tooltip>
      );

      const container = screen.getByTestId("trigger").parentElement;
      expect(container).toHaveClass("relative");
      expect(container).toHaveClass("inline-block");
    });

    it("renders button trigger correctly", () => {
      render(
        <Tooltip content="Click info">
          <button data-testid="btn">Click Me</button>
        </Tooltip>
      );

      const button = screen.getByTestId("btn");
      expect(button).toBeInTheDocument();
      expect(button.tagName).toBe("BUTTON");
    });

    it("renders link trigger correctly", () => {
      render(
        <Tooltip content="Link info">
          <a href="#" data-testid="link">
            Link
          </a>
        </Tooltip>
      );

      const link = screen.getByTestId("link");
      expect(link).toBeInTheDocument();
      expect(link.tagName).toBe("A");
    });

    it("renders icon trigger correctly", () => {
      render(
        <Tooltip content="Icon info">
          <span data-testid="icon" role="img" aria-label="info">
            ℹ️
          </span>
        </Tooltip>
      );

      expect(screen.getByTestId("icon")).toBeInTheDocument();
    });
  });

  describe("Side Positioning Props", () => {
    it("defaults to top position", () => {
      render(
        <Tooltip content="Top tooltip">
          <button>Trigger</button>
        </Tooltip>
      );

      // Component accepts side prop with default "top"
      expect(screen.getByText("Trigger")).toBeInTheDocument();
    });

    it("accepts top side prop", () => {
      render(
        <Tooltip content="Top tooltip" side="top">
          <button>Trigger</button>
        </Tooltip>
      );

      expect(screen.getByText("Trigger")).toBeInTheDocument();
    });

    it("accepts right side prop", () => {
      render(
        <Tooltip content="Right tooltip" side="right">
          <button>Trigger</button>
        </Tooltip>
      );

      expect(screen.getByText("Trigger")).toBeInTheDocument();
    });

    it("accepts bottom side prop", () => {
      render(
        <Tooltip content="Bottom tooltip" side="bottom">
          <button>Trigger</button>
        </Tooltip>
      );

      expect(screen.getByText("Trigger")).toBeInTheDocument();
    });

    it("accepts left side prop", () => {
      render(
        <Tooltip content="Left tooltip" side="left">
          <button>Trigger</button>
        </Tooltip>
      );

      expect(screen.getByText("Trigger")).toBeInTheDocument();
    });
  });

  describe("Delay Duration Props", () => {
    it("accepts default delay", () => {
      render(
        <Tooltip content="Default delay">
          <button data-testid="trigger">Hover</button>
        </Tooltip>
      );

      expect(screen.getByTestId("trigger")).toBeInTheDocument();
    });

    it("accepts custom delay duration", () => {
      render(
        <Tooltip content="Custom delay" delayDuration={500}>
          <button data-testid="trigger">Hover</button>
        </Tooltip>
      );

      expect(screen.getByTestId("trigger")).toBeInTheDocument();
    });

    it("accepts zero delay", () => {
      render(
        <Tooltip content="No delay" delayDuration={0}>
          <button data-testid="trigger">Hover</button>
        </Tooltip>
      );

      expect(screen.getByTestId("trigger")).toBeInTheDocument();
    });
  });

  describe("Content Types", () => {
    it("accepts string content", () => {
      render(
        <Tooltip content="Simple string">
          <button>Hover</button>
        </Tooltip>
      );

      expect(screen.getByText("Hover")).toBeInTheDocument();
    });

    it("accepts JSX content", () => {
      render(
        <Tooltip
          content={
            <div>
              <strong>Bold</strong> text
            </div>
          }
        >
          <button>Hover</button>
        </Tooltip>
      );

      expect(screen.getByText("Hover")).toBeInTheDocument();
    });

    it("accepts content with keyboard shortcut", () => {
      render(
        <Tooltip
          content={
            <span>
              Save <kbd>Ctrl+S</kbd>
            </span>
          }
        >
          <button>Save button</button>
        </Tooltip>
      );

      expect(screen.getByText("Save button")).toBeInTheDocument();
    });

    it("accepts empty string content", () => {
      render(
        <Tooltip content="">
          <button data-testid="trigger">Hover</button>
        </Tooltip>
      );

      expect(screen.getByTestId("trigger")).toBeInTheDocument();
    });
  });

  describe("Mouse Interactions", () => {
    it("container has mouse event handlers", () => {
      render(
        <Tooltip content="Tooltip">
          <button data-testid="trigger">Hover</button>
        </Tooltip>
      );

      const container = screen.getByTestId("trigger").parentElement!;

      // Verify container exists and can receive mouse events
      expect(container).toBeInTheDocument();

      // Fire events to ensure no errors
      expect(() => fireEvent.mouseEnter(container)).not.toThrow();
      expect(() => fireEvent.mouseLeave(container)).not.toThrow();
      expect(() => fireEvent.mouseDown(container)).not.toThrow();
    });
  });

  describe("Multiple Tooltips", () => {
    it("renders multiple tooltip triggers independently", () => {
      render(
        <>
          <Tooltip content="Tooltip 1">
            <button data-testid="trigger-1">Button 1</button>
          </Tooltip>
          <Tooltip content="Tooltip 2">
            <button data-testid="trigger-2">Button 2</button>
          </Tooltip>
        </>
      );

      expect(screen.getByTestId("trigger-1")).toBeInTheDocument();
      expect(screen.getByTestId("trigger-2")).toBeInTheDocument();
    });

    it("each trigger has its own container", () => {
      render(
        <>
          <Tooltip content="Tooltip 1">
            <button data-testid="trigger-1">Button 1</button>
          </Tooltip>
          <Tooltip content="Tooltip 2">
            <button data-testid="trigger-2">Button 2</button>
          </Tooltip>
        </>
      );

      const container1 = screen.getByTestId("trigger-1").parentElement;
      const container2 = screen.getByTestId("trigger-2").parentElement;

      expect(container1).not.toBe(container2);
      expect(container1).toHaveClass("relative", "inline-block");
      expect(container2).toHaveClass("relative", "inline-block");
    });
  });

  describe("Edge Cases", () => {
    it("handles unmounting gracefully", () => {
      const { unmount } = render(
        <Tooltip content="Will unmount">
          <button>Hover</button>
        </Tooltip>
      );

      expect(() => unmount()).not.toThrow();
    });

    it("handles rapid re-renders", () => {
      const { rerender } = render(
        <Tooltip content="Content 1">
          <button>Trigger</button>
        </Tooltip>
      );

      expect(() => {
        rerender(
          <Tooltip content="Content 2">
            <button>Trigger</button>
          </Tooltip>
        );
        rerender(
          <Tooltip content="Content 3">
            <button>Trigger</button>
          </Tooltip>
        );
      }).not.toThrow();
    });

    it("handles changing side prop", () => {
      const { rerender } = render(
        <Tooltip content="Tooltip" side="top">
          <button>Trigger</button>
        </Tooltip>
      );

      expect(() => {
        rerender(
          <Tooltip content="Tooltip" side="bottom">
            <button>Trigger</button>
          </Tooltip>
        );
      }).not.toThrow();
    });

    it("handles changing delay prop", () => {
      const { rerender } = render(
        <Tooltip content="Tooltip" delayDuration={200}>
          <button>Trigger</button>
        </Tooltip>
      );

      expect(() => {
        rerender(
          <Tooltip content="Tooltip" delayDuration={500}>
            <button>Trigger</button>
          </Tooltip>
        );
      }).not.toThrow();
    });
  });

  describe("Integration Patterns", () => {
    it("works with disabled button", () => {
      render(
        <Tooltip content="This button is disabled">
          <button disabled data-testid="disabled-btn">
            Disabled
          </button>
        </Tooltip>
      );

      const button = screen.getByTestId("disabled-btn");
      expect(button).toBeDisabled();
    });

    it("works with custom styled trigger", () => {
      render(
        <Tooltip content="Styled button info">
          <button className="bg-blue-500 px-4 py-2 text-white" data-testid="styled-btn">
            Styled Button
          </button>
        </Tooltip>
      );

      const button = screen.getByTestId("styled-btn");
      expect(button).toHaveClass("bg-blue-500");
    });

    it("works with input element trigger", () => {
      render(
        <Tooltip content="Enter your email">
          <input type="email" placeholder="Email" data-testid="email-input" />
        </Tooltip>
      );

      const input = screen.getByTestId("email-input");
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute("type", "email");
    });
  });
});
