import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyPageMarkdownSource, defaultMarkdownCopyName } from "@/lib/markdown-source-copy";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useEditorStore } from "@/stores/editor-store";
import { useFileStore } from "@/stores/file-store";
import type { FileItem } from "@/types";

const { invokeMock, pickNativeSaveLocationMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  pickNativeSaveLocationMock: vi.fn(),
}));

vi.mock("@/lib/native-dialog", () => ({
  pickNativeSaveLocation: pickNativeSaveLocationMock,
}));

const page: FileItem = {
  id: "path:Plan.md",
  name: "Plan.md",
  content: "# Plan\n",
  isFolder: false,
  parentId: null,
  position: 0,
  isFavorite: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  wordCount: 1,
  preview: "Plan",
  documentType: "markdown",
  storageHandle: {
    mode: "disk",
    id: "path:Plan.md",
    kind: "document",
    documentType: "markdown",
    path: "Plan.md",
    relPath: "Plan.md",
  },
};

describe("Markdown source copy", () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ path: "/copies/Plan copy.md", bytes: 7 });
    pickNativeSaveLocationMock.mockReset();
    pickNativeSaveLocationMock.mockResolvedValue("/copies/Plan copy.md");
    vi.stubGlobal("__DOXMIND_DESKTOP__", {
      platform: "macos",
      invoke: invokeMock,
      listen: vi.fn(() => vi.fn()),
      getPathForFile: vi.fn(() => null),
    });
    useFileStore.setState({
      files: [page],
      currentFileId: page.id,
      openTabIds: [page.id],
      openTarget: "folder",
      rootPath: "/vault",
      transientFile: null,
    });
    useEditorStore.setState({ isDirty: false });
    useEditorRefStore.setState({ requestSave: null });
  });

  it("preserves either portable Markdown extension", () => {
    expect(defaultMarkdownCopyName("Plan.md")).toBe("Plan copy.md");
    expect(defaultMarkdownCopyName("Plan.markdown")).toBe("Plan copy.markdown");
    expect(defaultMarkdownCopyName("PLAN.MD")).toBe("PLAN copy.MD");
  });

  it("adds a Markdown extension defensively", () => {
    expect(defaultMarkdownCopyName("Plan")).toBe("Plan copy.md");
  });

  it("flushes the active Page before copying its complete disk source", async () => {
    const requestSave = vi.fn().mockResolvedValue(true);
    useEditorRefStore.setState({ requestSave });

    await copyPageMarkdownSource(page.id, "Copy source");

    expect(requestSave).toHaveBeenCalledOnce();
    expect(pickNativeSaveLocationMock).toHaveBeenCalledWith("Copy source", "Plan copy.md", [
      { name: "Markdown", extensions: ["md", "markdown"] },
    ]);
    expect(invokeMock).toHaveBeenCalledWith("doc_copy_source", {
      root: "/vault",
      path: "Plan.md",
      destination: "/copies/Plan copy.md",
    });
  });

  it("does not copy when saving the active Page is cancelled", async () => {
    useEditorRefStore.setState({ requestSave: vi.fn().mockResolvedValue(false) });

    await expect(copyPageMarkdownSource(page.id)).resolves.toBeNull();

    expect(pickNativeSaveLocationMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("resolves the real disk Page after a transient buffer is first saved", async () => {
    const transientId = "transient-1";
    const transientPage = { ...page, id: transientId, storageHandle: undefined };
    useFileStore.setState({
      files: [transientPage],
      currentFileId: transientId,
      rootPath: null,
      transientFile: {
        id: transientId,
        name: "Plan.md",
        content: "# Plan\n",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
    useEditorRefStore.setState({
      requestSave: vi.fn(async () => {
        useFileStore.setState({
          files: [page],
          currentFileId: page.id,
          rootPath: "/vault",
          transientFile: null,
        });
        return true;
      }),
    });

    await copyPageMarkdownSource(transientId);

    expect(invokeMock).toHaveBeenCalledWith(
      "doc_copy_source",
      expect.objectContaining({ root: "/vault", path: "Plan.md" })
    );
  });
});
