import { NextIntlClientProvider } from "next-intl";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentWorkspace } from "@/components/workspace/document-workspace";
import en from "@/messages/en.json";
import { useLayoutStore } from "@/stores/layout-store";
import type { FileItem } from "@/stores/file-store";

vi.mock("@/editor/page-editor-host", () => ({
  PageEditorHost: () => <div data-testid="native-page-editor" />,
}));

const markdownFile: FileItem = {
  id: "path:Notes.md",
  name: "Notes.md",
  content: "# Notes\n",
  isFolder: false,
  parentId: null,
  position: 0,
  isFavorite: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  wordCount: 1,
  preview: "",
  documentType: "markdown",
  storageHandle: {
    mode: "disk",
    id: "path:Notes.md",
    kind: "document",
    documentType: "markdown",
    path: "Notes.md",
    relPath: "Notes.md",
  },
};

function renderWorkspace() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <DocumentWorkspace file={markdownFile} />
    </NextIntlClientProvider>
  );
}

afterEach(() => {
  act(() => useLayoutStore.setState({ isFocusMode: false }));
});

/**
 * The Page-controls row floats over the scroll surface. Without an opaque
 * backing spanning the whole content column, Blocks scrolled visibly through
 * the 36px band between the header's bottom edge (44px) and the pills' bottom
 * edge (80px) — the pills themselves covered only 38% of the column, and were
 * translucent even there.
 */
describe("Page-controls chrome band", () => {
  it("paints an opaque, full-bleed backing from the header's bottom edge to the pills' bottom edge", () => {
    renderWorkspace();

    const backdrop = screen.getByTestId("page-controls-backdrop");
    const classes = backdrop.className.split(/\s+/);

    // Full width of the content column, not just under the pills.
    expect(classes).toContain("inset-x-0");
    // Opaque: the same token the editor surface paints itself with.
    expect(classes).toContain("bg-background");
    // y = 44..80: starts where the 44px header ends, ends where the pills do.
    expect(classes).toContain("top-11");
    expect(classes).toContain("h-9");
  });

  it("never takes pointer events, so the wheel and the caret still reach the Blocks below", () => {
    renderWorkspace();

    expect(screen.getByTestId("page-controls-backdrop").className.split(/\s+/)).toContain(
      "pointer-events-none"
    );
  });

  it("sits above the scroll surface but below the pills it backs", () => {
    renderWorkspace();

    const backdrop = screen.getByTestId("page-controls-backdrop");
    const pills = backdrop.parentElement?.querySelector<HTMLElement>(
      "[data-native-editor-chrome].z-40"
    );

    expect(backdrop.className.split(/\s+/)).toContain("z-30");
    expect(pills).not.toBeNull();
  });

  it("covers the whole band in focus mode, where there is no header to start from", () => {
    act(() => useLayoutStore.setState({ isFocusMode: true }));
    renderWorkspace();

    const classes = screen.getByTestId("page-controls-backdrop").className.split(/\s+/);
    expect(classes).toContain("top-0");
    expect(classes).toContain("h-20");
    expect(classes).not.toContain("top-11");
  });
});
