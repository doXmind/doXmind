import { beforeEach, describe, expect, it, vi } from "vitest";

import { navigateToEditorFile, navigateToWorkspacePage } from "@/lib/editor-navigation";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useEditorStore } from "@/stores/editor-store";
import { useFileStore, type FileItem } from "@/stores/file-store";

const now = "2026-07-21T00:00:00.000Z";
const originalOpenFile = useFileStore.getState().openFile;

function page(id: string): FileItem {
  return {
    id,
    name: `${id}.md`,
    content: id,
    isFolder: false,
    parentId: null,
    position: 0,
    isFavorite: false,
    createdAt: now,
    updatedAt: now,
    wordCount: 1,
    preview: id,
  };
}

describe("guarded editor navigation", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/editor/page-a");
    useFileStore.setState({
      files: [page("page-a"), page("page-b")],
      currentFileId: "page-a",
      openTabIds: ["page-a"],
      rootPath: "/workspace",
      openFile: originalOpenFile,
    });
    useEditorStore.setState({ isDirty: true });
    useEditorRefStore.setState({ requestSave: null });
  });

  it("updates selection and URL only after the dirty Page saves", async () => {
    const requestSave = vi.fn().mockResolvedValue(true);
    useEditorRefStore.setState({ requestSave });

    await expect(navigateToEditorFile("page-b")).resolves.toBe(true);

    expect(requestSave).toHaveBeenCalledOnce();
    expect(useFileStore.getState().currentFileId).toBe("page-b");
    expect(window.location.pathname).toBe("/editor/page-b");
  });

  it("keeps selection and URL when the pre-navigation save fails", async () => {
    useEditorRefStore.setState({
      requestSave: vi.fn().mockRejectedValue(new Error("disk full")),
    });

    await expect(navigateToEditorFile("page-b")).resolves.toBe(false);

    expect(useFileStore.getState().currentFileId).toBe("page-a");
    expect(window.location.pathname).toBe("/editor/page-a");
  });

  it("matches a rebuilt-index Page by path when its in-memory id is stale", async () => {
    useEditorStore.setState({ isDirty: false });
    useFileStore.setState({
      files: [
        page("page-a"),
        {
          ...page("path:Notes/Source.md"),
          storageHandle: {
            mode: "disk",
            id: "path:Notes/Source.md",
            kind: "document",
            documentType: "markdown",
            path: "Notes/Source.md",
            relPath: "Notes/Source.md",
          },
        },
      ],
    });

    await expect(navigateToWorkspacePage("new-frontmatter-id", "notes/source.md")).resolves.toBe(
      true
    );

    expect(useFileStore.getState().currentFileId).toBe("path:Notes/Source.md");
  });

  it("opens a scanned Page by absolute path when a standalone file store has not listed it", async () => {
    useEditorStore.setState({ isDirty: false });
    const openFile = vi.fn().mockResolvedValue(undefined);
    useFileStore.setState({ files: [page("page-a")], openFile });

    await expect(navigateToWorkspacePage("path:Notes/Source.md", "Notes/Source.md")).resolves.toBe(
      true
    );

    expect(openFile).toHaveBeenCalledWith("/workspace/Notes/Source.md");
  });

  it("refuses an indexed path that could escape the workspace", async () => {
    useEditorStore.setState({ isDirty: false });
    const openFile = vi.fn().mockResolvedValue(undefined);
    useFileStore.setState({ files: [page("page-a")], openFile });

    await expect(navigateToWorkspacePage("outside", "../Outside.md")).resolves.toBe(false);
    expect(openFile).not.toHaveBeenCalled();
  });
});
