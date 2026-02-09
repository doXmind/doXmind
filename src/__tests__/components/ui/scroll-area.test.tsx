/**
 * Tests for ScrollArea component
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { createRef } from "react";

describe("ScrollArea", () => {
  describe("Rendering", () => {
    it("renders correctly", () => {
      render(<ScrollArea data-testid="scroll-area">Content</ScrollArea>);
      expect(screen.getByTestId("scroll-area")).toBeInTheDocument();
    });

    it("renders children correctly", () => {
      render(
        <ScrollArea>
          <div>Child 1</div>
          <div>Child 2</div>
          <div>Child 3</div>
        </ScrollArea>
      );
      expect(screen.getByText("Child 1")).toBeInTheDocument();
      expect(screen.getByText("Child 2")).toBeInTheDocument();
      expect(screen.getByText("Child 3")).toBeInTheDocument();
    });

    it("renders as div element", () => {
      render(<ScrollArea data-testid="scroll-area">Content</ScrollArea>);
      const scrollArea = screen.getByTestId("scroll-area");
      expect(scrollArea.tagName).toBe("DIV");
    });

    it("has correct display name", () => {
      expect(ScrollArea.displayName).toBe("ScrollArea");
    });
  });

  describe("Orientation", () => {
    it("defaults to vertical orientation", () => {
      render(<ScrollArea data-testid="scroll-area">Content</ScrollArea>);
      const scrollArea = screen.getByTestId("scroll-area");
      expect(scrollArea).toHaveClass("overflow-y-auto");
      expect(scrollArea).toHaveClass("overflow-x-hidden");
    });

    it("renders with vertical orientation explicitly", () => {
      render(
        <ScrollArea orientation="vertical" data-testid="scroll-area">
          Content
        </ScrollArea>
      );
      const scrollArea = screen.getByTestId("scroll-area");
      expect(scrollArea).toHaveClass("overflow-y-auto");
      expect(scrollArea).toHaveClass("overflow-x-hidden");
    });

    it("renders with horizontal orientation", () => {
      render(
        <ScrollArea orientation="horizontal" data-testid="scroll-area">
          Content
        </ScrollArea>
      );
      const scrollArea = screen.getByTestId("scroll-area");
      expect(scrollArea).toHaveClass("overflow-x-auto");
      expect(scrollArea).toHaveClass("overflow-y-hidden");
    });

    it("renders with both orientation", () => {
      render(
        <ScrollArea orientation="both" data-testid="scroll-area">
          Content
        </ScrollArea>
      );
      const scrollArea = screen.getByTestId("scroll-area");
      expect(scrollArea).toHaveClass("overflow-auto");
    });
  });

  describe("Styling", () => {
    it("has relative positioning", () => {
      render(<ScrollArea data-testid="scroll-area">Content</ScrollArea>);
      const scrollArea = screen.getByTestId("scroll-area");
      expect(scrollArea).toHaveClass("relative");
    });

    it("applies custom className", () => {
      render(
        <ScrollArea className="h-96 w-full" data-testid="scroll-area">
          Content
        </ScrollArea>
      );
      const scrollArea = screen.getByTestId("scroll-area");
      expect(scrollArea).toHaveClass("h-96");
      expect(scrollArea).toHaveClass("w-full");
    });

    it("merges custom className with base classes", () => {
      render(
        <ScrollArea className="custom-class" data-testid="scroll-area">
          Content
        </ScrollArea>
      );
      const scrollArea = screen.getByTestId("scroll-area");
      expect(scrollArea).toHaveClass("custom-class");
      expect(scrollArea).toHaveClass("relative");
    });
  });

  describe("Props and Attributes", () => {
    it("forwards ref correctly", () => {
      const ref = createRef<HTMLDivElement>();
      render(<ScrollArea ref={ref}>Content</ScrollArea>);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });

    it("accepts id prop", () => {
      render(
        <ScrollArea id="my-scroll-area" data-testid="scroll-area">
          Content
        </ScrollArea>
      );
      const scrollArea = screen.getByTestId("scroll-area");
      expect(scrollArea).toHaveAttribute("id", "my-scroll-area");
    });

    it("accepts data attributes", () => {
      render(
        <ScrollArea data-testid="scroll-area" data-section="main">
          Content
        </ScrollArea>
      );
      const scrollArea = screen.getByTestId("scroll-area");
      expect(scrollArea).toHaveAttribute("data-section", "main");
    });

    it("accepts style prop", () => {
      render(
        <ScrollArea data-testid="scroll-area" style={{ maxHeight: "500px" }}>
          Content
        </ScrollArea>
      );
      const scrollArea = screen.getByTestId("scroll-area");
      expect(scrollArea).toHaveStyle({ maxHeight: "500px" });
    });

    it("accepts aria attributes", () => {
      render(
        <ScrollArea aria-label="Scrollable content" data-testid="scroll-area">
          Content
        </ScrollArea>
      );
      const scrollArea = screen.getByTestId("scroll-area");
      expect(scrollArea).toHaveAttribute("aria-label", "Scrollable content");
    });

    it("accepts role attribute", () => {
      render(
        <ScrollArea role="region" data-testid="scroll-area">
          Content
        </ScrollArea>
      );
      const scrollArea = screen.getByTestId("scroll-area");
      expect(scrollArea).toHaveAttribute("role", "region");
    });
  });

  describe("Use Cases", () => {
    it("renders vertical scrollable list", () => {
      render(
        <ScrollArea className="h-48" data-testid="scroll-area">
          {Array.from({ length: 20 }, (_, i) => (
            <div key={i} data-testid={`item-${i}`}>
              Item {i + 1}
            </div>
          ))}
        </ScrollArea>
      );

      const scrollArea = screen.getByTestId("scroll-area");
      expect(scrollArea).toHaveClass("overflow-y-auto");
      expect(screen.getByTestId("item-0")).toBeInTheDocument();
      expect(screen.getByTestId("item-19")).toBeInTheDocument();
    });

    it("renders horizontal scrollable gallery", () => {
      render(
        <ScrollArea orientation="horizontal" className="w-96" data-testid="scroll-area">
          <div className="flex gap-4">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="h-32 w-48 flex-shrink-0" data-testid={`image-${i}`}>
                Image {i + 1}
              </div>
            ))}
          </div>
        </ScrollArea>
      );

      const scrollArea = screen.getByTestId("scroll-area");
      expect(scrollArea).toHaveClass("overflow-x-auto");
    });

    it("renders code block with both scrolls", () => {
      render(
        <ScrollArea orientation="both" className="h-64 w-full" data-testid="scroll-area">
          <pre data-testid="code">
            {`const longCode = {
  property1: "value",
  property2: "another value that is quite long to trigger horizontal scroll",
  // Many more lines...
}`}
          </pre>
        </ScrollArea>
      );

      const scrollArea = screen.getByTestId("scroll-area");
      expect(scrollArea).toHaveClass("overflow-auto");
    });

    it("renders nested scroll areas", () => {
      render(
        <ScrollArea className="h-96" data-testid="outer">
          <div>
            <h2>Section 1</h2>
            <ScrollArea orientation="horizontal" className="w-full" data-testid="inner">
              <div className="flex gap-2">
                <div>Card 1</div>
                <div>Card 2</div>
                <div>Card 3</div>
              </div>
            </ScrollArea>
          </div>
        </ScrollArea>
      );

      const outer = screen.getByTestId("outer");
      const inner = screen.getByTestId("inner");
      expect(outer).toHaveClass("overflow-y-auto");
      expect(inner).toHaveClass("overflow-x-auto");
    });
  });

  describe("Accessibility", () => {
    it("can be focused with tabindex", () => {
      render(
        <ScrollArea tabIndex={0} data-testid="scroll-area">
          Content
        </ScrollArea>
      );
      const scrollArea = screen.getByTestId("scroll-area");
      expect(scrollArea).toHaveAttribute("tabindex", "0");
    });

    it("supports aria-describedby", () => {
      render(
        <ScrollArea aria-describedby="scroll-hint" data-testid="scroll-area">
          Content
        </ScrollArea>
      );
      const scrollArea = screen.getByTestId("scroll-area");
      expect(scrollArea).toHaveAttribute("aria-describedby", "scroll-hint");
    });
  });
});
