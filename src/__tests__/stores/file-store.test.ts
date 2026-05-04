import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { useFileStore } from "@/stores/file-store";

const now = "2026-04-30T00:00:00.000Z";

function resetStore() {
  useFileStore.setState({
    files: [],
    currentFileId: null,
    currentFolderId: null,
    openTarget: "folder",
    rootPath: "/workspace",
    openFilePath: null,
    recents: [],
    isLoading: false,
    isSynced: false,
    justCreatedFileId: null,
    expandedFolderIds: new Set(),
    selectedFileIds: new Set(),
    loadedContentIds: new Set(),
  });
}

function mockRead(path = "Doc.md", html = "<p>Hello</p>", markdown = "Hello") {
  invokeMock.mockImplementation(async (command: string, payload: Record<string, unknown>) => {
    if (command === "doc_read") {
      expect(payload).toEqual({ path: `/workspace/${path}` });
      return {
        html,
        markdown,
        meta: { id: "doc-1", title: "Doc", created: now, updated: now },
        extras: { databases: {} },
        source: "sidecar",
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  });
}

describe("useFileStore disk workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("loads files from the disk workspace scan", async () => {
    invokeMock.mockImplementation(async (command: string, payload: Record<string, unknown>) => {
      if (command === "workspace_scan") {
        expect(payload).toEqual({ root: "/workspace" });
        return {
          root: "/workspace",
          documents: [
            {
              id: "doc-1",
              idSource: "frontmatter",
              path: "Folder/Doc.md",
              name: "Doc.md",
              title: "Doc",
              hasSidecar: true,
            },
          ],
        };
      }
      if (command === "workspace_index_rebuild") {
        return { version: 1, ids: { "doc-1": "Folder/Doc.md" } };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await useFileStore.getState().loadFiles();

    const state = useFileStore.getState();
    expect(state.isSynced).toBe(true);
    expect(state.files.map((file) => [file.id, file.name, file.isFolder])).toEqual([
      ["folder:Folder", "Folder", true],
      ["doc-1", "Doc", false],
    ]);
  });

  it("loads document content from the sidecar reader", async () => {
    useFileStore.setState({
      files: [
        {
          id: "doc-1",
          name: "Doc.md",
          content: "",
          isFolder: false,
          parentId: null,
          position: 0,
          isFavorite: false,
          icon: null,
          coverImageUrl: null,
          coverPosition: 0.5,
          createdAt: now,
          updatedAt: now,
          wordCount: 0,
          preview: "",
          storageHandle: { mode: "disk", id: "doc-1", kind: "document", relPath: "Doc.md" },
        },
      ],
    });
    mockRead();

    await useFileStore.getState().loadFileContent("doc-1");

    const file = useFileStore.getState().getFile("doc-1");
    expect(file?.content).toBe("<p>Hello</p>");
    expect(file?.contentMarkdown).toBe("Hello");
    expect(useFileStore.getState().loadedContentIds.has("doc-1")).toBe(true);
  });

  it("creates a new local markdown document", async () => {
    invokeMock.mockImplementation(async (command: string, payload: Record<string, unknown>) => {
      if (command === "doc_create") {
        expect(payload).toMatchObject({
          root: "/workspace",
          payload: {
            path: "New Note.md",
            html: "<p>Draft</p>",
            markdown: "",
          },
        });
        return {
          id: "doc-new",
          idSource: "frontmatter",
          path: "New Note.md",
          name: "New Note.md",
          title: "New Note",
          hasSidecar: true,
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const id = await useFileStore.getState().createFile("New Note", "<p>Draft</p>");

    expect(id).toBe("doc-new");
    expect(useFileStore.getState().currentFileId).toBe("doc-new");
    expect(useFileStore.getState().getFile("doc-new")?.content).toBe("<p>Draft</p>");
  });

  it("creates a blank PDF as binary via doc_create_pdf", async () => {
    invokeMock.mockImplementation(async (command: string, payload: Record<string, unknown>) => {
      if (command === "doc_create_pdf") {
        // Sanity-check the payload shape: bytes are passed as a JSON-safe
        // number array, and the path keeps its `.pdf` extension.
        expect(payload.path).toBe("Untitled.pdf");
        expect(Array.isArray(payload.bytes)).toBe(true);
        expect((payload.bytes as number[]).length).toBeGreaterThan(0);
        return {
          id: "doc-pdf",
          idSource: "path",
          path: "Untitled.pdf",
          name: "Untitled.pdf",
          title: "Untitled",
          documentType: "pdf",
          hasSidecar: false,
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const id = await useFileStore
      .getState()
      .createFile("Untitled.pdf", "", null, { documentType: "pdf" });

    expect(id).toBe("doc-pdf");
    expect(useFileStore.getState().currentFileId).toBe("doc-pdf");
  });

  it("writes content updates through doc_write_workspace", async () => {
    useFileStore.setState({
      files: [
        {
          id: "doc-1",
          name: "Doc.md",
          content: "<p>Old</p>",
          isFolder: false,
          parentId: null,
          position: 0,
          isFavorite: false,
          icon: null,
          coverImageUrl: null,
          coverPosition: 0.5,
          createdAt: now,
          updatedAt: now,
          wordCount: 0,
          preview: "",
          storageHandle: { mode: "disk", id: "doc-1", kind: "document", relPath: "Doc.md" },
        },
      ],
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "doc_read") {
        return {
          html: "<p>Old</p>",
          markdown: "Old",
          meta: { id: "doc-1", title: "Doc", updated: now },
          extras: { databases: {} },
          source: "sidecar",
        };
      }
      if (command === "doc_write_workspace") return undefined;
      throw new Error(`Unexpected command: ${command}`);
    });

    await useFileStore
      .getState()
      .updateFile("doc-1", { content: "<p>New</p>", contentMarkdown: "New" });

    expect(invokeMock).toHaveBeenCalledWith(
      "doc_write_workspace",
      expect.objectContaining({
        root: "/workspace",
        path: "Doc.md",
        payload: expect.objectContaining({ html: "<p>New</p>", markdown: "New" }),
      })
    );
  });

  it("deletes documents through workspace delete commands", async () => {
    useFileStore.setState({
      files: [
        {
          id: "doc-1",
          name: "Doc.md",
          content: "",
          isFolder: false,
          parentId: null,
          position: 0,
          isFavorite: false,
          icon: null,
          coverImageUrl: null,
          coverPosition: 0.5,
          createdAt: now,
          updatedAt: now,
          wordCount: 0,
          preview: "",
          storageHandle: { mode: "disk", id: "doc-1", kind: "document", relPath: "Doc.md" },
        },
      ],
    });
    invokeMock.mockResolvedValueOnce({
      path: "Doc.md",
      sidecarPath: null,
    });

    await useFileStore.getState().deleteFile("doc-1");

    expect(invokeMock).toHaveBeenCalledWith("doc_delete", { root: "/workspace", path: "Doc.md" });
    expect(useFileStore.getState().files).toHaveLength(0);
  });

  it("preserves the original delete error if reverting with loadFiles also throws", async () => {
    const originalLoadFiles = useFileStore.getState().loadFiles;
    const deleteError = new Error("delete failed");
    const loadFilesError = new Error("loadFiles failed");
    const loadFilesMock = vi.fn().mockRejectedValue(loadFilesError);

    useFileStore.setState({
      files: [
        {
          id: "doc-1",
          name: "Doc.md",
          content: "",
          isFolder: false,
          parentId: null,
          position: 0,
          isFavorite: false,
          icon: null,
          coverImageUrl: null,
          coverPosition: 0.5,
          createdAt: now,
          updatedAt: now,
          wordCount: 0,
          preview: "",
          storageHandle: { mode: "disk", id: "doc-1", kind: "document", relPath: "Doc.md" },
        },
      ],
      loadFiles: loadFilesMock,
    });
    const fetchMock = vi.fn().mockRejectedValue(deleteError);
    vi.stubGlobal("fetch", fetchMock);
    invokeMock.mockRejectedValueOnce(new Error("tauri unavailable"));

    try {
      await expect(useFileStore.getState().deleteFile("doc-1")).rejects.toBe(deleteError);
      expect(loadFilesMock).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      useFileStore.setState({ loadFiles: originalLoadFiles });
      vi.unstubAllGlobals();
    }
  });
});
