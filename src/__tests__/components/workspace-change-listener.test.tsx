import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));

import { WorkspaceChangeListener } from "@/components/workspace-change-listener";
import { eventBus } from "@/lib/events";
import { useFileStore } from "@/stores/file-store";

const now = "2026-07-21T00:00:00.000Z";

describe("WorkspaceChangeListener", () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("__DOXMIND_DESKTOP__", {
      platform: "macos",
      invoke: (command: string, payload?: Record<string, unknown>) => invokeMock(command, payload),
      listen: (event: string, callback: () => void) => listenMock(event, callback),
      getPathForFile: vi.fn(() => null),
    });
    useFileStore.setState({
      files: [
        {
          id: "page-1",
          name: "Doc.md",
          content: "Old\n",
          outline: [],
          isFolder: false,
          parentId: null,
          position: 0,
          isFavorite: false,
          createdAt: now,
          updatedAt: now,
          wordCount: 1,
          preview: "Old",
          documentType: "markdown",
          storageHandle: {
            mode: "disk",
            id: "page-1",
            kind: "document",
            relPath: "Doc.md",
            documentType: "markdown",
          },
        },
      ],
      currentFileId: "page-1",
      openTabIds: ["page-1"],
      currentFolderId: null,
      openTarget: "folder",
      rootPath: "/workspace",
      openFilePath: null,
      transientFile: null,
      recents: [],
      isLoading: false,
      isSynced: true,
      justCreatedFileId: null,
      expandedFolderIds: new Set(),
      selectedFileIds: new Set(),
      loadedContentIds: new Set(["page-1"]),
    });
  });

  it("re-reads the active Markdown Page after a workspace change", async () => {
    const storageChanged = vi.fn();
    const offStorageChanged = eventBus.on("storage:changed", storageChanged);
    let workspaceChanged: (() => void) | undefined;
    listenMock.mockImplementation((_event: string, callback: () => void) => {
      workspaceChanged = callback;
      return vi.fn();
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "workspace_watch" || command === "workspace_unwatch") return undefined;
      if (command === "workspace_scan") {
        return {
          root: "/workspace",
          documents: [
            {
              id: "page-1",
              idSource: "frontmatter",
              path: "Doc.md",
              name: "Doc.md",
              documentType: "markdown",
              hasSidecar: false,
            },
          ],
        };
      }
      if (command === "doc_read") {
        return {
          markdown: "External\n",
          meta: { id: "page-1", title: "Doc", created: now, updated: now },
          outline: [],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const view = render(<WorkspaceChangeListener />);
    await waitFor(() => expect(workspaceChanged).toBeTypeOf("function"));

    act(() => workspaceChanged?.());

    await waitFor(() => {
      expect(useFileStore.getState().getFile("page-1")?.content).toBe("External\n");
    });
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(
      expect.arrayContaining(["workspace_scan", "doc_read"])
    );
    expect(storageChanged).toHaveBeenCalledOnce();

    view.unmount();
    offStorageChanged();
  });

  it("does not drop an external event immediately after a self-save", async () => {
    let workspaceChanged: (() => void) | undefined;
    listenMock.mockImplementation((_event: string, callback: () => void) => {
      workspaceChanged = callback;
      return vi.fn();
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "workspace_watch" || command === "workspace_unwatch") return undefined;
      if (command === "doc_write_workspace") {
        return {
          markdown: "Saved\n",
          meta: { id: "page-1", title: "Doc", created: now, updated: now },
          outline: [],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const view = render(<WorkspaceChangeListener />);
    await waitFor(() => expect(workspaceChanged).toBeTypeOf("function"));
    await useFileStore.getState().updateFile("page-1", {
      content: "Saved\n",
    });

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "workspace_unwatch") return undefined;
      if (command === "workspace_scan") {
        return {
          root: "/workspace",
          documents: [
            {
              id: "page-1",
              idSource: "frontmatter",
              path: "Doc.md",
              name: "Doc.md",
              documentType: "markdown",
              hasSidecar: false,
            },
          ],
        };
      }
      if (command === "doc_read") {
        return {
          markdown: "External after save\n",
          meta: { id: "page-1", title: "Doc", created: now, updated: now },
          outline: [],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    act(() => workspaceChanged?.());

    await waitFor(() => {
      expect(useFileStore.getState().getFile("page-1")?.content).toBe("External after save\n");
    });

    view.unmount();
  });
});
