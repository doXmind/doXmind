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
        editorHtml: html,
        browsingHtml: '<h1 id="hello">Hello</h1>',
        markdown,
        meta: { id: "doc-1", title: "Doc", created: now, updated: now },
        extras: { databases: {} },
        source: "sidecar",
        sourceState: "sidecar_fresh",
        outline: [{ id: "hello", depth: 1, text: "Hello" }],
        browsingRendererVersion: "browsing-html/v1",
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  });
}

describe("useFileStore disk workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/editor");
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

  it("shows the on-disk filename in the tree, not a diverging frontmatter title", async () => {
    // Regression: the tree must follow the filename the user renames. Preferring
    // the frontmatter `title` made renames silently revert to a stale title
    // (e.g. "Untitled-N"), since rename moves the file but never rewrites it.
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "workspace_scan") {
        return {
          root: "/workspace",
          documents: [
            {
              id: "doc-1",
              idSource: "frontmatter",
              path: "Report.md",
              name: "Report.md",
              title: "Untitled-1",
              hasSidecar: true,
            },
          ],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await useFileStore.getState().loadFiles();

    expect(useFileStore.getState().getFile("doc-1")?.name).toBe("Report");
  });

  it("keeps the folder workspace and recent entry when refreshing the current folder", async () => {
    useFileStore.setState({
      openTarget: "folder",
      rootPath: "/workspace",
      currentFileId: "doc-1",
      recents: [{ kind: "folder", path: "/workspace" }],
      loadedContentIds: new Set(["doc-1"]),
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "workspace_scan") {
        return {
          root: "/workspace",
          documents: [
            {
              id: "doc-2",
              idSource: "frontmatter",
              path: "Fresh.md",
              name: "Fresh.md",
              title: "Fresh",
              hasSidecar: true,
            },
          ],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await useFileStore.getState().loadFiles();

    const state = useFileStore.getState();
    expect(state.openTarget).toBe("folder");
    expect(state.rootPath).toBe("/workspace");
    expect(state.recents).toContainEqual({ kind: "folder", path: "/workspace" });
    expect(state.files.map((file) => file.id)).toEqual(["doc-2"]);
    expect(state.currentFileId).toBeNull();
  });

  it("removes a stale recent folder and returns home when the workspace root is missing", async () => {
    useFileStore.setState({
      openTarget: "folder",
      rootPath: "/missing-workspace",
      files: [
        {
          id: "doc-1",
          name: "Doc.md",
          content: "",
          isFolder: false,
          parentId: null,
          position: 0,
          isFavorite: false,
          createdAt: now,
          updatedAt: now,
          wordCount: 0,
          preview: "",
          storageHandle: { mode: "disk", id: "doc-1", kind: "document", relPath: "Doc.md" },
        },
      ],
      currentFileId: "doc-1",
      recents: [
        { kind: "folder", path: "/missing-workspace" },
        { kind: "folder", path: "/workspace" },
      ],
      isSynced: false,
    });
    window.history.replaceState({}, "", "/editor/doc-1?folder=%2Fmissing-workspace");
    invokeMock.mockRejectedValue(new Error("tauri unavailable in tests"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ detail: "workspace root is not a directory: /missing-workspace" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
    );

    try {
      await useFileStore.getState().loadFiles();

      const state = useFileStore.getState();
      expect(state.openTarget).toBe("none");
      expect(state.rootPath).toBeNull();
      expect(state.currentFileId).toBeNull();
      expect(state.files).toEqual([]);
      expect(state.recents).toEqual([{ kind: "folder", path: "/workspace" }]);
      expect(window.location.pathname + window.location.search).toBe("/editor");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("records the opened folder in the URL query so a webview refresh restores it", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "workspace_scan") {
        return { root: "/workspace", documents: [] };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await useFileStore.getState().openFolder("/workspace");

    expect(window.location.pathname + window.location.search).toBe("/editor?folder=%2Fworkspace");
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
    expect(file?.editorHtml).toBe("<p>Hello</p>");
    expect(file?.browsingHtml).toBe('<h1 id="hello">Hello</h1>');
    expect(file?.contentMarkdown).toBe("Hello");
    expect(file?.sourceState).toBe("sidecar_fresh");
    expect(file?.outline).toEqual([{ id: "hello", depth: 1, text: "Hello" }]);
    expect(file?.browsingRendererVersion).toBe("browsing-html/v1");
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

  it("creates a blank Excel workbook as binary via doc_create_excel", async () => {
    invokeMock.mockImplementation(async (command: string, payload: Record<string, unknown>) => {
      if (command === "doc_create_excel") {
        expect(payload.path).toBe("Untitled.xlsx");
        expect(Array.isArray(payload.bytes)).toBe(true);
        expect((payload.bytes as number[]).slice(0, 4)).toEqual([0x50, 0x4b, 0x03, 0x04]);
        return {
          id: "doc-excel",
          idSource: "path",
          path: "Untitled.xlsx",
          name: "Untitled.xlsx",
          title: "Untitled",
          documentType: "excel",
          hasSidecar: false,
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const id = await useFileStore
      .getState()
      .createFile("Untitled.xlsx", "", null, { documentType: "excel" });

    expect(id).toBe("doc-excel");
    expect(useFileStore.getState().currentFileId).toBe("doc-excel");
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

  it("keeps the new filename after rename even when the returned title is stale", async () => {
    // Renaming a doc moves the file but never rewrites its frontmatter `title`,
    // so doc_rename returns the *old* title. The tree must reflect the new
    // filename, otherwise the name snaps back to "Untitled-N" after Enter.
    useFileStore.setState({
      files: [
        {
          id: "doc-1",
          name: "Untitled-1",
          content: "",
          isFolder: false,
          parentId: null,
          position: 0,
          isFavorite: false,
          createdAt: now,
          updatedAt: now,
          wordCount: 0,
          preview: "",
          storageHandle: { mode: "disk", id: "doc-1", kind: "document", relPath: "Untitled-1.md" },
        },
      ],
    });
    invokeMock.mockImplementation(async (command: string, payload: Record<string, unknown>) => {
      if (command === "doc_rename") {
        expect(payload).toMatchObject({
          root: "/workspace",
          oldPath: "Untitled-1.md",
          newPath: "Report.md",
        });
        return {
          id: "doc-1",
          idSource: "frontmatter",
          path: "Report.md",
          name: "Report.md",
          title: "Untitled-1", // stale: rename leaves frontmatter untouched
          hasSidecar: true,
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await useFileStore.getState().renameFile("doc-1", "Report.md");

    expect(useFileStore.getState().getFile("doc-1")?.name).toBe("Report");
  });

  it("keeps the .pdf extension and carries selection when renaming a PDF", async () => {
    // A PDF's display name has no extension, so the rename can arrive defaulted
    // to ".md". The adapter must restore the real ".pdf", and the active
    // selection must follow the new path-derived id.
    useFileStore.setState({
      currentFileId: "pdf-old",
      loadedContentIds: new Set(["pdf-old"]),
      files: [
        {
          id: "pdf-old",
          name: "Spec",
          content: "",
          isFolder: false,
          parentId: null,
          position: 0,
          isFavorite: false,
          createdAt: now,
          updatedAt: now,
          wordCount: 0,
          preview: "",
          documentType: "pdf",
          storageHandle: {
            mode: "disk",
            id: "pdf-old",
            kind: "document",
            relPath: "Spec.pdf",
            documentType: "pdf",
          },
        },
      ],
    });
    invokeMock.mockImplementation(async (command: string, payload: Record<string, unknown>) => {
      if (command === "doc_rename") {
        expect(payload).toMatchObject({
          root: "/workspace",
          oldPath: "Spec.pdf",
          newPath: "Report.pdf", // ".md" default restored to ".pdf"
        });
        return {
          id: "pdf-new",
          idSource: "path",
          path: "Report.pdf",
          name: "Report.pdf",
          title: "Report",
          documentType: "pdf",
          hasSidecar: true,
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    // The sidebar hands the store a ".md"-defaulted name; the adapter corrects it.
    await useFileStore.getState().renameFile("pdf-old", "Report.md");

    const state = useFileStore.getState();
    expect(state.getFile("pdf-new")?.name).toBe("Report");
    expect(state.getFile("pdf-old")).toBeUndefined();
    expect(state.currentFileId).toBe("pdf-new");
    expect(state.loadedContentIds.has("pdf-new")).toBe(true);
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
