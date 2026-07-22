import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { PageGraphPanel, type PageGraphServices } from "@/components/editor/page-graph-panel";
import type { KnowledgeIndex } from "@/lib/knowledge-index";
import type { FileItem } from "@/types";
import en from "@/messages/en.json";

const file: FileItem = {
  id: "a",
  name: "A.md",
  content: "[[B]]\n",
  isFolder: false,
  parentId: null,
  position: 0,
  isFavorite: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  wordCount: 1,
  preview: "B",
  documentType: "markdown",
  storageHandle: { mode: "disk", id: "a", path: "A.md", relPath: "A.md" },
};

const index: KnowledgeIndex = {
  pages: [
    { id: "a", path: "A.md", title: "A", aliases: [] },
    { id: "b", path: "B.md", title: "B", aliases: [] },
  ],
  links: [
    {
      kind: "wiki",
      sourceId: "a",
      sourcePath: "A.md",
      targetId: "b",
      targetPath: "B.md",
      targetText: "B",
      alias: null,
      fragment: null,
      status: "resolved",
      range: { from: 0, to: 5 },
    },
  ],
  backlinks: [],
  unlinkedMentions: [],
};

describe("PageGraphPanel", () => {
  it("rebuilds a zero-write graph and navigates through a real Page node", async () => {
    const services: PageGraphServices = {
      saveCurrentPage: vi.fn().mockResolvedValue(true),
      rebuild: vi.fn().mockResolvedValue(index),
      navigate: vi.fn().mockResolvedValue(true),
    };
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <PageGraphPanel file={file} services={services} />
      </NextIntlClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    expect(await screen.findByRole("img", { name: "Knowledge graph" })).toBeInTheDocument();
    expect(services.saveCurrentPage).toHaveBeenCalledWith("a");
    expect(services.rebuild).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Open Page: B" }));
    await waitFor(() => expect(services.navigate).toHaveBeenCalledWith("b", "B.md"));
  });
});
