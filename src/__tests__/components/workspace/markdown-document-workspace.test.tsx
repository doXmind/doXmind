import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownDocumentWorkspace } from "@/components/workspace/markdown-document-workspace";
import { useLayoutStore } from "@/stores/layout-store";
import type { FileItem } from "@/types";

vi.mock("@/lib/perf", () => ({
  perfMark: vi.fn(),
  perfMeasure: vi.fn(),
  perfSync: vi.fn(<T,>(_name: string, fn: () => T) => fn()),
}));

vi.mock("@/components/workspace/markdown-runtime", () => ({
  MarkdownRuntime: ({
    initialActivationIntent,
  }: {
    initialActivationIntent?: { type: string };
  }) => <div data-testid="markdown-runtime" data-intent={initialActivationIntent?.type ?? ""} />,
}));

const now = "2026-05-09T00:00:00.000Z";

function markdownFile(overrides: Partial<FileItem> = {}): FileItem {
  return {
    id: "doc-1",
    name: "Doc.md",
    content: "<h1>Editor html</h1>",
    editorHtml: "<h1>Editor html</h1>",
    browsingHtml: "<h1>Browsing html</h1>",
    contentMarkdown: "# Browsing html",
    sourceState: "sidecar_fresh",
    outline: [{ id: "browsing-html", depth: 1, text: "Browsing html" }],
    browsingRendererVersion: "browsing-html/v1",
    isFolder: false,
    parentId: null,
    position: 0,
    isFavorite: false,
    icon: null,
    coverImageUrl: null,
    coverPosition: 0.5,
    createdAt: now,
    updatedAt: now,
    wordCount: 0,
    preview: "",
    documentType: "markdown",
    ...overrides,
  };
}

describe("MarkdownDocumentWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLayoutStore.setState({
      isSearchBarOpen: false,
      lineHeight: "normal",
    });
  });

  it("renders browsing HTML first and lazy-loads the editor on edit activation", async () => {
    render(<MarkdownDocumentWorkspace file={markdownFile()} />);

    expect(screen.getByTestId("browsing-runtime")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Browsing html" })).toBeInTheDocument();
    expect(screen.queryByTestId("markdown-runtime")).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("browsing-document"), {
      button: 0,
      clientX: 20,
      clientY: 20,
    });

    await waitFor(() => {
      expect(screen.getByTestId("markdown-runtime")).toHaveAttribute("data-intent", "pointer");
    });
    expect(screen.queryByTestId("browsing-runtime")).not.toBeInTheDocument();
  });
});
