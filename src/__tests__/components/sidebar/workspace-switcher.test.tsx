import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceSwitcher } from "@/components/sidebar/workspace-switcher";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useEditorStore } from "@/stores/editor-store";
import { useFileStore } from "@/stores/file-store";
import en from "@/messages/en.json";

function renderSwitcher() {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <WorkspaceSwitcher label="Notes" />
    </NextIntlClientProvider>
  );
}

describe("WorkspaceSwitcher close folder", () => {
  beforeEach(() => {
    useFileStore.setState({
      openTarget: "folder",
      rootPath: "/workspace",
      openFilePath: null,
      currentFileId: "page-1",
      openTabIds: ["page-1"],
      files: [
        {
          id: "page-1",
          name: "Draft.md",
          content: "draft",
          isFolder: false,
          parentId: null,
          position: 0,
          isFavorite: false,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          wordCount: 1,
          preview: "draft",
          documentType: "markdown",
        },
      ],
    });
    useEditorStore.setState({ isDirty: true });
    useEditorRefStore.setState({
      requestSave: vi.fn().mockResolvedValue(false),
      discardPendingChanges: vi.fn(),
    });
  });

  it("keeps the workspace open when closing is cancelled or saving is declined", async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(screen.getByRole("button", { name: "Switch workspace" }));
    await user.click(screen.getByRole("menuitem", { name: "Close Folder" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Draft.md");
    expect(useFileStore.getState().openTarget).toBe("folder");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(useFileStore.getState().openTarget).toBe("folder");
    expect(useEditorRefStore.getState().requestSave).toHaveBeenCalledOnce();
  });

  it("discards only after the user chooses Don't Save", async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(screen.getByRole("button", { name: "Switch workspace" }));
    await user.click(screen.getByRole("menuitem", { name: "Close Folder" }));
    await user.click(screen.getByRole("button", { name: "Don't Save" }));

    expect(useEditorRefStore.getState().discardPendingChanges).toHaveBeenCalledOnce();
    expect(useFileStore.getState().openTarget).toBe("none");
  });
});
