import { NextIntlClientProvider } from "next-intl";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { FilesSidebar } from "@/components/sidebar/files-sidebar";
import { useFileStore } from "@/stores/file-store";
import en from "@/messages/en.json";

const now = "2026-09-02T00:00:00.000Z";

function item(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    content: "",
    isFolder: false,
    parentId: null,
    position: 0,
    isFavorite: false,
    createdAt: now,
    updatedAt: now,
    wordCount: 0,
    preview: "",
    storageHandle: { mode: "disk", id, kind: "document", relPath: name },
    ...extra,
  };
}

function renderSidebar() {
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <FilesSidebar />
    </NextIntlClientProvider>
  );
}

/**
 * The one fold control in the sidebar header.
 *
 * It only ever closed folders: once everything was shut it did nothing, and the only way back was
 * clicking each folder open again — with the button still offering to "Collapse all".
 */
describe("the sidebar fold button", () => {
  beforeEach(() => {
    useFileStore.setState({
      files: [
        item("f1", "src", { isFolder: true }),
        item("p1", "nested.md", { documentType: "markdown", parentId: "f1" }),
      ] as never,
      openTarget: "folder",
      rootPath: "/workspace",
      openFilePath: null,
      isLoading: false,
      isSynced: true,
    });
  });

  it("opens every folder, then closes them again", () => {
    renderSidebar();
    expect(screen.queryByText("nested")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getByText("nested")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.queryByText("nested")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand all" })).toBeInTheDocument();
  });

  it("follows a folder opened by hand", () => {
    renderSidebar();

    fireEvent.click(screen.getByText("src"));

    // Something is open, so the one thing left to offer is closing it.
    expect(screen.getByRole("button", { name: "Collapse all" })).toBeInTheDocument();
  });
});
