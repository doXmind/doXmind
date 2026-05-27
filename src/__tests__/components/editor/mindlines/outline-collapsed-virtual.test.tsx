import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HTMLAttributes, ReactNode } from "react";
import { OutlineCollapsed } from "@/components/editor/mindlines/outline-collapsed";
import type { Heading } from "@/components/editor/mindlines/types";

// Virtualization-specific invariants for the expanded outline popover:
//   1. mounted-row DOM count is bounded by visible + overscan, regardless
//      of the heading list size
//   2. on initial open with an active heading, the virtualizer's
//      `scrollToIndex` API is invoked with `align: 'center'` — not
//      `Element.scrollIntoView` on a queried DOM node
//   3. the hover-intent safe-area corridor still keeps the popover open
//      while the user moves the pointer rail → popover, even when the
//      popover is internally scrolled

// A small viewport window emulates what `@tanstack/react-virtual` would
// hand back at runtime once the scroller has a real measured height. We
// mock the hook so jsdom (which reports zero element sizes) can exercise
// the virtual-list code path deterministically while still verifying the
// production component requests windowed rendering.
const VISIBLE_ROW_BUDGET = 22; // ~640px / 28px row estimate
const scrollToIndexSpy = vi.fn();

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({
    count,
    estimateSize,
    overscan = 0,
  }: {
    count: number;
    estimateSize: (index: number) => number;
    overscan?: number;
  }) => {
    const size = estimateSize(0);
    // At the top of a freshly-opened popover only the trailing-edge
    // overscan applies (there is nothing above index 0), so the mounted
    // window is visible + overscan, matching the real virtualizer at
    // scrollTop=0.
    const windowSize = Math.min(count, VISIBLE_ROW_BUDGET + overscan);
    return {
      getTotalSize: () => count * size,
      getVirtualItems: () =>
        Array.from({ length: windowSize }, (_, index) => ({
          index,
          key: index,
          size,
          start: index * size,
          end: (index + 1) * size,
          lane: 0,
        })),
      scrollToIndex: scrollToIndexSpy,
      measure: vi.fn(),
    };
  },
}));

vi.mock("framer-motion", () => {
  const motion = new Proxy(
    {},
    {
      get:
        () =>
        ({
          children,
          ...props
        }: HTMLAttributes<HTMLElement> & {
          animate?: unknown;
          children?: ReactNode;
          exit?: unknown;
          initial?: unknown;
        }) => {
          const passthrough = { ...props };
          delete passthrough.animate;
          delete passthrough.exit;
          delete passthrough.initial;
          return <div {...passthrough}>{children}</div>;
        },
    }
  );
  return {
    motion,
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});

function makeHeadings(n: number): Heading[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `h-${i}`,
    level: (i % 3) + 1,
    text: `Heading ${i}`,
    pos: i * 10,
  }));
}

function rect({
  left,
  top,
  width,
  height,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
}) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("OutlineCollapsed — virtualization", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
    scrollToIndexSpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mounts a bounded number of rows even for a 200-heading outline", () => {
    const headings = makeHeadings(200);
    render(<OutlineCollapsed headings={headings} activeId="h-0" onNavigate={vi.fn()} />);

    fireEvent.mouseEnter(screen.getByTestId("outline-rail-hover-sensor"));

    const popover = screen.getByRole("navigation", { name: "Document outline" });
    const mountedRows = popover.querySelectorAll('[data-outline-virtual-row="true"]');

    // Visible budget + 2x overscan caps mounted rows ≪ heading count.
    expect(mountedRows.length).toBeGreaterThan(0);
    expect(mountedRows.length).toBeLessThanOrEqual(30);
    expect(mountedRows.length).toBeLessThan(headings.length);
  });

  it("calls scrollToIndex with the active row centered on open, not scrollIntoView", () => {
    const headings = makeHeadings(200);
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    render(<OutlineCollapsed headings={headings} activeId="h-150" onNavigate={vi.fn()} />);

    fireEvent.mouseEnter(screen.getByTestId("outline-rail-hover-sensor"));
    // Effects flush on the next tick under fake timers.
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(scrollToIndexSpy).toHaveBeenCalled();
    const [index, options] = scrollToIndexSpy.mock.calls[0];
    expect(index).toBe(150);
    expect(options).toMatchObject({ align: "center" });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("scrolls to the active row exactly once per open lifecycle", () => {
    const headings = makeHeadings(50);
    const { rerender } = render(
      <OutlineCollapsed headings={headings} activeId="h-25" onNavigate={vi.fn()} />
    );

    fireEvent.mouseEnter(screen.getByTestId("outline-rail-hover-sensor"));
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const callsAfterOpen = scrollToIndexSpy.mock.calls.length;
    expect(callsAfterOpen).toBeGreaterThan(0);

    // Re-render with the popover still open — active-row scroll should NOT
    // re-fire (Wave B owns active-state updates; C only nudges on open).
    rerender(<OutlineCollapsed headings={headings} activeId="h-30" onNavigate={vi.fn()} />);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(scrollToIndexSpy.mock.calls.length).toBe(callsAfterOpen);
  });

  it("preserves the rail-to-popover safe-area corridor when the virtualised list scrolls mid-transit", () => {
    const headings = makeHeadings(200);
    render(<OutlineCollapsed headings={headings} activeId="h-100" onNavigate={vi.fn()} />);

    const railTrigger = screen.getByTestId("outline-rail-trigger");
    const railSensor = screen.getByTestId("outline-rail-hover-sensor");
    railTrigger.getBoundingClientRect = () => rect({ left: 920, top: 220, width: 24, height: 120 });

    fireEvent.mouseEnter(railSensor);
    const popoverNav = screen.getByRole("navigation", { name: "Document outline" });
    expect(popoverNav).toBeInTheDocument();

    // The virtualised popover scroller — the inner viewport our safe-area
    // logic must coexist with. Mid-transit scroll inside this element
    // must not bleed into the hover-intent state machine.
    const scroller = popoverNav.querySelector(
      '[data-testid="outline-popover-virtual-list"]'
    )?.parentElement;
    expect(scroller).toBeTruthy();

    // Cursor leaves the rail inside the safe-area corridor (mirrors the
    // existing test #3 in `outline-collapsed.test.tsx`).
    fireEvent.mouseLeave(railSensor, { clientX: 925, clientY: 260 });
    if (scroller) {
      fireEvent.scroll(scroller, { target: { scrollTop: 200 } });
    }
    act(() => {
      vi.advanceTimersByTime(120);
    });

    // Popover still mounted — internal scroll did not interfere with the
    // safe-area corridor that previously kept the popover open.
    expect(screen.getByRole("navigation", { name: "Document outline" })).toBeInTheDocument();

    // And the Escape contract still works after a mid-transit scroll.
    fireEvent.keyDown(screen.getByTestId("outline-rail-root"), { key: "Escape" });
    expect(screen.queryByRole("navigation", { name: "Document outline" })).not.toBeInTheDocument();
  });
});
