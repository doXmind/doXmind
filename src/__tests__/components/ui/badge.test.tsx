/**
 * Tests for Badge component
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "@/components/ui/badge";

describe("Badge", () => {
  describe("Rendering", () => {
    it("renders correctly with text", () => {
      render(<Badge>New</Badge>);
      expect(screen.getByText("New")).toBeInTheDocument();
    });

    it("renders with default variant", () => {
      render(<Badge data-testid="badge">Default</Badge>);
      const badge = screen.getByTestId("badge");
      expect(badge).toHaveClass("bg-primary");
      expect(badge).toHaveClass("text-primary-foreground");
    });

    it("renders children correctly", () => {
      render(
        <Badge>
          <span>Icon</span> Label
        </Badge>
      );
      expect(screen.getByText("Icon")).toBeInTheDocument();
      expect(screen.getByText(/Label/)).toBeInTheDocument();
    });
  });

  describe("Variants", () => {
    it("renders default variant", () => {
      render(
        <Badge variant="default" data-testid="badge">
          Default
        </Badge>
      );
      const badge = screen.getByTestId("badge");
      expect(badge).toHaveClass("bg-primary");
      expect(badge).toHaveClass("text-primary-foreground");
      expect(badge).toHaveClass("border-transparent");
    });

    it("renders secondary variant", () => {
      render(
        <Badge variant="secondary" data-testid="badge">
          Secondary
        </Badge>
      );
      const badge = screen.getByTestId("badge");
      expect(badge).toHaveClass("bg-secondary");
      expect(badge).toHaveClass("text-secondary-foreground");
      expect(badge).toHaveClass("border-transparent");
    });

    it("renders destructive variant", () => {
      render(
        <Badge variant="destructive" data-testid="badge">
          Destructive
        </Badge>
      );
      const badge = screen.getByTestId("badge");
      expect(badge).toHaveClass("bg-destructive");
      expect(badge).toHaveClass("text-destructive-foreground");
      expect(badge).toHaveClass("border-transparent");
    });

    it("renders outline variant", () => {
      render(
        <Badge variant="outline" data-testid="badge">
          Outline
        </Badge>
      );
      const badge = screen.getByTestId("badge");
      expect(badge).toHaveClass("text-foreground");
      expect(badge).not.toHaveClass("bg-primary");
      expect(badge).not.toHaveClass("bg-secondary");
      expect(badge).not.toHaveClass("bg-destructive");
    });
  });

  describe("Styling", () => {
    it("has base styling classes", () => {
      render(<Badge data-testid="badge">Test</Badge>);
      const badge = screen.getByTestId("badge");
      expect(badge).toHaveClass("inline-flex");
      expect(badge).toHaveClass("items-center");
      expect(badge).toHaveClass("rounded-full");
      expect(badge).toHaveClass("border");
      expect(badge).toHaveClass("font-semibold");
      expect(badge).toHaveClass("text-xs");
    });

    it("has padding classes", () => {
      render(<Badge data-testid="badge">Test</Badge>);
      const badge = screen.getByTestId("badge");
      expect(badge).toHaveClass("px-2.5");
      expect(badge).toHaveClass("py-0.5");
    });

    it("has transition classes", () => {
      render(<Badge data-testid="badge">Test</Badge>);
      const badge = screen.getByTestId("badge");
      expect(badge).toHaveClass("transition-colors");
    });

    it("has focus ring classes", () => {
      render(<Badge data-testid="badge">Test</Badge>);
      const badge = screen.getByTestId("badge");
      expect(badge).toHaveClass("focus:outline-none");
      expect(badge).toHaveClass("focus:ring-2");
      expect(badge).toHaveClass("focus:ring-ring");
      expect(badge).toHaveClass("focus:ring-offset-2");
    });

    it("applies custom className", () => {
      render(
        <Badge className="custom-class" data-testid="badge">
          Test
        </Badge>
      );
      const badge = screen.getByTestId("badge");
      expect(badge).toHaveClass("custom-class");
    });

    it("merges custom className with base classes", () => {
      render(
        <Badge className="custom-class" data-testid="badge">
          Test
        </Badge>
      );
      const badge = screen.getByTestId("badge");
      expect(badge).toHaveClass("custom-class");
      expect(badge).toHaveClass("inline-flex");
      expect(badge).toHaveClass("rounded-full");
    });
  });

  describe("HTML Attributes", () => {
    it("accepts id prop", () => {
      render(
        <Badge id="my-badge" data-testid="badge">
          Test
        </Badge>
      );
      const badge = screen.getByTestId("badge");
      expect(badge).toHaveAttribute("id", "my-badge");
    });

    it("accepts data attributes", () => {
      render(
        <Badge data-testid="badge" data-status="active">
          Test
        </Badge>
      );
      const badge = screen.getByTestId("badge");
      expect(badge).toHaveAttribute("data-status", "active");
    });

    it("accepts aria attributes", () => {
      render(
        <Badge aria-label="Status badge" data-testid="badge">
          Test
        </Badge>
      );
      const badge = screen.getByTestId("badge");
      expect(badge).toHaveAttribute("aria-label", "Status badge");
    });

    it("accepts role attribute", () => {
      render(
        <Badge role="status" data-testid="badge">
          Test
        </Badge>
      );
      const badge = screen.getByTestId("badge");
      expect(badge).toHaveAttribute("role", "status");
    });

    it("accepts onClick handler", () => {
      const handleClick = vi.fn();
      render(
        <Badge onClick={handleClick} data-testid="badge">
          Click me
        </Badge>
      );
      const badge = screen.getByTestId("badge");
      badge.click();
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe("Use Cases", () => {
    it("renders status badge", () => {
      render(<Badge variant="default">Active</Badge>);
      expect(screen.getByText("Active")).toBeInTheDocument();
    });

    it("renders error badge", () => {
      render(<Badge variant="destructive">Error</Badge>);
      expect(screen.getByText("Error")).toBeInTheDocument();
    });

    it("renders count badge", () => {
      render(<Badge variant="secondary">99+</Badge>);
      expect(screen.getByText("99+")).toBeInTheDocument();
    });

    it("renders label badge", () => {
      render(<Badge variant="outline">Beta</Badge>);
      expect(screen.getByText("Beta")).toBeInTheDocument();
    });

    it("renders with icon", () => {
      render(
        <Badge>
          <span data-testid="icon">✓</span>
          Verified
        </Badge>
      );
      expect(screen.getByTestId("icon")).toBeInTheDocument();
      expect(screen.getByText(/Verified/)).toBeInTheDocument();
    });
  });
});

// Import vi for the onClick test
import { vi } from "vitest";
