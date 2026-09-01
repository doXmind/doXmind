import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

import { useFileStore } from "@/stores/file-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useEditorStore } from "@/stores/editor-store";
import { resolveWikiLinkTarget } from "@/editor/markdown-block/wiki-link";

const now = "2026-04-30T00:00:00.000Z";

function resetStore() {
  useFileStore.setState({
    files: [],
    currentFileId: null,
    openTabIds: [],
    currentFolderId: null,
    openTarget: "folder",
    rootPath: "/workspace",
    openFilePath: null,
    transientFile: null,
    recents: [],
    isLoading: false,
    isSynced: false,
    justCreatedFileId: null,
    expandedFolderIds: new Set(),
    selectedFileIds: new Set(),
    loadedContentIds: new Set(),
  });
}

function markdownFile(id: string, name: string) {
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
    documentType: "markdown" as const,
    storageHandle: { mode: "disk" as const, id, kind: "document" as const, relPath: name },
  };
}

function folderItem(id: string, name: string, relPath: string, parentId: string | null = null) {
  return {
    ...markdownFile(id, name),
    isFolder: true,
    parentId,
    documentType: undefined,
    storageHandle: {
      mode: "disk" as const,
      id,
      kind: "folder" as const,
      path: relPath,
      relPath,
    },
  };
}

function markdownFileAt(id: string, name: string, relPath: string, parentId: string | null = null) {
  return {
    ...markdownFile(id, name),
    parentId,
    storageHandle: {
      mode: "disk" as const,
      id,
      kind: "document" as const,
      documentType: "markdown" as const,
      path: relPath,
      relPath,
    },
  };
}

function mockRead(path = "Doc.md", markdown = "Hello") {
  invokeMock.mockImplementation(async (command: string, payload: Record<string, unknown>) => {
    if (command === "doc_read") {
      expect(payload).toEqual({ root: "/workspace", path });
      return {
        html: "<p>legacy wire field</p>",
        editorHtml: "<p>legacy wire field</p>",
        browsingHtml: '<h1 id="hello">Hello</h1>',
        markdown,
        meta: {
          id: "doc-1",
          title: "Doc",
          tags: ["local"],
          aliases: ["Home"],
          created: now,
          updated: now,
        },
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
    vi.stubGlobal("__DOXMIND_DESKTOP__", {
      platform: "macos",
      invoke: invokeMock,
      listen: vi.fn(() => vi.fn()),
      getPathForFile: vi.fn(() => null),
    });
    window.history.replaceState({}, "", "/editor");
    resetStore();
    useEditorStore.setState({ isDirty: false, isSaving: false });
    useEditorRefStore.setState({ requestSave: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists real folders and workspace files, and refuses to open one in an editor", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "workspace_scan") {
        return {
          root: "/workspace",
          documents: [{ id: "doc-1", idSource: "frontmatter", path: "Note.md", name: "Note.md" }],
          // An empty folder is reported directly now; inferring folders from document paths
          // dropped it from the tree while it was still on disk.
          folders: [{ path: "Empty" }, { path: "assets" }],
          assets: [
            { path: "assets/diagram.png", name: "diagram.png" },
            { path: "Board.canvas", name: "Board.canvas" },
          ],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await useFileStore.getState().loadFiles();
    const state = useFileStore.getState();

    // Folders, then Pages, then workspace files — within one parent, by name.
    expect(state.files.map((file) => [file.id, file.name, file.isFolder, !!file.isAsset])).toEqual([
      ["folder:assets", "assets", true, false],
      ["folder:Empty", "Empty", true, false],
      ["doc-1", "Note", false, false],
      ["asset:Board.canvas", "Board.canvas", false, true],
      ["asset:assets/diagram.png", "diagram.png", false, true],
    ]);

    // The asset keeps its extension, unlike a Page, because a file tree shows the real filename.
    expect(state.files.find((file) => file.id === "asset:assets/diagram.png")?.name).toBe(
      "diagram.png"
    );

    // The single choke point: no surface can turn a workspace file into an editor tab.
    await expect(useFileStore.getState().requestCurrentFile("asset:Board.canvas")).resolves.toBe(
      false
    );
    expect(useFileStore.getState().currentFileId).toBe(null);
    expect(useFileStore.getState().openTabIds).toEqual([]);
  });

  it("drops a Page the rescan no longer sees out of the split", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "workspace_scan") {
        return {
          root: "/workspace",
          documents: [{ id: "doc-1", idSource: "frontmatter", path: "Kept.md", name: "Kept.md" }],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    // A split whose other pane holds a Page that is about to disappear from disk.
    useFileStore.setState({
      currentFileId: "doc-1",
      otherPaneFileId: "gone",
      openTabIds: ["doc-1", "gone"],
    });

    await useFileStore.getState().loadFiles();

    expect(useFileStore.getState().otherPaneFileId).toBeNull();
    expect(useFileStore.getState().openTabIds).toEqual(["doc-1"]);
  });

  it("keeps today's tree when the scan reports no folders or assets", async () => {
    // The browser-development FastAPI scan omits both keys, and must keep working untouched.
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "workspace_scan") {
        return {
          root: "/workspace",
          documents: [
            { id: "doc-1", idSource: "frontmatter", path: "Folder/Doc.md", name: "Doc.md" },
          ],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await useFileStore.getState().loadFiles();

    expect(useFileStore.getState().files.map((file) => [file.id, file.name])).toEqual([
      ["folder:Folder", "Folder"],
      ["doc-1", "Doc"],
    ]);
  });

  it("loads files from the disk workspace scan", async () => {
    invokeMock.mockImplementation(async (command: string, payload: Record<string, unknown>) => {
      if (command === "workspace_scan") {
        expect(payload).toEqual({ root: "/workspace", excludeDirs: [] });
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
      openTabIds: ["doc-1"],
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
    expect(state.openTabIds).toEqual([]);
  });

  it("keeps the active file selected when a rescan changes its id but not its path", async () => {
    useFileStore.setState({
      openTarget: "folder",
      rootPath: "/workspace",
      files: [
        {
          ...markdownFile("doc-old", "Doc.md"),
          content: "Draft",
          storageHandle: {
            mode: "disk",
            id: "doc-old",
            kind: "document",
            path: "Doc.md",
            relPath: "Doc.md",
          },
        },
        {
          ...markdownFile("doc-other", "Other.md"),
          storageHandle: {
            mode: "disk",
            id: "doc-other",
            kind: "document",
            path: "Other.md",
            relPath: "Other.md",
          },
        },
      ],
      currentFileId: "doc-old",
      openTabIds: ["doc-old", "doc-other"],
      loadedContentIds: new Set(["doc-old"]),
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "workspace_scan") {
        return {
          root: "/workspace",
          documents: [
            {
              id: "doc-new",
              idSource: "sidecar",
              path: "Doc.md",
              name: "Doc.md",
              title: "Doc",
              hasSidecar: true,
            },
            {
              id: "doc-other",
              idSource: "frontmatter",
              path: "Other.md",
              name: "Other.md",
              title: "Other",
              hasSidecar: true,
            },
          ],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await useFileStore.getState().loadFiles({ silent: true });

    const state = useFileStore.getState();
    expect(state.currentFileId).toBe("doc-new");
    expect(state.openTabIds).toEqual(["doc-new", "doc-other"]);
    expect(state.loadedContentIds.has("doc-new")).toBe(true);
    expect(state.getFile("doc-new")?.content).toBe("Draft");
  });

  it("adds workspace files to the open tab list as they become current", () => {
    useFileStore.setState({
      files: [markdownFile("doc-1", "One.md"), markdownFile("doc-2", "Two.md")],
      currentFileId: null,
      openTabIds: [],
    });

    useFileStore.getState().setCurrentFile("doc-1");
    useFileStore.getState().setCurrentFile("doc-2");
    useFileStore.getState().setCurrentFile("doc-1");

    const state = useFileStore.getState();
    expect(state.currentFileId).toBe("doc-1");
    expect(state.openTabIds).toEqual(["doc-1", "doc-2"]);
  });

  it("selects the neighboring tab when closing the active tab", () => {
    useFileStore.setState({
      files: [
        markdownFile("doc-1", "One.md"),
        markdownFile("doc-2", "Two.md"),
        markdownFile("doc-3", "Three.md"),
      ],
      currentFileId: "doc-2",
      openTabIds: ["doc-1", "doc-2", "doc-3"],
    });

    useFileStore.getState().closeTab("doc-2");

    const state = useFileStore.getState();
    expect(state.currentFileId).toBe("doc-3");
    expect(state.openTabIds).toEqual(["doc-1", "doc-3"]);
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
    vi.stubGlobal("__DOXMIND_DESKTOP__", undefined);
    invokeMock.mockRejectedValue(new Error("desktop unavailable in tests"));
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

  it("keeps the workspace open when a child vanishes mid-scan", async () => {
    // A concurrent `rm -rf` inside the workspace makes the scan throw ENOENT for
    // an inner path while the root itself is still there. Treating that as a
    // missing root closed the workspace, dropped its recent entry, and unmounted
    // the editor with its pending autosave.
    useFileStore.setState({
      openTarget: "folder",
      rootPath: "/workspace",
      files: [markdownFile("doc-1", "Journal.md")],
      currentFileId: "doc-1",
      openTabIds: ["doc-1"],
      loadedContentIds: new Set(["doc-1"]),
      recents: [{ kind: "folder", path: "/workspace" }],
      isSynced: true,
    });
    window.history.replaceState({}, "", "/editor/doc-1?folder=%2Fworkspace");
    invokeMock.mockRejectedValue(
      new Error(
        "Error invoking remote method 'shell:invoke': Error: ENOENT: no such file or directory, scandir '/workspace/Archive'"
      )
    );

    await useFileStore.getState().loadFiles({ silent: true });

    const state = useFileStore.getState();
    expect(state.openTarget).toBe("folder");
    expect(state.rootPath).toBe("/workspace");
    expect(state.files.map((file) => file.id)).toEqual(["doc-1"]);
    expect(state.currentFileId).toBe("doc-1");
    expect(state.loadedContentIds).toEqual(new Set(["doc-1"]));
    expect(state.recents).toEqual([{ kind: "folder", path: "/workspace" }]);
    expect(state.isSynced).toBe(false);
    expect(window.location.pathname + window.location.search).toBe(
      "/editor/doc-1?folder=%2Fworkspace"
    );
  });

  /*
   * A scanned Page carries enough to resolve a Wiki Link to it.
   *
   * Resolution runs over the whole workspace, not the open Page, and it reads `meta.aliases`. The
   * scan used to drop them on the floor, so `[[Alias]]` could only ever resolve to a Page the
   * session had already opened — in a fresh window every alias link was dead and clicking one did
   * nothing at all.
   */
  it("keeps a scanned Page's aliases, so an alias Wiki Link resolves before it is opened", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "workspace_scan") {
        return {
          root: "/workspace",
          documents: [
            {
              id: "roadmap",
              idSource: "frontmatter",
              path: "Notes/Roadmap.md",
              name: "Roadmap.md",
              title: "Roadmap",
              documentType: "markdown",
              aliases: ["Plan"],
            },
            {
              id: "doc",
              idSource: "path",
              path: "Doc.md",
              name: "Doc.md",
              title: "Doc",
              documentType: "markdown",
            },
          ],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await useFileStore.getState().openFolder("/workspace");

    const files = useFileStore.getState().files;
    expect(files.find((file) => file.id === "roadmap")?.meta?.aliases).toEqual(["Plan"]);
    expect(resolveWikiLinkTarget(files, "doc", "Plan")?.id).toBe("roadmap");
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

  it("loads Page content while discarding injected legacy wire state", async () => {
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
    expect(file?.content).toBe("Hello");
    expect(file?.meta).toMatchObject({ tags: ["local"], aliases: ["Home"] });
    expect(file?.outline).toEqual([{ id: "hello", depth: 1, text: "Hello" }]);
    expect(Object.keys(file ?? {})).not.toEqual(
      expect.arrayContaining([
        "editorHtml",
        "browsingHtml",
        "contentMarkdown",
        "sourceState",
        "browsingRendererVersion",
      ])
    );
    expect(useFileStore.getState().loadedContentIds.has("doc-1")).toBe(true);
  });

  it("marks HTML attachments loaded without reading them as Pages", async () => {
    useFileStore.setState({
      files: [
        {
          ...markdownFile("path:reference", "reference.html"),
          documentType: "html",
          storageHandle: {
            mode: "disk",
            id: "path:reference",
            kind: "document",
            documentType: "html",
            relPath: "reference.html",
          },
        },
      ],
    });

    await useFileStore.getState().loadFileContent("path:reference");

    expect(invokeMock).not.toHaveBeenCalledWith("doc_read", expect.anything());
    expect(useFileStore.getState().loadedContentIds.has("path:reference")).toBe(true);
  });

  it("opens a loose HTML attachment without reading it as a Page", async () => {
    await useFileStore.getState().openFile("/workspace/reference.html");

    const state = useFileStore.getState();
    expect(invokeMock).not.toHaveBeenCalledWith("doc_read", expect.anything());
    expect(state.openTarget).toBe("file");
    expect(state.rootPath).toBe("/workspace");
    expect(state.files).toHaveLength(1);
    expect(state.files[0]).toMatchObject({
      name: "reference.html",
      documentType: "html",
      content: "",
    });
  });

  it("creates a new local Page from canonical Markdown without dropping template content", async () => {
    invokeMock.mockImplementation(async (command: string, payload: Record<string, unknown>) => {
      if (command === "doc_create") {
        expect(payload).toMatchObject({
          root: "/workspace",
          payload: {
            path: "New Note.md",
            markdown: "# Draft",
            meta: { status: "draft" },
          },
        });
        expect((payload.payload as Record<string, unknown>).html).toBeUndefined();
        return {
          id: "doc-new",
          idSource: "frontmatter",
          path: "New Note.md",
          name: "New Note.md",
          title: "New Note",
          hasSidecar: false,
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const id = await useFileStore
      .getState()
      .createFile("New Note", "# Draft", null, { status: "draft" });

    expect(id).toBe("doc-new");
    expect(useFileStore.getState().currentFileId).toBe("doc-new");
    expect(useFileStore.getState().getFile("doc-new")?.content).toBe("# Draft");
  });

  it("keeps primary creation on the Markdown Page path for attachment-like names", async () => {
    invokeMock.mockImplementation(async (command: string, payload: Record<string, unknown>) => {
      if (command === "doc_create") {
        expect(payload).toMatchObject({
          root: "/workspace",
          payload: {
            path: "Untitled.pdf.md",
            markdown: "",
          },
        });
        expect((payload.payload as Record<string, unknown>).html).toBeUndefined();
        return {
          id: "page-new",
          idSource: "frontmatter",
          path: "Untitled.pdf.md",
          name: "Untitled.pdf.md",
          title: "Untitled.pdf",
          documentType: "markdown",
          hasSidecar: false,
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const id = await useFileStore.getState().createFile("Untitled.pdf");

    expect(id).toBe("page-new");
    expect(useFileStore.getState().currentFileId).toBe("page-new");
  });

  it("writes content updates through doc_write_workspace", async () => {
    useFileStore.setState({
      files: [
        {
          id: "doc-1",
          name: "Doc.md",
          content: "Old",
          sourceRevision: "sha256:old",
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
          markdown: "Old",
          meta: { id: "generated-by-backend", title: "Doc", updated: now },
          outline: [],
        };
      }
      if (command === "doc_write_workspace") {
        return {
          markdown: "New",
          revision: "sha256:new",
          meta: { id: "doc-1", title: "Doc", updated: now },
          outline: [],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await useFileStore.getState().updateFile("doc-1", { content: "New" });

    expect(invokeMock).toHaveBeenCalledWith(
      "doc_write_workspace",
      expect.objectContaining({
        root: "/workspace",
        path: "Doc.md",
        payload: expect.objectContaining({
          markdown: "New",
          expectedRevision: "sha256:old",
        }),
      })
    );
    const writePayload = invokeMock.mock.calls.find(
      ([command]) => command === "doc_write_workspace"
    )?.[1] as { payload: Record<string, unknown> };
    expect(writePayload.payload.html).toBeUndefined();
    expect(writePayload.payload.meta).toBeUndefined();
    expect(useFileStore.getState().getFile("doc-1")?.sourceRevision).toBe("sha256:new");
  });

  it("persists Page properties as a metadata-only revision-checked patch", async () => {
    useFileStore.setState({
      files: [
        {
          ...markdownFile("doc-1", "Doc.md"),
          content: "Body\n",
          sourceRevision: "sha256:old",
          meta: { id: "doc-1", tags: ["old"] },
        },
      ],
    });
    invokeMock.mockImplementation(async (command: string, payload: Record<string, unknown>) => {
      if (command !== "doc_write_workspace") throw new Error(`Unexpected command: ${command}`);
      expect(payload).toEqual({
        root: "/workspace",
        path: "Doc.md",
        payload: {
          meta: {
            tags: ["local", "markdown"],
            aliases: null,
            status: "doing",
            priority: 2,
            published: false,
          },
          expectedRevision: "sha256:old",
        },
      });
      return {
        markdown: "Body\n",
        revision: "sha256:properties",
        meta: {
          id: "doc-1",
          tags: ["local", "markdown"],
          status: "doing",
          priority: 2,
          published: false,
          updated: now,
        },
        outline: [],
      };
    });

    await useFileStore.getState().updatePageProperties("doc-1", {
      tags: ["local", "markdown"],
      aliases: null,
      status: "doing",
      priority: 2,
      published: false,
    });

    const saved = useFileStore.getState().getFile("doc-1");
    expect(saved?.content).toBe("Body\n");
    expect(saved?.meta?.tags).toEqual(["local", "markdown"]);
    expect(saved?.meta).toMatchObject({ status: "doing", priority: 2, published: false });
    expect(saved?.sourceRevision).toBe("sha256:properties");
  });

  it("leaves Page properties untouched when an external revision wins", async () => {
    const file = {
      ...markdownFile("doc-1", "Doc.md"),
      sourceRevision: "sha256:old",
      meta: { id: "doc-1", tags: ["old"] },
    };
    useFileStore.setState({ files: [file] });
    invokeMock.mockRejectedValue(new Error("page_revision_conflict"));

    await expect(
      useFileStore.getState().updatePageProperties("doc-1", { tags: ["new"] })
    ).rejects.toThrow("page_revision_conflict");

    expect(useFileStore.getState().getFile("doc-1")).toEqual(file);
  });

  it("promotes a no-frontmatter path identity after its first property write", async () => {
    const generatedId = "8e23b249-39bb-474d-93be-ea244dfe2c9d";
    const file = {
      ...markdownFile("path:external", "External.md"),
      sourceRevision: "sha256:old",
      meta: { id: "path:external" },
    };
    useFileStore.setState({
      files: [file],
      currentFileId: file.id,
      openTabIds: [file.id],
      loadedContentIds: new Set([file.id]),
      selectedFileIds: new Set([file.id]),
    });
    invokeMock.mockResolvedValue({
      markdown: "Body\n",
      revision: "sha256:properties",
      meta: { id: generatedId, tags: ["local"] },
      outline: [],
    });

    await useFileStore.getState().updatePageProperties(file.id, { tags: ["local"] });

    const state = useFileStore.getState();
    expect(state.getFile(generatedId)).toMatchObject({
      id: generatedId,
      meta: { id: generatedId, tags: ["local"] },
      storageHandle: { id: generatedId, relPath: "External.md" },
    });
    expect(state.getFile(file.id)).toBeUndefined();
    expect(state.currentFileId).toBe(generatedId);
    expect(state.openTabIds).toEqual([generatedId]);
    expect(state.loadedContentIds).toEqual(new Set([generatedId]));
    expect(state.selectedFileIds).toEqual(new Set([generatedId]));
  });

  it("keeps duplicate authored ids on their scan-resolved path identity", async () => {
    const file = {
      ...markdownFile("path:duplicate", "Copy.md"),
      sourceRevision: "sha256:old",
      meta: { id: "authored-duplicate", tags: ["old"] },
    };
    useFileStore.setState({ files: [file], currentFileId: file.id, openTabIds: [file.id] });
    invokeMock.mockResolvedValue({
      markdown: "Body\n",
      revision: "sha256:properties",
      meta: { id: "authored-duplicate", tags: ["new"] },
      outline: [],
    });

    await useFileStore.getState().updatePageProperties(file.id, { tags: ["new"] });

    expect(useFileStore.getState().currentFileId).toBe(file.id);
    expect(useFileStore.getState().getFile(file.id)?.meta?.id).toBe("authored-duplicate");
  });

  it("saves a dirty Page before switching files", async () => {
    let finishSave!: (saved: boolean) => void;
    const requestSave = vi.fn(() => new Promise<boolean>((resolve) => (finishSave = resolve)));
    useFileStore.setState({
      files: [markdownFile("page-a", "A.md"), markdownFile("page-b", "B.md")],
      currentFileId: "page-a",
      openTabIds: ["page-a"],
    });
    useEditorStore.setState({ isDirty: true });
    useEditorRefStore.setState({ requestSave });

    const switching = useFileStore.getState().requestCurrentFile("page-b");
    expect(useFileStore.getState().currentFileId).toBe("page-a");

    finishSave(true);
    await expect(switching).resolves.toBe(true);
    expect(useFileStore.getState().currentFileId).toBe("page-b");
    expect(requestSave).toHaveBeenCalledTimes(1);
  });

  it("keeps the current Page selected when the pre-switch save fails", async () => {
    useFileStore.setState({
      files: [markdownFile("page-a", "A.md"), markdownFile("page-b", "B.md")],
      currentFileId: "page-a",
      openTabIds: ["page-a"],
    });
    useEditorStore.setState({ isDirty: true });
    useEditorRefStore.setState({
      requestSave: vi.fn().mockRejectedValue(new Error("disk full")),
    });

    await expect(useFileStore.getState().requestCurrentFile("page-b")).resolves.toBe(false);
    expect(useFileStore.getState().currentFileId).toBe("page-a");
  });

  it("lets a newer navigation intent cancel an in-flight dirty switch", async () => {
    let finishSave!: (saved: boolean) => void;
    useFileStore.setState({
      files: [markdownFile("page-a", "A.md"), markdownFile("page-b", "B.md")],
      currentFileId: "page-a",
      openTabIds: ["page-a"],
    });
    useEditorStore.setState({ isDirty: true });
    useEditorRefStore.setState({
      requestSave: vi.fn(() => new Promise<boolean>((resolve) => (finishSave = resolve))),
    });

    const staleSwitch = useFileStore.getState().requestCurrentFile("page-b");
    await expect(useFileStore.getState().requestCurrentFile("page-a")).resolves.toBe(true);
    finishSave(true);

    await expect(staleSwitch).resolves.toBe(false);
    expect(useFileStore.getState().currentFileId).toBe("page-a");
  });

  it("commits the canonical Markdown returned after save", async () => {
    useFileStore.setState({
      files: [
        {
          id: "doc-1",
          name: "Doc.md",
          content: "Old",
          sourceRevision: "sha256:old",
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
      loadedContentIds: new Set(["doc-1"]),
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "doc_write_workspace") {
        return {
          markdown: "New normalized by backend",
          revision: "sha256:normalized",
          meta: { id: "doc-1", title: "Doc", updated: now },
          outline: [],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await useFileStore.getState().updateFile("doc-1", { content: "New" });

    const saved = useFileStore.getState().getFile("doc-1");
    expect(saved?.content).toBe("New normalized by backend");
    expect(saved?.id).toBe("doc-1");
    expect(saved?.storageHandle?.id).toBe("doc-1");
    expect(saved?.sourceRevision).toBe("sha256:normalized");
  });

  it("rejects an update when the Page write fails after optimistic rollback", async () => {
    const writeError = new Error("disk full");
    const originalFile = {
      ...markdownFile("doc-1", "Doc.md"),
      content: "Old\n",
      sourceRevision: "sha256:old",
      outline: [{ id: "old", depth: 1 as const, text: "Old" }],
    };
    useFileStore.setState({
      files: [originalFile],
      loadedContentIds: new Set(["doc-1"]),
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "doc_write_workspace") throw writeError;
      if (command === "workspace_scan") {
        return {
          root: "/workspace",
          documents: [
            {
              id: "doc-1",
              idSource: "frontmatter",
              path: "Doc.md",
              name: "Doc.md",
              documentType: "markdown",
              hasSidecar: false,
            },
          ],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(useFileStore.getState().updateFile("doc-1", { content: "New" })).rejects.toThrow();
    expect(useFileStore.getState().getFile("doc-1")).toEqual(originalFile);
    expect(useFileStore.getState().loadedContentIds.has("doc-1")).toBe(true);
  });

  it("keeps canonical Markdown when a forced reread sees the same saved source", async () => {
    useFileStore.setState({
      files: [
        {
          id: "doc-1",
          name: "Doc.md",
          content: "New",
          isFolder: false,
          parentId: null,
          position: 0,
          isFavorite: false,
          createdAt: now,
          updatedAt: now,
          wordCount: 0,
          preview: "",
          documentType: "markdown",
          storageHandle: { mode: "disk", id: "doc-1", kind: "document", relPath: "Doc.md" },
        },
      ],
      loadedContentIds: new Set(["doc-1"]),
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "doc_read") {
        return {
          markdown: "New",
          meta: { id: "doc-1", title: "Doc", updated: now },
          outline: [{ id: "new", depth: 1, text: "New" }],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await useFileStore.getState().loadFileContent("doc-1", { force: true });

    const refreshed = useFileStore.getState().getFile("doc-1");
    expect(refreshed?.content).toBe("New");
    expect(refreshed?.outline).toEqual([{ id: "new", depth: 1, text: "New" }]);
  });

  it("can surface a forced Page load failure to a caller that must abort", async () => {
    useFileStore.setState({
      files: [markdownFile("doc-1", "Doc.md")],
      loadedContentIds: new Set(["doc-1"]),
    });
    invokeMock.mockRejectedValue(new Error("disk read failed"));

    await expect(
      useFileStore.getState().loadFileContent("doc-1", { force: true, throwOnError: true })
    ).rejects.toThrow("disk read failed");
  });

  it("surfaces a missing Page instead of treating it as a successful forced load", async () => {
    await expect(
      useFileStore.getState().loadFileContent("missing-page", { force: true, throwOnError: true })
    ).rejects.toThrow("Page is no longer available: missing-page");
  });

  it("applies a forced reread when only the Markdown source bytes changed", async () => {
    useFileStore.setState({
      files: [
        {
          ...markdownFile("doc-1", "Doc.md"),
          content: "Same rendering\n",
          outline: [],
        },
      ],
      loadedContentIds: new Set(["doc-1"]),
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "doc_read") {
        return {
          markdown: "Same rendering\n\n",
          meta: { id: "doc-1", title: "Doc", updated: now },
          outline: [],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await useFileStore.getState().loadFileContent("doc-1", { force: true });

    expect(useFileStore.getState().getFile("doc-1")?.content).toBe("Same rendering\n\n");
  });

  it("applies a forced reread when the markdown changed externally", async () => {
    useFileStore.setState({
      files: [
        {
          id: "doc-1",
          name: "Doc.md",
          content: "New",
          isFolder: false,
          parentId: null,
          position: 0,
          isFavorite: false,
          createdAt: now,
          updatedAt: now,
          wordCount: 0,
          preview: "",
          documentType: "markdown",
          storageHandle: { mode: "disk", id: "doc-1", kind: "document", relPath: "Doc.md" },
        },
      ],
      loadedContentIds: new Set(["doc-1"]),
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "doc_read") {
        return {
          markdown: "External edit",
          meta: { id: "doc-1", title: "Doc", updated: now },
          outline: [],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await useFileStore.getState().loadFileContent("doc-1", { force: true });

    const refreshed = useFileStore.getState().getFile("doc-1");
    expect(refreshed?.content).toBe("External edit");
  });

  it("keeps the new filename after rename even when the returned title is stale", async () => {
    // Relocating a Page moves the file but never rewrites its frontmatter `title`.
    // The transaction therefore returns the old title. The tree must reflect the new
    // filename, otherwise the name snaps back to "Untitled-N" after Enter.
    useFileStore.setState({
      files: [markdownFile("doc-1", "Untitled-1.md")],
    });
    invokeMock.mockImplementation(async (command: string, payload: Record<string, unknown>) => {
      if (command === "workspace_scan") {
        return {
          root: "/workspace",
          documents: [
            {
              id: "doc-1",
              idSource: "frontmatter",
              path: "Untitled-1.md",
              name: "Untitled-1.md",
              title: "Untitled-1",
              documentType: "markdown",
            },
          ],
        };
      }
      if (command === "doc_read") {
        return {
          markdown: "",
          revision: "sha256:untitled",
          meta: { id: "doc-1", title: "Untitled-1" },
          outline: [],
        };
      }
      if (command === "workspace_relocate_page") {
        expect(payload).toMatchObject({
          root: "/workspace",
          oldPath: "Untitled-1.md",
          newPath: "Report.md",
          expectedRevision: "sha256:untitled",
          checks: [{ path: "Untitled-1.md", expectedRevision: "sha256:untitled" }],
        });
        return {
          document: {
            id: "doc-1",
            idSource: "frontmatter",
            path: "Report.md",
            name: "Report.md",
            title: "Untitled-1",
            documentType: "markdown",
          },
          revision: "sha256:untitled",
          writes: [],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await useFileStore.getState().renameFile("doc-1", "Report.md");

    expect(useFileStore.getState().getFile("doc-1")?.name).toBe("Report");
  });

  it("flushes active Markdown edits before renaming the Page on disk", async () => {
    const requestSave = vi.fn(async () => {
      useEditorStore.setState({ isDirty: false });
      return true;
    });
    useEditorRefStore.setState({ requestSave });
    useEditorStore.setState({ isDirty: true });
    useFileStore.setState({
      currentFileId: "doc-2",
      files: [markdownFile("doc-1", "Draft.md"), markdownFile("doc-2", "Active.md")],
    });
    invokeMock.mockImplementation(async (command: string, payload: Record<string, unknown>) => {
      if (command === "workspace_scan") {
        return {
          root: "/workspace",
          documents: [
            {
              id: "doc-1",
              idSource: "frontmatter",
              path: "Draft.md",
              name: "Draft.md",
              title: "Draft",
              documentType: "markdown",
            },
            {
              id: "doc-2",
              idSource: "frontmatter",
              path: "Active.md",
              name: "Active.md",
              title: "Active",
              documentType: "markdown",
            },
          ],
        };
      }
      if (command === "doc_read") {
        const active = payload.path === "Active.md";
        return {
          markdown: "",
          revision: active ? "sha256:active" : "sha256:draft",
          meta: { id: active ? "doc-2" : "doc-1" },
          outline: [],
        };
      }
      if (command === "workspace_relocate_page") {
        return {
          document: {
            id: "doc-1",
            idSource: "frontmatter",
            path: "Final.md",
            name: "Final.md",
            title: "Draft",
            documentType: "markdown",
          },
          revision: "sha256:draft",
          writes: [],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await useFileStore.getState().renameFile("doc-1", "Final.md");

    expect(requestSave).toHaveBeenCalledTimes(1);
    expect(requestSave.mock.invocationCallOrder[0]).toBeLessThan(
      invokeMock.mock.invocationCallOrder[0]
    );
  });

  it("renames a Page and repairs its incoming links through one relocation transaction", async () => {
    useFileStore.setState({
      currentFileId: "page-1",
      openTabIds: ["page-1", "daily-1"],
      loadedContentIds: new Set(["page-1", "daily-1"]),
      files: [
        {
          ...markdownFile("page-1", "Draft.md"),
          content: "# Draft\n",
          sourceRevision: "sha256:draft",
        },
        {
          ...markdownFile("daily-1", "Daily.md"),
          content: "See [[Draft]].\n",
          sourceRevision: "sha256:daily",
        },
      ],
    });
    invokeMock.mockImplementation(async (command: string, payload: Record<string, unknown>) => {
      if (command === "workspace_scan") {
        return {
          root: "/workspace",
          documents: [
            {
              id: "page-1",
              idSource: "frontmatter",
              path: "Draft.md",
              name: "Draft.md",
              title: "Draft",
              documentType: "markdown",
            },
            {
              id: "daily-1",
              idSource: "frontmatter",
              path: "Daily.md",
              name: "Daily.md",
              title: "Daily",
              documentType: "markdown",
            },
          ],
        };
      }
      if (command === "doc_read") {
        const path = String(payload.path);
        return path === "Draft.md"
          ? {
              markdown: "# Draft\n",
              revision: "sha256:draft",
              meta: { id: "page-1" },
              outline: [],
            }
          : {
              markdown: "See [[Draft]].\n",
              revision: "sha256:daily",
              meta: { id: "daily-1" },
              outline: [],
            };
      }
      if (command === "workspace_relocate_page") {
        expect(payload).toEqual({
          root: "/workspace",
          oldPath: "Draft.md",
          newPath: "Final.md",
          expectedRevision: "sha256:draft",
          checks: [
            { path: "Daily.md", expectedRevision: "sha256:daily" },
            { path: "Draft.md", expectedRevision: "sha256:draft" },
          ],
          writes: [
            {
              path: "Daily.md",
              expectedRevision: "sha256:daily",
              markdown: "See [[Final]].\n",
            },
          ],
        });
        return {
          document: {
            id: "page-1",
            idSource: "frontmatter",
            path: "Final.md",
            name: "Final.md",
            title: "Draft",
            documentType: "markdown",
          },
          revision: "sha256:draft",
          writes: [{ path: "Daily.md", revision: "sha256:daily-new" }],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await useFileStore.getState().renameFile("page-1", "Final.md");

    expect(invokeMock.mock.calls.some(([command]) => command === "doc_rename")).toBe(false);
    expect(useFileStore.getState().getFile("page-1")?.name).toBe("Final");
    expect(useFileStore.getState().getFile("daily-1")).toMatchObject({
      content: "See [[Final]].\n",
      sourceRevision: "sha256:daily-new",
    });
  });

  it("keeps every Page unchanged when relocation preview is declined", async () => {
    useFileStore.setState({ files: [markdownFile("page-1", "Draft.md")] });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "workspace_scan") {
        return {
          root: "/workspace",
          documents: [
            {
              id: "page-1",
              idSource: "frontmatter",
              path: "Draft.md",
              name: "Draft.md",
              title: "Draft",
              documentType: "markdown",
            },
          ],
        };
      }
      if (command === "doc_read") {
        return {
          markdown: "",
          revision: "sha256:draft",
          meta: { id: "page-1" },
          outline: [],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const confirm = vi.fn().mockResolvedValue(false);

    await useFileStore.getState().renameFile("page-1", "Final.md", { confirm });

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        relocation: expect.objectContaining({ fromPath: "Draft.md", toPath: "Final.md" }),
      })
    );
    expect(invokeMock.mock.calls.some(([command]) => command === "workspace_relocate_page")).toBe(
      false
    );
    expect(useFileStore.getState().getFile("page-1")?.name).toBe("Draft.md");
  });

  it("does not rename the Page when its active edits cannot be saved", async () => {
    useEditorRefStore.setState({ requestSave: vi.fn().mockResolvedValue(false) });
    useEditorStore.setState({ isDirty: true });
    useFileStore.setState({
      currentFileId: "doc-1",
      files: [markdownFile("doc-1", "Draft.md")],
    });

    await expect(useFileStore.getState().renameFile("doc-1", "Final.md")).rejects.toThrow(
      "Save the active Page before renaming it"
    );

    expect(invokeMock).not.toHaveBeenCalled();
    expect(useFileStore.getState().getFile("doc-1")?.name).toBe("Draft.md");
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

  it("carries every path-derived Page identity slot when moving it to a folder", async () => {
    const oldId = "path:Note.md";
    const newId = "path:Archive/Note.md";
    const folder = {
      ...markdownFile("folder:Archive", "Archive"),
      isFolder: true,
      documentType: undefined,
      storageHandle: {
        mode: "disk" as const,
        id: "folder:Archive",
        kind: "folder" as const,
        relPath: "Archive",
      },
    };
    useFileStore.setState({
      files: [markdownFile(oldId, "Note.md"), folder],
      currentFileId: oldId,
      openTabIds: [oldId],
      loadedContentIds: new Set([oldId]),
      selectedFileIds: new Set([oldId]),
      justCreatedFileId: oldId,
    });
    invokeMock.mockImplementation(async (command: string, payload: Record<string, unknown>) => {
      if (command === "workspace_scan") {
        return {
          root: "/workspace",
          documents: [
            {
              id: oldId,
              idSource: "path",
              path: "Note.md",
              name: "Note.md",
              title: "Note",
              documentType: "markdown",
            },
          ],
        };
      }
      if (command === "doc_read") {
        return { markdown: "", revision: "sha256:note", meta: {}, outline: [] };
      }
      if (command === "workspace_relocate_page") {
        expect(payload).toMatchObject({
          root: "/workspace",
          oldPath: "Note.md",
          newPath: "Archive/Note.md",
          expectedRevision: "sha256:note",
        });
        return {
          document: {
            id: newId,
            idSource: "path",
            path: "Archive/Note.md",
            name: "Note.md",
            title: "Note",
            documentType: "markdown",
          },
          revision: "sha256:note",
          writes: [],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await useFileStore.getState().moveFileToFolder(oldId, "folder:Archive");

    const state = useFileStore.getState();
    expect(state.getFile(newId)?.parentId).toBe("folder:Archive");
    expect(state.getFile(oldId)).toBeUndefined();
    expect(state.currentFileId).toBe(newId);
    expect(state.openTabIds).toEqual([newId]);
    expect(state.loadedContentIds).toEqual(new Set([newId]));
    expect(state.selectedFileIds).toEqual(new Set([newId]));
    expect(state.justCreatedFileId).toBe(newId);
  });

  it("evicts the cached body of a replaced Page so the next open reads disk", async () => {
    // Replace-import rewrites the file on disk. Blanking the cached body while
    // leaving the id in loadedContentIds made the next open render an empty
    // editor against a stale revision instead of reading the replacement.
    useFileStore.setState({
      files: [
        {
          ...markdownFile("doc-1", "Notes.md"),
          content: "Old body",
          sourceRevision: "sha256:old",
          outline: [{ id: "old", depth: 1, text: "Old" }],
          meta: { id: "doc-1", title: "Old" },
        },
      ],
      loadedContentIds: new Set(["doc-1"]),
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "doc_import_external") {
        return {
          id: "doc-1",
          idSource: "path",
          path: "Notes.md",
          name: "Notes.md",
          title: "Notes",
          documentType: "markdown",
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const id = await useFileStore.getState().importExternalFile({
      name: "Notes.md",
      parentId: null,
      bytes: new Uint8Array([35, 32, 78]),
      mode: "replace",
    });

    expect(id).toBe("doc-1");
    const state = useFileStore.getState();
    expect(state.getFile("doc-1")?.content).toBe("");
    expect(state.getFile("doc-1")?.sourceRevision).toBeUndefined();
    expect(state.getFile("doc-1")?.outline).toBeUndefined();
    expect(state.getFile("doc-1")?.meta).toBeUndefined();
    expect(state.loadedContentIds.has("doc-1")).toBe(false);
  });

  it("flushes active Markdown edits before moving the Page on disk", async () => {
    const requestSave = vi.fn(async () => {
      useEditorStore.setState({ isDirty: false });
      return true;
    });
    useEditorRefStore.setState({ requestSave });
    useEditorStore.setState({ isDirty: true });
    useFileStore.setState({
      currentFileId: "doc-1",
      files: [
        markdownFile("doc-1", "Draft.md"),
        {
          ...markdownFile("folder:Archive", "Archive"),
          isFolder: true,
          documentType: undefined,
          storageHandle: {
            mode: "disk",
            id: "folder:Archive",
            kind: "folder",
            relPath: "Archive",
          },
        },
      ],
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "workspace_scan") {
        return {
          root: "/workspace",
          documents: [
            {
              id: "doc-1",
              idSource: "frontmatter",
              path: "Draft.md",
              name: "Draft.md",
              title: "Draft",
              documentType: "markdown",
            },
          ],
        };
      }
      if (command === "doc_read") {
        return {
          markdown: "",
          revision: "sha256:draft",
          meta: { id: "doc-1" },
          outline: [],
        };
      }
      if (command === "workspace_relocate_page") {
        return {
          document: {
            id: "doc-1",
            idSource: "frontmatter",
            path: "Archive/Draft.md",
            name: "Draft.md",
            title: "Draft",
            documentType: "markdown",
          },
          revision: "sha256:draft",
          writes: [],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await useFileStore.getState().moveFileToFolder("doc-1", "folder:Archive");

    expect(requestSave).toHaveBeenCalledOnce();
    expect(requestSave.mock.invocationCallOrder[0]).toBeLessThan(
      invokeMock.mock.invocationCallOrder[0]
    );
  });

  it("surfaces a Page relocation failure without an optimistic state mutation", async () => {
    const originalLoadFiles = useFileStore.getState().loadFiles;
    const moveError = new Error("move failed");
    const loadFilesMock = vi.fn().mockResolvedValue(undefined);
    useFileStore.setState({
      files: [
        markdownFile("doc-1", "Doc.md"),
        {
          ...markdownFile("folder:Archive", "Archive"),
          isFolder: true,
          documentType: undefined,
          storageHandle: {
            mode: "disk",
            id: "folder:Archive",
            kind: "folder",
            relPath: "Archive",
          },
        },
      ],
      loadFiles: loadFilesMock,
    });
    invokeMock.mockRejectedValueOnce(moveError);

    try {
      await expect(
        useFileStore.getState().moveFileToFolder("doc-1", "folder:Archive")
      ).rejects.toBe(moveError);
      expect(loadFilesMock).not.toHaveBeenCalled();
      expect(useFileStore.getState().getFile("doc-1")?.parentId).toBeNull();
    } finally {
      useFileStore.setState({ loadFiles: originalLoadFiles });
    }
  });

  it("moves a Folder subtree and repairs links while preserving every open identity slot", async () => {
    const oldPageId = "path:old-target";
    const newPageId = "path:new-target";
    const oldRootId = "folder:Notes";
    const oldSubId = "folder:Notes/Sub";
    const newRootId = "folder:Archive/Notes";
    const newSubId = "folder:Archive/Notes/Sub";
    const confirm = vi.fn().mockResolvedValue(true);
    useFileStore.setState({
      files: [
        folderItem("folder:Archive", "Archive", "Archive"),
        folderItem(oldRootId, "Notes", "Notes"),
        folderItem(oldSubId, "Sub", "Notes/Sub", oldRootId),
        {
          ...markdownFileAt(oldPageId, "Target", "Notes/Sub/Target.md", oldSubId),
          content: "See [[../../Daily]].\n",
          sourceRevision: "sha256:target",
        },
        {
          ...markdownFileAt("daily-1", "Daily", "Daily.md"),
          content: "See [[Notes/Sub/Target]].\n",
          sourceRevision: "sha256:daily",
        },
      ],
      currentFileId: oldPageId,
      openTabIds: [oldPageId, "daily-1"],
      currentFolderId: oldSubId,
      loadedContentIds: new Set([oldPageId, "daily-1"]),
      selectedFileIds: new Set([oldPageId, oldSubId]),
      expandedFolderIds: new Set([oldRootId, oldSubId]),
      justCreatedFileId: oldPageId,
    });

    let scan = 0;
    invokeMock.mockImplementation(async (command: string, payload: Record<string, unknown>) => {
      if (command === "workspace_scan") {
        scan += 1;
        return scan === 1
          ? {
              root: "/workspace",
              documents: [
                {
                  id: "daily-1",
                  idSource: "frontmatter",
                  path: "Daily.md",
                  name: "Daily.md",
                  title: "Daily",
                  documentType: "markdown",
                },
                {
                  id: oldPageId,
                  idSource: "path",
                  path: "Notes/Sub/Target.md",
                  name: "Target.md",
                  title: "Target",
                  documentType: "markdown",
                },
              ],
            }
          : {
              root: "/workspace",
              documents: [
                {
                  id: "daily-1",
                  idSource: "frontmatter",
                  path: "Daily.md",
                  name: "Daily.md",
                  title: "Daily",
                  documentType: "markdown",
                },
                {
                  id: newPageId,
                  idSource: "path",
                  path: "Archive/Notes/Sub/Target.md",
                  name: "Target.md",
                  title: "Target",
                  documentType: "markdown",
                },
              ],
            };
      }
      if (command === "doc_read") {
        return payload.path === "Daily.md"
          ? {
              markdown: "See [[Notes/Sub/Target]].\n",
              revision: "sha256:daily",
              meta: { id: "daily-1" },
              outline: [],
            }
          : {
              markdown: "See [[../../Daily]].\n",
              revision: "sha256:target",
              meta: {},
              outline: [],
            };
      }
      if (command === "workspace_relocate_folder") {
        expect(payload).toEqual({
          root: "/workspace",
          oldPath: "Notes",
          newPath: "Archive/Notes",
          checks: [
            { path: "Daily.md", expectedRevision: "sha256:daily" },
            { path: "Notes/Sub/Target.md", expectedRevision: "sha256:target" },
          ],
          writes: [
            {
              sourcePath: "Daily.md",
              destinationPath: "Daily.md",
              expectedRevision: "sha256:daily",
              markdown: "See [[Archive/Notes/Sub/Target]].\n",
            },
            {
              sourcePath: "Notes/Sub/Target.md",
              destinationPath: "Archive/Notes/Sub/Target.md",
              expectedRevision: "sha256:target",
              markdown: "See [[../../../Daily]].\n",
            },
          ],
        });
        return {
          path: "Archive/Notes",
          writes: [
            { path: "Daily.md", revision: "sha256:daily-new" },
            { path: "Archive/Notes/Sub/Target.md", revision: "sha256:target-new" },
          ],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await useFileStore.getState().moveFileToFolder(oldRootId, "folder:Archive", { confirm });

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        relocation: expect.objectContaining({ fromPath: "Notes", toPath: "Archive/Notes" }),
      })
    );
    expect(invokeMock.mock.calls.some(([command]) => command === "doc_move")).toBe(false);
    const state = useFileStore.getState();
    expect(state.currentFileId).toBe(newPageId);
    expect(state.openTabIds).toEqual([newPageId, "daily-1"]);
    expect(state.currentFolderId).toBe(newSubId);
    expect(state.loadedContentIds).toEqual(new Set([newPageId, "daily-1"]));
    expect(state.selectedFileIds).toEqual(new Set([newPageId, newSubId]));
    expect(state.expandedFolderIds).toEqual(new Set([newRootId, newSubId]));
    expect(state.justCreatedFileId).toBe(newPageId);
    expect(state.getFile(newPageId)).toMatchObject({
      parentId: newSubId,
      content: "See [[../../../Daily]].\n",
      sourceRevision: "sha256:target-new",
    });
    expect(state.getFile("daily-1")).toMatchObject({
      content: "See [[Archive/Notes/Sub/Target]].\n",
      sourceRevision: "sha256:daily-new",
    });
    expect(state.getFile(oldPageId)).toBeUndefined();
    expect(state.getFile(oldRootId)).toBeUndefined();
  });

  it("does not rename a Folder when its link-impact preview is declined", async () => {
    const folder = folderItem("folder:Notes", "Notes", "Notes");
    useFileStore.setState({
      files: [folder, markdownFileAt("page-1", "Page", "Notes/Page.md", folder.id)],
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "workspace_scan") {
        return {
          root: "/workspace",
          documents: [
            {
              id: "page-1",
              idSource: "frontmatter",
              path: "Notes/Page.md",
              name: "Page.md",
              title: "Page",
              documentType: "markdown",
            },
          ],
        };
      }
      if (command === "doc_read") {
        return {
          markdown: "",
          revision: "sha256:page",
          meta: { id: "page-1" },
          outline: [],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const confirm = vi.fn().mockReturnValue(false);

    await useFileStore.getState().renameFile(folder.id, "Archive", { confirm });

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        relocation: expect.objectContaining({ fromPath: "Notes", toPath: "Archive" }),
      })
    );
    expect(invokeMock.mock.calls.some(([command]) => command === "workspace_relocate_folder")).toBe(
      false
    );
    expect(useFileStore.getState().files).toEqual([folder, expect.any(Object)]);
    expect(useFileStore.getState().getFile(folder.id)?.name).toBe("Notes");
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
    vi.stubGlobal("__DOXMIND_DESKTOP__", undefined);
    invokeMock.mockRejectedValueOnce(new Error("desktop unavailable"));

    try {
      await expect(useFileStore.getState().deleteFile("doc-1")).rejects.toBe(deleteError);
      expect(loadFilesMock).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      useFileStore.setState({ loadFiles: originalLoadFiles });
      vi.unstubAllGlobals();
    }
  });

  it("saves a draft onto the existing file the user chose to replace", async () => {
    // The native Save panel already asked "Draft.md already exists. Replace?"
    // before it handed back this path; without carrying that consent to the
    // write, `doc_create` refuses and the draft goes nowhere.
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "doc_create") {
        return {
          id: "doc-draft",
          idSource: "frontmatter",
          path: "Draft.md",
          name: "Draft.md",
          title: "Draft",
          documentType: "markdown",
        };
      }
      if (command === "doc_read") {
        return {
          markdown: "# Draft",
          meta: { id: "doc-draft", title: "Draft" },
          outline: [],
          revision: "sha256:draft",
        };
      }
      return undefined;
    });

    useFileStore.getState().createTransientFile("Untitled-1.md");
    useFileStore.getState().setTransientMarkdown("# Draft");

    const newId = await useFileStore.getState().materializeTransient("/notes/Draft.md");

    expect(invokeMock).toHaveBeenCalledWith(
      "doc_create",
      expect.objectContaining({
        root: "/notes",
        payload: expect.objectContaining({
          path: "Draft.md",
          markdown: "# Draft",
          replaceExisting: true,
        }),
      })
    );
    const state = useFileStore.getState();
    expect(newId).toBe(state.currentFileId);
    expect(state.transientFile).toBeNull();
    expect(state.openFilePath).toBe("/notes/Draft.md");
    expect(state.files.map((file) => file.name)).toEqual(["Draft.md"]);
  });
});

describe("useFileStore tabs", () => {
  const page = (id: string) => ({
    id,
    name: `${id}.md`,
    isFolder: false,
    parentId: null,
    position: 0,
    isFavorite: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    wordCount: 0,
    preview: "",
    content: "",
  });

  beforeEach(() => {
    useFileStore.setState({
      files: [page("a"), page("b"), page("c")] as never,
      openTabIds: ["a", "b", "c"],
      currentFileId: "a",
    });
  });

  it("reorders a tab to the position it was dropped on", () => {
    useFileStore.getState().reorderTab("c", 0);
    expect(useFileStore.getState().openTabIds).toEqual(["c", "a", "b"]);

    useFileStore.getState().reorderTab("c", 2);
    expect(useFileStore.getState().openTabIds).toEqual(["a", "b", "c"]);
  });

  it("ignores a reorder of a tab that is not open", () => {
    useFileStore.getState().reorderTab("missing", 0);
    expect(useFileStore.getState().openTabIds).toEqual(["a", "b", "c"]);
  });

  it("closes the others and keeps the one that was kept", async () => {
    useFileStore.getState().closeOtherTabs("b");
    expect(useFileStore.getState().openTabIds).toEqual(["b"]);
  });

  it("closes them all", () => {
    useFileStore.getState().closeAllTabs();
    expect(useFileStore.getState().openTabIds).toEqual([]);
  });
});
