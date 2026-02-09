/**
 * Tests for Skeleton components
 * Note: Skeleton components only accept className prop, not arbitrary HTML attributes.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Skeleton, SkeletonLine, SkeletonCircle, SkeletonButton } from "@/components/ui/skeleton";

describe("Skeleton", () => {
  describe("Base Skeleton", () => {
    it("renders correctly", () => {
      const { container } = render(<Skeleton />);
      const skeleton = container.querySelector("div");
      expect(skeleton).toBeInTheDocument();
    });

    it("has animation class", () => {
      const { container } = render(<Skeleton />);
      const skeleton = container.querySelector("div");
      expect(skeleton).toHaveClass("animate-pulse");
    });

    it("has base styling classes", () => {
      const { container } = render(<Skeleton />);
      const skeleton = container.querySelector("div");
      expect(skeleton).toHaveClass("rounded-md");
      expect(skeleton).toHaveClass("bg-muted");
    });

    it("applies custom className", () => {
      const { container } = render(<Skeleton className="h-10 w-full" />);
      const skeleton = container.querySelector("div");
      expect(skeleton).toHaveClass("h-10");
      expect(skeleton).toHaveClass("w-full");
    });

    it("merges custom className with base classes", () => {
      const { container } = render(<Skeleton className="custom-class" />);
      const skeleton = container.querySelector("div");
      expect(skeleton).toHaveClass("custom-class");
      expect(skeleton).toHaveClass("animate-pulse");
      expect(skeleton).toHaveClass("rounded-md");
    });

    it("renders as div element", () => {
      const { container } = render(<Skeleton />);
      const skeleton = container.querySelector("div");
      expect(skeleton?.tagName).toBe("DIV");
    });
  });

  describe("SkeletonLine", () => {
    it("renders correctly", () => {
      const { container } = render(<SkeletonLine />);
      const skeleton = container.querySelector("div");
      expect(skeleton).toBeInTheDocument();
    });

    it("has line-specific classes", () => {
      const { container } = render(<SkeletonLine />);
      const skeleton = container.querySelector("div");
      expect(skeleton).toHaveClass("h-4");
      expect(skeleton).toHaveClass("w-full");
    });

    it("has base skeleton classes", () => {
      const { container } = render(<SkeletonLine />);
      const skeleton = container.querySelector("div");
      expect(skeleton).toHaveClass("animate-pulse");
      expect(skeleton).toHaveClass("rounded-md");
      expect(skeleton).toHaveClass("bg-muted");
    });

    it("applies custom className", () => {
      const { container } = render(<SkeletonLine className="w-1/2" />);
      const skeleton = container.querySelector("div");
      expect(skeleton).toHaveClass("w-1/2");
    });
  });

  describe("SkeletonCircle", () => {
    it("renders correctly", () => {
      const { container } = render(<SkeletonCircle />);
      const skeleton = container.querySelector("div");
      expect(skeleton).toBeInTheDocument();
    });

    it("has circle-specific classes", () => {
      const { container } = render(<SkeletonCircle />);
      const skeleton = container.querySelector("div");
      expect(skeleton).toHaveClass("h-10");
      expect(skeleton).toHaveClass("w-10");
      expect(skeleton).toHaveClass("rounded-full");
    });

    it("has base skeleton classes", () => {
      const { container } = render(<SkeletonCircle />);
      const skeleton = container.querySelector("div");
      expect(skeleton).toHaveClass("animate-pulse");
      expect(skeleton).toHaveClass("bg-muted");
    });

    it("applies custom className", () => {
      const { container } = render(<SkeletonCircle className="h-12 w-12" />);
      const skeleton = container.querySelector("div");
      expect(skeleton).toHaveClass("h-12");
      expect(skeleton).toHaveClass("w-12");
    });
  });

  describe("SkeletonButton", () => {
    it("renders correctly", () => {
      const { container } = render(<SkeletonButton />);
      const skeleton = container.querySelector("div");
      expect(skeleton).toBeInTheDocument();
    });

    it("has button-specific classes", () => {
      const { container } = render(<SkeletonButton />);
      const skeleton = container.querySelector("div");
      expect(skeleton).toHaveClass("h-9");
      expect(skeleton).toHaveClass("w-24");
      expect(skeleton).toHaveClass("rounded-md");
    });

    it("has base skeleton classes", () => {
      const { container } = render(<SkeletonButton />);
      const skeleton = container.querySelector("div");
      expect(skeleton).toHaveClass("animate-pulse");
      expect(skeleton).toHaveClass("bg-muted");
    });

    it("applies custom className", () => {
      const { container } = render(<SkeletonButton className="w-32" />);
      const skeleton = container.querySelector("div");
      expect(skeleton).toHaveClass("w-32");
    });
  });

  describe("Use Cases", () => {
    it("can render multiple lines for text placeholder", () => {
      render(
        <div data-testid="text-placeholder">
          <SkeletonLine />
          <SkeletonLine />
          <SkeletonLine className="w-2/3" />
        </div>
      );

      const container = screen.getByTestId("text-placeholder");
      const lines = container.querySelectorAll("div > div");
      expect(lines).toHaveLength(3);
    });

    it("can render user avatar placeholder", () => {
      render(
        <div data-testid="user-placeholder" className="flex items-center gap-4">
          <SkeletonCircle />
          <div>
            <SkeletonLine className="w-32" />
            <SkeletonLine className="w-48" />
          </div>
        </div>
      );

      const container = screen.getByTestId("user-placeholder");
      expect(container.querySelector(".rounded-full")).toBeInTheDocument();
    });

    it("can render card placeholder", () => {
      render(
        <div data-testid="card-placeholder">
          <Skeleton className="h-40 w-full" />
          <SkeletonLine className="mt-4" />
          <SkeletonLine className="mt-2 w-3/4" />
          <SkeletonButton className="mt-4" />
        </div>
      );

      const container = screen.getByTestId("card-placeholder");
      expect(container.querySelectorAll(".animate-pulse")).toHaveLength(4);
    });

    it("can render table row placeholder", () => {
      render(
        <div data-testid="table-row" className="flex gap-4">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-20" />
        </div>
      );

      const container = screen.getByTestId("table-row");
      expect(container.querySelectorAll(".animate-pulse")).toHaveLength(4);
    });
  });

  describe("Accessibility", () => {
    it("can be wrapped with accessible container for screen readers", () => {
      render(
        <div
          role="progressbar"
          aria-label="Loading content"
          aria-busy="true"
          data-testid="loading-container"
        >
          <Skeleton className="h-4 w-full" />
        </div>
      );

      const container = screen.getByTestId("loading-container");
      expect(container).toHaveAttribute("role", "progressbar");
      expect(container).toHaveAttribute("aria-label", "Loading content");
      expect(container).toHaveAttribute("aria-busy", "true");
    });

    it("skeleton renders as decorative div without semantic role", () => {
      const { container } = render(<Skeleton />);
      const skeleton = container.querySelector("div");
      expect(skeleton?.tagName).toBe("DIV");
      // Decorative element - no role attribute
      expect(skeleton).not.toHaveAttribute("role");
    });
  });

  describe("Visual Variants", () => {
    it("renders different sizes correctly", () => {
      const { rerender, container } = render(<Skeleton className="h-2" />);
      expect(container.querySelector("div")).toHaveClass("h-2");

      rerender(<Skeleton className="h-4" />);
      expect(container.querySelector("div")).toHaveClass("h-4");

      rerender(<Skeleton className="h-8" />);
      expect(container.querySelector("div")).toHaveClass("h-8");
    });

    it("renders different widths correctly", () => {
      const { rerender, container } = render(<Skeleton className="w-1/4" />);
      expect(container.querySelector("div")).toHaveClass("w-1/4");

      rerender(<Skeleton className="w-1/2" />);
      expect(container.querySelector("div")).toHaveClass("w-1/2");

      rerender(<Skeleton className="w-full" />);
      expect(container.querySelector("div")).toHaveClass("w-full");
    });
  });
});
