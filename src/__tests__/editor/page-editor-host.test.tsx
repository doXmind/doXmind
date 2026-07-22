import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FileItem } from "@/stores/file-store";
import { PageEditorHost } from "@/editor/page-editor-host";

vi.mock("@/editor/markdown-block/markdown-block-runtime", () => ({
  MarkdownBlockRuntime: () => <div data-testid="markdown-block-runtime" />,
}));

function page(markdown: string): FileItem {
  return {
    id: "page-1",
    name: "Page",
    content: markdown,
    isFolder: false,
    parentId: null,
    position: 0,
    isFavorite: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    wordCount: 0,
    preview: "",
  };
}

describe("PageEditorHost", () => {
  it("uses the source-backed block runtime for plain paragraphs and ATX headings", () => {
    render(<PageEditorHost file={page("# Heading\n\nPlain text\n")} />);

    expect(screen.getByTestId("markdown-block-runtime")).toBeInTheDocument();
  });

  it("uses the source-backed block runtime for common inline Markdown", () => {
    render(
      <PageEditorHost
        file={page("Read **bold**, `code`, [links](https://example.com), and [[Wiki pages]].\n")}
      />
    );

    expect(screen.getByTestId("markdown-block-runtime")).toBeInTheDocument();
  });

  it("uses the source-backed block runtime for a soft-wrapped paragraph", () => {
    render(<PageEditorHost file={page("A paragraph can wrap\nacross source lines.\n")} />);

    expect(screen.getByTestId("markdown-block-runtime")).toBeInTheDocument();
  });

  it("uses the source-backed block runtime for fenced code with internal blank lines", () => {
    render(<PageEditorHost file={page("```ts\nconst first = 1;\n\nconst second = 2;\n```\n")} />);

    expect(screen.getByTestId("markdown-block-runtime")).toBeInTheDocument();
  });

  it("uses the source-backed block runtime for list and task items", () => {
    render(<PageEditorHost file={page("- list item\n")} />);

    expect(screen.getByTestId("markdown-block-runtime")).toBeInTheDocument();
  });

  it("keeps reference definitions in the native runtime as editable raw Blocks", () => {
    render(<PageEditorHost file={page("[reference]: /target\r\n\r\nPlain\r\n")} />);

    expect(screen.getByTestId("markdown-block-runtime")).toBeInTheDocument();
  });

  it("keeps structural thematic breaks in the native runtime as editable raw Blocks", () => {
    render(<PageEditorHost file={page("---\n")} />);

    expect(screen.getByTestId("markdown-block-runtime")).toBeInTheDocument();
  });

  it("keeps one native runtime for the lifetime of a Page editing session", () => {
    const { rerender } = render(<PageEditorHost file={page("Plain")} />);
    expect(screen.getByTestId("markdown-block-runtime")).toBeInTheDocument();

    rerender(<PageEditorHost file={page("- now looks like a list\n")} />);

    expect(screen.getByTestId("markdown-block-runtime")).toBeInTheDocument();
  });
});
