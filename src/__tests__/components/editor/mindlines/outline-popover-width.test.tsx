import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { OutlineCollapsed } from "@/components/editor/mindlines/outline-collapsed";
import type { Heading } from "@/components/editor/mindlines/types";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 0,
    getVirtualItems: () => [],
    scrollToIndex: vi.fn(),
    measure: vi.fn(),
  }),
}));

// Unlike the sensor test's mock, this one forwards props — the popover's own
// width is the thing under test.
vi.mock("framer-motion", () => {
  const motion = new Proxy(
    {},
    {
      get:
        () =>
        ({
          children,
          initial: _initial,
          animate: _animate,
          exit: _exit,
          ...rest
        }: Record<string, unknown> & { children?: ReactNode }) => <div {...rest}>{children}</div>,
    }
  );
  return { motion, AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</> };
});

const headings: Heading[] = [
  { id: "h-0", level: 1, text: "One", pos: 0 },
  { id: "h-1", level: 2, text: "Two", pos: 10 },
];

const realRect = Element.prototype.getBoundingClientRect;

/** Only the two edges `measurePopoverWidth` reads need to be real. */
function stubEdges({ frameRight, railRight }: { frameRight: number; railRight: number }) {
  Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element) {
    const right = this.classList.contains("markdown-page")
      ? frameRight
      : this.getAttribute("data-testid") === "outline-rail-trigger"
        ? railRight
        : 0;
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right,
      width: right,
      height: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

function openPopover() {
  const { container } = render(
    <>
      <div className="markdown-page" />
      <OutlineCollapsed headings={headings} activeId="h-0" onNavigate={vi.fn()} />
    </>
  );
  fireEvent.pointerEnter(screen.getByTestId("outline-rail-hover-sensor"));
  return container.querySelector<HTMLElement>(String.raw`[aria-label="Document outline"]`)!;
}

afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect;
});

/**
 * The rail's popover was a fixed 260px against a gutter the editor reserves at
 * 128px, so it painted 68px of the Page's own text column at every window
 * width — a control whose paint area did not correspond to what it points at.
 * It is now measured against the frame's real right edge.
 */
describe("Outline popover width", () => {
  it("clamps to the space the reservation actually bought", () => {
    // Measured in the packaged app at 1440x900: frame right 1240, rail right
    // 1424 (the 16px chrome inset). 1424 - 1240 - 4 = 180.
    stubEdges({ frameRight: 1240, railRight: 1424 });
    expect(openPopover().style.width).toBe("180px");
  });

  it("does not exceed its preferred width when there is room to spare", () => {
    stubEdges({ frameRight: 900, railRight: 1424 });
    expect(openPopover().style.width).toBe("260px");
  });

  it("never collapses below a legible floor", () => {
    stubEdges({ frameRight: 1420, railRight: 1424 });
    expect(openPopover().style.width).toBe("176px");
  });
});
