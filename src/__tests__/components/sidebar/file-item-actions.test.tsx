import { NextIntlClientProvider } from "next-intl";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FileItem } from "@/components/sidebar/file-item";
import { useFileStore, type FileItem as FileItemModel } from "@/stores/file-store";
import en from "@/messages/en.json";

function page(id: string, name: string): FileItemModel {
  return {
    id,
    name,
    content: "",
    documentType: "markdown",
    storageHandle: { mode: "disk", id, kind: "document", relPath: name },
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

function renderFileItem(file: FileItemModel) {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <FileItem file={file} />
    </NextIntlClientProvider>
  );
}

describe("FileItem actions", () => {
  beforeEach(() => {
    useFileStore.setState({
      files: [page("active", "Active.md"), page("inactive", "Inactive.md")],
      currentFileId: "active",
      openTabIds: ["active"],
      loadedContentIds: new Set(),
      openTarget: "folder",
      rootPath: "/workspace",
      renameFile: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("submits an Enter rename only once when blur follows", async () => {
    const user = userEvent.setup();
    const file = page("inactive", "Inactive.md");
    const { container } = renderFileItem(file);
    fireEvent.doubleClick(container.querySelector('[data-drop-target-id="inactive"]')!);
    const input = screen.getByDisplayValue("Inactive");
    await user.clear(input);
    await user.type(input, "Renamed");
    await user.keyboard("{Enter}");
    fireEvent.blur(input);

    expect(useFileStore.getState().renameFile).toHaveBeenCalledOnce();
    expect(useFileStore.getState().renameFile).toHaveBeenCalledWith(
      "inactive",
      "Renamed.md",
      expect.objectContaining({ confirm: expect.any(Function) })
    );
  });

  it("does not activate an inactive Page when its context menu opens Delete confirmation", async () => {
    const user = userEvent.setup();
    const { container } = renderFileItem(page("inactive", "Inactive.md"));
    fireEvent.contextMenu(container.querySelector('[data-drop-target-id="inactive"]')!);
    await user.click(screen.getByRole("menuitem", { name: "Move to Trash" }));

    expect(useFileStore.getState().currentFileId).toBe("active");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
