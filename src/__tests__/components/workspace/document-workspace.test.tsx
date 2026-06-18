import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentWorkspace } from "@/components/workspace/document-workspace";
import type { FileItem } from "@/stores/file-store";

vi.mock("@/components/workspace/markdown-runtime", () => ({
  MarkdownRuntime: () => <div data-testid="markdown-runtime" />,
}));

const htmlFile: FileItem = {
  id: "path:index.html",
  name: "index.html",
  content: "<h1>Hello</h1>",
  isFolder: false,
  parentId: null,
  position: 0,
  isFavorite: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  wordCount: 0,
  preview: "",
  documentType: "html",
  storageHandle: {
    mode: "disk",
    id: "path:index.html",
    kind: "document",
    documentType: "html",
    path: "index.html",
    relPath: "index.html",
  },
};

describe("DocumentWorkspace", () => {
  it("does not route HTML files through a dedicated viewer", () => {
    render(<DocumentWorkspace file={htmlFile} />);

    expect(screen.getByTestId("markdown-runtime")).toBeInTheDocument();
    expect(screen.queryByTestId("html-runtime")).not.toBeInTheDocument();
  });
});
