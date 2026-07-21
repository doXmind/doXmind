import { NextIntlClientProvider } from "next-intl";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileActionsMenuItems, getMenuItemCount } from "@/components/sidebar/file-actions-menu";
import { FileItem } from "@/components/sidebar/file-item";
import en from "@/messages/en.json";
import { useFileStore } from "@/stores/file-store";
import type { FileItem as FileItemType } from "@/types";

const opener = vi.hoisted(() => ({
  openPath: vi.fn(() => Promise.resolve()),
  revealItemInDir: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/plugin-opener", () => opener);

function attachment(
  id: string,
  name: string,
  documentType: "pdf" | "excel" | "html"
): FileItemType {
  return {
    id,
    name,
    content: "",
    isFolder: false,
    parentId: "folder:attachments",
    position: 0,
    isFavorite: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    wordCount: 0,
    preview: "",
    documentType,
    storageHandle: {
      mode: "disk",
      id,
      kind: "document",
      documentType,
      path: `attachments/${name}`,
      relPath: `attachments/${name}`,
    },
  };
}

const attachments = [
  { file: attachment("path:attachments/spec", "Spec.pdf", "pdf"), label: "Spec" },
  {
    file: attachment("path:attachments/forecast", "Forecast.xlsx", "excel"),
    label: "Forecast",
  },
  { file: attachment("path:attachments/guide", "Guide.html", "html"), label: "Guide" },
];

const pdfAttachment = attachments[0].file;

describe("FileActionsMenuItems attachment boundary", () => {
  beforeEach(() => {
    opener.openPath.mockClear();
    opener.revealItemInDir.mockClear();
    useFileStore.setState({
      files: attachments.map(({ file }) => file),
      currentFileId: null,
      rootPath: "/workspace",
      selectedFileIds: new Set(),
      justCreatedFileId: null,
    });
  });

  it.each(attachments)(
    "limits the $file.documentType context menu to non-mutating attachment actions",
    async () => {
      const user = userEvent.setup();
      const onOpenExternally = vi.fn();
      const onRevealInFinder = vi.fn();

      render(
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          <div role="menu">
            <FileActionsMenuItems
              variant="context"
              hasParent
              isAttachment
              onOpenExternally={onOpenExternally}
              onRename={vi.fn()}
              onRevealInFinder={onRevealInFinder}
              onMoveToRoot={vi.fn()}
              onExport={vi.fn()}
              onDelete={vi.fn()}
            />
          </div>
        </NextIntlClientProvider>
      );

      await user.click(screen.getByRole("menuitem", { name: "Open externally" }));
      await user.click(screen.getByRole("menuitem", { name: "Reveal in Finder" }));

      expect(onOpenExternally).toHaveBeenCalledOnce();
      expect(onRevealInFinder).toHaveBeenCalledOnce();
      expect(screen.queryByRole("menuitem", { name: "Rename" })).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Move to Root" })).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Move to Trash" })).not.toBeInTheDocument();
      expect(screen.queryByText("Export as")).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Markdown" })).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "PDF" })).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Word" })).not.toBeInTheDocument();
      expect(getMenuItemCount(true, true)).toBe(2);
    }
  );

  it.each(attachments)(
    "limits the $file.documentType dropdown to open and reveal",
    async ({ file }) => {
      const user = userEvent.setup();
      useFileStore.setState({ files: [file] });

      render(
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          <FileItem file={file} />
        </NextIntlClientProvider>
      );

      await user.click(screen.getByRole("button", { name: "File options" }));

      expect(await screen.findByRole("menuitem", { name: "Open externally" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Reveal in Finder" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Rename" })).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Move to Root" })).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Move to Trash" })).not.toBeInTheDocument();
    }
  );

  it.each(attachments)(
    "blocks inline rename, selection, and drag for $file.documentType rows",
    ({ file, label }) => {
      useFileStore.setState({ files: [file] });
      const setData = vi.fn();

      render(
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          <FileItem file={file} />
        </NextIntlClientProvider>
      );

      const row = screen.getByText(label).closest("[data-drop-target-id]");
      expect(row).not.toBeNull();
      expect(row).toHaveAttribute("draggable", "false");

      fireEvent.doubleClick(screen.getByText(label));
      fireEvent.click(row!, { ctrlKey: true });
      fireEvent.dragStart(row!, { dataTransfer: { effectAllowed: "none", setData } });
      fireEvent.keyDown(row!, { key: "F2" });
      fireEvent.keyDown(row!, { key: "Delete" });

      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.queryByText("Move to Trash")).not.toBeInTheDocument();
      expect(useFileStore.getState().selectedFileIds).toEqual(new Set());
      expect(setData).not.toHaveBeenCalled();
    }
  );

  it.each(attachments)(
    "keeps keyboard context actions non-mutating for $file.documentType rows",
    async ({ file, label }) => {
      const user = userEvent.setup();
      useFileStore.setState({ files: [file] });

      render(
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          <FileItem file={file} />
        </NextIntlClientProvider>
      );

      fireEvent.contextMenu(screen.getByText(label), { clientX: 20, clientY: 20 });
      await user.keyboard("{End}{Enter}");

      await waitFor(() => {
        expect(opener.revealItemInDir).toHaveBeenCalledWith(
          `/workspace/${file.storageHandle?.relPath}`
        );
      });
      expect(screen.queryByText("Move to Trash")).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    }
  );

  it("does not auto-enter rename after importing an attachment", async () => {
    useFileStore.setState({
      files: [pdfAttachment],
      justCreatedFileId: pdfAttachment.id,
    });

    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <FileItem file={pdfAttachment} />
      </NextIntlClientProvider>
    );

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(useFileStore.getState().justCreatedFileId).toBeNull();
    });
  });

  it("opens an attachment row in the system application", async () => {
    const user = userEvent.setup();
    useFileStore.setState({ files: [pdfAttachment] });

    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <FileItem file={pdfAttachment} />
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
    expect(screen.queryByRole("menuitem", { name: "Word" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Open externally" })).not.toBeInTheDocument();
    expect(getMenuItemCount(false)).toBe(5);
  });
});
