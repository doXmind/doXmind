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

/**
 * The tree lists Pages and folders and nothing else.
 *
 * Filtered in the tree rather than in the store or the workspace scan, so a `.png` a Page renders
 * still resolves, a Wiki Link still reaches an Attachment, and search still sees the files it
 * always saw — this is only a decision about what the sidebar draws.
 */
describe("the files tree", () => {
  beforeEach(() => {
    useFileStore.setState({
      files: [
        item("f1", "src", { isFolder: true }),
        item("p1", "README.md", { documentType: "markdown" }),
        item("p2", "index.markdown", { documentType: "markdown" }),
        item("a1", "package.json"),
        item("a2", "game.js"),
        item("a3", "shot.png", { isAsset: true }),
        item("p3", "nested.md", { documentType: "markdown", parentId: "f1" }),
        item("a4", "main.css", { parentId: "f1" }),
      ] as never,
      openTarget: "folder",
      rootPath: "/workspace",
      openFilePath: null,
      expandedFolderIds: new Set(["f1"]),
      isLoading: false,
      isSynced: true,
    });
  });

  it("lists Markdown Pages and folders", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <FilesSidebar />
      </NextIntlClientProvider>
    );

    expect(screen.getByText("README")).toBeInTheDocument();
    expect(screen.getByText("index")).toBeInTheDocument();
    expect(screen.getByText("src")).toBeInTheDocument();

    // Its child only after the folder is opened, so the assertion below about what is hidden
    // inside a folder is answered by a folder that is actually showing its contents.
    fireEvent.click(screen.getByText("src"));
    expect(screen.getByText("nested")).toBeInTheDocument();
  });

  it("lists nothing else, at the root or inside a folder", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <FilesSidebar />
      </NextIntlClientProvider>
    );

    fireEvent.click(screen.getByText("src"));
    expect(screen.getByText("nested")).toBeInTheDocument();

    for (const hidden of ["package.json", "game.js", "shot.png", "main.css"]) {
      expect(screen.queryByText(hidden)).not.toBeInTheDocument();
    }
  });
});
