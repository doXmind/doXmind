import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode, HTMLAttributes } from "react";
import { OutlineCollapsed } from "@/components/editor/mindlines/outline-collapsed";
import { useFileStore } from "@/stores/file-store";
import type { Heading } from "@/components/editor/mindlines/types";
import type { FileItem } from "@/types";

// AnimatePresence's exit animation keeps elements mounted longer than the
// store-driven open/close timers we're verifying. Stub it out so the outline
// unmounts the moment its state flips to closed.
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

const headings: Heading[] = [
  { id: "h-0", level: 1, text: "Overview", pos: 0 },
  { id: "h-10", level: 2, text: "Alpha", pos: 10 },
  { id: "h-20", level: 3, text: "Detail", pos: 20 },
];

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

function markdownFile(): FileItem {
  return {
    id: "file-1",
    name: "Test.md",
    content: "",
    contentMarkdown: "",
    documentType: "markdown",
    isFolder: false,
    parentId: null,
    position: 0,
    isFavorite: false,
    icon: null,
    coverImageUrl: null,
    coverPosition: 50,
    createdAt: "2026-05-02T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
    wordCount: 0,
    preview: "",
  };
}

describe("OutlineCollapsed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
    useFileStore.setState({
      files: [markdownFile()],
      currentFileId: "file-1",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens a floating outline instantly on hover and closes after a short delay", () => {
    render(<OutlineCollapsed headings={headings} activeId="h-10" onNavigate={vi.fn()} />);

    expect(screen.queryByRole("navigation", { name: "Document outline" })).not.toBeInTheDocument();

    const railSensor = screen.getByTestId("outline-rail-hover-sensor");

    // Open is instant — the previous 120ms primed delay was perceived as
    // outline lag on big docs; we now mount the popover on the same tick.
    fireEvent.mouseEnter(railSensor);

    expect(screen.getByRole("navigation", { name: "Document outline" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Navigate to: Overview" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute(
      "aria-current",
      "location"
    );

    fireEvent.mouseLeave(railSensor, { clientX: 500, clientY: 500 });
    act(() => vi.advanceTimersByTime(59));
    expect(screen.getByRole("navigation", { name: "Document outline" })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("navigation", { name: "Document outline" })).not.toBeInTheDocument();
  });

  it("keeps the rail trigger full width while the popover is open", () => {
    render(<OutlineCollapsed headings={headings} activeId="h-10" onNavigate={vi.fn()} />);

    const railRoot = screen.getByTestId("outline-rail-root");
    const railTrigger = screen.getByTestId("outline-rail-trigger");
    const railSensor = screen.getByTestId("outline-rail-hover-sensor");

    expect(railRoot).toHaveStyle({ width: "100%" });
    expect(railTrigger).toHaveStyle({ width: "100%" });
    expect(screen.queryByRole("navigation", { name: "Document outline" })).not.toBeInTheDocument();

    fireEvent.mouseEnter(railSensor);

    expect(screen.getByRole("navigation", { name: "Document outline" })).toBeInTheDocument();
    expect(railRoot).toHaveStyle({ width: "100%" });
    expect(railTrigger).toHaveStyle({ width: "100%" });
  });

  it("keeps the primed open alive while the pointer remains in the rail hit area", () => {
    render(<OutlineCollapsed headings={headings} activeId="h-10" onNavigate={vi.fn()} />);

    const railTrigger = screen.getByTestId("outline-rail-trigger");
    const railSensor = screen.getByTestId("outline-rail-hover-sensor");
    railTrigger.getBoundingClientRect = () => rect({ left: 920, top: 220, width: 24, height: 120 });

    fireEvent.mouseEnter(railSensor);
    fireEvent.mouseLeave(railSensor, { clientX: 925, clientY: 260 });
    act(() => vi.advanceTimersByTime(120));

    expect(screen.getByRole("navigation", { name: "Document outline" })).toBeInTheDocument();
  });

  it("cancels a primed open when the pointer moves away from the safe corridor", () => {
    render(<OutlineCollapsed headings={headings} activeId="h-10" onNavigate={vi.fn()} />);

    const railTrigger = screen.getByTestId("outline-rail-trigger");
    const railSensor = screen.getByTestId("outline-rail-hover-sensor");
    railTrigger.getBoundingClientRect = () => rect({ left: 920, top: 220, width: 24, height: 120 });

    fireEvent.mouseEnter(railSensor);
    fireEvent.mouseLeave(railSensor, { clientX: 500, clientY: 760 });
    fireEvent.pointerMove(window, { clientX: 500, clientY: 760 });
    act(() => vi.advanceTimersByTime(120));

    expect(screen.queryByRole("navigation", { name: "Document outline" })).not.toBeInTheDocument();
  });

  it("closes the floating outline with Escape", () => {
    render(<OutlineCollapsed headings={headings} activeId="h-10" onNavigate={vi.fn()} />);

    const railRoot = screen.getByTestId("outline-rail-root");
    const railSensor = screen.getByTestId("outline-rail-hover-sensor");

    fireEvent.mouseEnter(railSensor);
    act(() => vi.advanceTimersByTime(120));
    expect(screen.getByRole("navigation", { name: "Document outline" })).toBeInTheDocument();

    fireEvent.keyDown(railRoot, { key: "Escape" });

    expect(screen.queryByRole("navigation", { name: "Document outline" })).not.toBeInTheDocument();
  });

  it("navigates from popover items without forcing editor focus", () => {
    const onNavigate = vi.fn();
    render(<OutlineCollapsed headings={headings} activeId="h-0" onNavigate={onNavigate} />);

    fireEvent.mouseEnter(screen.getByTestId("outline-rail-hover-sensor"));
    act(() => vi.advanceTimersByTime(120));

    fireEvent.click(screen.getByRole("button", { name: "Detail" }));

    expect(onNavigate).toHaveBeenCalledWith(headings[2], { skipFocus: true });
  });
});
