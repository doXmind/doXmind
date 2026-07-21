import { NextIntlClientProvider } from "next-intl";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileActionsMenuItems } from "@/components/sidebar/file-actions-menu";
import { FileItem } from "@/components/sidebar/file-item";
import en from "@/messages/en.json";
import { useFileStore } from "@/stores/file-store";
import type { FileItem as FileItemType } from "@/types";

const opener = vi.hoisted(() => ({
  openPath: vi.fn(() => Promise.resolve()),
  revealItemInDir: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/plugin-opener", () => opener);

const attachment: FileItemType = {
  id: "path:attachments/spec",
  name: "Spec.pdf",
  content: "",
  isFolder: false,
  parentId: null,
  position: 0,
  isFavorite: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  wordCount: 0,
  preview: "",
  documentType: "pdf",
  storageHandle: {
    mode: "disk",
    id: "path:attachments/spec",
    kind: "document",
    documentType: "pdf",
    path: "attachments/Spec.pdf",
    relPath: "attachments/Spec.pdf",
  },
};

describe("FileActionsMenuItems attachment boundary", () => {
  beforeEach(() => {
    opener.openPath.mockClear();
    opener.revealItemInDir.mockClear();
    useFileStore.setState({
      files: [attachment],
      currentFileId: null,
      rootPath: "/workspace",
      selectedFileIds: new Set(),
    });
  });

  it("offers attachment actions without Page export actions", async () => {
    const user = userEvent.setup();
    const onOpenExternally = vi.fn();

    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <div role="menu">
          <FileActionsMenuItems
            variant="context"
            hasParent
            isAttachment
            onOpenExternally={onOpenExternally}
            onRename={vi.fn()}
            onRevealInFinder={vi.fn()}
            onMoveToRoot={vi.fn()}
            onExport={vi.fn()}
            onDelete={vi.fn()}
          />
        </div>
      </NextIntlClientProvider>
    );

    await user.click(screen.getByRole("menuitem", { name: "Open externally" }));

    expect(onOpenExternally).toHaveBeenCalledOnce();
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Reveal in Finder" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Move to Root" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Move to Trash" })).toBeInTheDocument();
    expect(screen.queryByText("Export as")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Markdown" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "PDF" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Word" })).not.toBeInTheDocument();
  });

  it("opens an attachment row in the system application", async () => {
    const user = userEvent.setup();

    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <FileItem file={attachment} />
      </NextIntlClientProvider>
    );

    fireEvent.contextMenu(screen.getByText("Spec"), { clientX: 20, clientY: 20 });
    await user.click(await screen.findByRole("menuitem", { name: "Open externally" }));

    await waitFor(() => {
      expect(opener.openPath).toHaveBeenCalledWith("/workspace/attachments/Spec.pdf");
    });
  });

  it("keeps Page export actions for Markdown files", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <div role="menu">
          <FileActionsMenuItems
            variant="context"
            hasParent={false}
            onRename={vi.fn()}
            onRevealInFinder={vi.fn()}
            onMoveToRoot={vi.fn()}
            onExport={vi.fn()}
            onDelete={vi.fn()}
          />
        </div>
      </NextIntlClientProvider>
    );

    expect(screen.getByText("Export as")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Markdown" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "PDF" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Word" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Open externally" })).not.toBeInTheDocument();
  });
});
