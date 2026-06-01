import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowsingRuntime } from "@/components/workspace/browsing-runtime";
import { markdownToHtml } from "@/lib/markdown";
import { useLayoutStore } from "@/stores/layout-store";
import type { FileItem } from "@/types";

vi.mock("@/lib/perf", () => ({
  perfMark: vi.fn(),
  perfMeasure: vi.fn(),
  perfSync: vi.fn(<T,>(_name: string, fn: () => T) => fn()),
}));

const now = "2026-05-09T00:00:00.000Z";

function markdownFile(overrides: Partial<FileItem> = {}): FileItem {
  return {
    id: "doc-1",
    name: "Doc.md",
    content: "<p>Editor html</p>",
    editorHtml: "<p>Editor html</p>",
    browsingHtml: "<p>Browsing html</p>",
    contentMarkdown: "Browsing html",
    sourceState: "sidecar_fresh",
    outline: [],
    browsingRendererVersion: "browsing-html/v1",
    isFolder: false,
    parentId: null,
    position: 0,
    isFavorite: false,
    createdAt: now,
    updatedAt: now,
    wordCount: 0,
    preview: "",
    documentType: "markdown",
    ...overrides,
  };
}

describe("BrowsingRuntime math false-positive handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLayoutStore.setState({
      isSearchBarOpen: false,
      lineHeight: "normal",
    });
  });

  it("keeps CJK and table-cell math-like markdown literal instead of promoting it to heavy math", () => {
    const browsingHtml = markdownToHtml(
      [
        "这不是公式：$市值$。",
        "",
        "$$計画$$",
        "",
        "| Label | Value |",
        "|---|---|",
        "| Quote | $Revenue$ |",
        "",
        "$$x^2$$",
      ].join("\n")
    );

    render(<BrowsingRuntime file={markdownFile({ browsingHtml })} />);

    const documentBody = screen.getByTestId("browsing-document");
    expect(documentBody).toHaveTextContent("这不是公式：$市值$。");
    expect(documentBody).toHaveTextContent("$$計画$$");
    expect(screen.getByRole("cell", { name: "$Revenue$" })).toBeInTheDocument();

    expect(document.querySelector('[data-type="inline-math"][data-latex="市值"]')).toBeNull();
    expect(document.querySelector('[data-type="block-math"][data-latex="計画"]')).toBeNull();
    expect(screen.getByRole("table").querySelector('[data-type="inline-math"]')).toBeNull();
    expect(screen.getByRole("table").querySelector('[data-type="block-math"]')).toBeNull();

    const heavyMathBlocks = document.querySelectorAll('[data-browsing-heavy-block="math"]');
    expect(heavyMathBlocks).toHaveLength(1);
    expect(heavyMathBlocks[0]).toHaveAttribute("data-type", "block-math");
    expect(heavyMathBlocks[0]).toHaveTextContent("x^2");
  });
});
