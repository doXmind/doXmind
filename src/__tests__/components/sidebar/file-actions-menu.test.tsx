import { NextIntlClientProvider } from "next-intl";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileActionsMenuItems, getMenuItemCount } from "@/components/sidebar/file-actions-menu";
import { FileItem } from "@/components/sidebar/file-item";
import en from "@/messages/en.json";
import { useFileStore } from "@/stores/file-store";
import type { FileItem as FileItemType } from "@/types";

const invokeDesktop = vi.fn(() => Promise.resolve());

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
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    invokeDesktop.mockClear();
    vi.stubGlobal("__DOXMIND_DESKTOP__", {
      platform: "macos",
      invoke: invokeDesktop,
      listen: vi.fn(() => vi.fn()),
      getPathForFile: vi.fn(() => null),
    });
    useFileStore.setState({
      files: [attachment],
      currentFileId: null,
      rootPath: "/workspace",
      selectedFileIds: new Set(),
    });
  });

  it("offers a workspace file exactly two actions, and no write action at all", async () => {
    const user = userEvent.setup();
    const onOpenExternally = vi.fn();
    const onRevealInFinder = vi.fn();

    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <div role="menu">
          <FileActionsMenuItems
            variant="context"
            hasParent
            isAsset
            onOpenExternally={onOpenExternally}
            onRename={vi.fn()}
            onRevealInFinder={onRevealInFinder}
            onMoveToRoot={vi.fn()}
            onCopySource={vi.fn()}
            onExportPdf={vi.fn()}
            onDelete={vi.fn()}
          />
        </div>
      </NextIntlClientProvider>
    );

    // Every other row routes into a command that rejects a non-document path, so offering one
    // could only ever produce an error.
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Open externally", "Reveal in Finder"]);
    expect(getMenuItemCount(true, false, true)).toBe(2);

    await user.click(screen.getByRole("menuitem", { name: "Reveal in Finder" }));
    expect(onRevealInFinder).toHaveBeenCalledOnce();
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
            onCopySource={vi.fn()}
            onExportPdf={vi.fn()}
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
      expect(invokeDesktop).toHaveBeenCalledWith("shell_open_path", {
        path: "/workspace/attachments/Spec.pdf",
      });
    });
  });

  it("offers exact source copy and the real local-PDF projection for Markdown Pages", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <div role="menu">
          <FileActionsMenuItems
            variant="context"
            hasParent={false}
            onRename={vi.fn()}
            onRevealInFinder={vi.fn()}
            onMoveToRoot={vi.fn()}
            onCopySource={vi.fn()}
            onExportPdf={vi.fn()}
            onDelete={vi.fn()}
          />
        </div>
      </NextIntlClientProvider>
    );

    expect(screen.getByRole("menuitem", { name: "Copy Markdown Source" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "PDF" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Word" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Open externally" })).not.toBeInTheDocument();
  });
});
