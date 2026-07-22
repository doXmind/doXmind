import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/messages/en.json";
import { UnifiedHeader } from "@/components/editor/unified-header";
import { useFileStore, type FileItem } from "@/stores/file-store";

const exportMarkdownAsPdf = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    ok: true,
    via: "local-pdf",
    status: "saved",
    path: "/tmp/Notes.pdf",
  })
);

vi.mock("@/lib/markdown-pdf-export", () => ({ exportMarkdownAsPdf }));

const now = "2026-07-01T00:00:00.000Z";

const markdownFile: FileItem = {
  id: "path:Notes.md",
  name: "Notes.md",
  content: "Alpha\n",
  isFolder: false,
  parentId: null,
  position: 0,
  isFavorite: false,
  createdAt: now,
  updatedAt: now,
  wordCount: 1,
  preview: "Alpha",
  documentType: "markdown",
  storageHandle: {
    mode: "disk",
    id: "path:Notes.md",
    kind: "document",
    documentType: "markdown",
    path: "/workspace/Notes.md",
    relPath: "Notes.md",
  },
};

function renderHeader() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <UnifiedHeader />
    </NextIntlClientProvider>
  );
}

describe("UnifiedHeader export menu", () => {
  beforeEach(() => {
    exportMarkdownAsPdf.mockClear();
    useFileStore.setState({
      files: [markdownFile],
      currentFileId: markdownFile.id,
      openTabIds: [markdownFile.id],
      currentFolderId: null,
      openTarget: "folder",
      rootPath: "/workspace",
    });
  });

  it("offers only the local PDF export the app can actually produce", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole("button", { name: en.editor.moreActions }));
    await user.click(await screen.findByRole("menuitem", { name: en.editor.exportAsPDF }));

    expect(exportMarkdownAsPdf).toHaveBeenCalledWith({
      fileId: markdownFile.id,
      fileName: "Notes.md",
    });
    expect(screen.queryByText("Word")).toBeNull();
  });
});
