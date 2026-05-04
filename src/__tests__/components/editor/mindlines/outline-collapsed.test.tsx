import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode, HTMLAttributes } from "react";
import { OutlineCollapsed } from "@/components/editor/mindlines/outline-collapsed";
import { useFileStore } from "@/stores/file-store";
import type { Heading } from "@/components/editor/mindlines/types";
import type { FileItem } from "@/types";

// AnimatePresence's exit animation keeps elements mounted longer than the
// store-driven open/close timers we're verifying. Stub it out so the dialog
// unmounts the moment popoverOpen flips to false.
vi.mock("framer-motion", () => {
  const motion = new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...props }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) => (
          <div {...props}>{children}</div>
        ),
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

  it("opens a floating outline on hover and closes after delay", () => {
    render(<OutlineCollapsed headings={headings} activeId="h-10" onNavigate={vi.fn()} />);

    expect(screen.queryByRole("dialog", { name: "Document outline" })).not.toBeInTheDocument();

    const railButton = screen.getByRole("button", { name: "Navigate to: Overview" });
    const railRoot = railButton.parentElement?.parentElement;
    expect(railRoot).toBeTruthy();

    fireEvent.mouseEnter(railRoot!);
    act(() => vi.advanceTimersByTime(120));

    expect(screen.getByRole("dialog", { name: "Document outline" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Navigate to: Overview" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute(
      "aria-current",
      "location"
    );

    fireEvent.mouseLeave(railRoot!);
    act(() => vi.advanceTimersByTime(179));
    expect(screen.getByRole("dialog", { name: "Document outline" })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("dialog", { name: "Document outline" })).not.toBeInTheDocument();
  });

  it("keeps the expanded hover zone click-through until the popover mounts", () => {
    render(<OutlineCollapsed headings={headings} activeId="h-10" onNavigate={vi.fn()} />);

    const railRoot = screen.getByRole("button", { name: "Navigate to: Overview" }).parentElement
      ?.parentElement;
    expect(railRoot).toBeTruthy();

    fireEvent.mouseEnter(railRoot!);

    expect(railRoot).toHaveStyle({
      width: "260px",
      pointerEvents: "none",
    });
    expect(screen.queryByRole("dialog", { name: "Document outline" })).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(120));

    expect(screen.getByRole("dialog", { name: "Document outline" })).toBeInTheDocument();
    expect(railRoot).toHaveStyle({ pointerEvents: "auto" });
  });

  it("navigates from popover items without forcing editor focus", () => {
    const onNavigate = vi.fn();
    render(<OutlineCollapsed headings={headings} activeId="h-0" onNavigate={onNavigate} />);

    const railRoot = screen.getByRole("button", { name: "Navigate to: Overview" }).parentElement
      ?.parentElement;
    fireEvent.mouseEnter(railRoot!);
    act(() => vi.advanceTimersByTime(120));

    fireEvent.click(screen.getByRole("button", { name: "Detail" }));

    expect(onNavigate).toHaveBeenCalledWith(headings[2], { skipFocus: true });
  });
});
