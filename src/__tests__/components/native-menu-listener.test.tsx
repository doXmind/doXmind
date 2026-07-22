import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listeners, invokeMock, navigateMock, pushMock } = vi.hoisted(() => ({
  listeners: new Map<string, (event?: unknown) => void | Promise<void>>(),
  invokeMock: vi.fn(async (command: string) => (command === "take_pending_open_paths" ? [] : null)),
  navigateMock: vi.fn(async () => true),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("@/lib/editor-navigation", () => ({ navigateToEditorFile: navigateMock }));

import { NativeMenuListener } from "@/components/native-menu-listener";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";

const page: FileItem = {
  id: "page-1",
  name: "Page.md",
  content: "# Page\n",
  documentType: "markdown",
  isFolder: false,
  parentId: null,
  position: 0,
  isFavorite: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  wordCount: 1,
  preview: "Page",
};

const attachment: FileItem = {
  ...page,
  id: "attachment-1",
  name: "Spec.pdf",
  content: "",
  documentType: "pdf",
};

describe("NativeMenuListener", () => {
  beforeEach(() => {
    vi.stubGlobal("__DOXMIND_DESKTOP__", {
      platform: "macos",
      invoke: invokeMock,
      listen: (name: string, callback: (event?: unknown) => void | Promise<void>) => {
        listeners.set(name, callback);
        return vi.fn();
      },
      getPathForFile: vi.fn(() => null),
    });
    listeners.clear();
    invokeMock.mockClear();
    navigateMock.mockClear();
    pushMock.mockClear();
    useFileStore.setState(useFileStore.getInitialState(), true);
    useLayoutStore.setState(useLayoutStore.getInitialState(), true);
    useEditorRefStore.setState(useEditorRefStore.getInitialState(), true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes native Save through the mounted editor", async () => {
    const requestSave = vi.fn().mockResolvedValue(true);
    useEditorRefStore.setState({ requestSave });
    useFileStore.setState({ files: [page], currentFileId: page.id });
    render(<NativeMenuListener />);

    await waitFor(() => expect(listeners.has("menu://save")).toBe(true));
    await act(async () => {
      await listeners.get("menu://save")?.();
    });

    expect(requestSave).toHaveBeenCalledOnce();
  });

  it("routes native Undo, Redo, and Find through the active Markdown Page", async () => {
    const requestUndo = vi.fn();
    const requestRedo = vi.fn();
    useEditorRefStore.setState({ requestUndo, requestRedo });
    useFileStore.setState({ files: [page], currentFileId: page.id });
    useLayoutStore.setState({ isSearchBarOpen: false });
    render(<NativeMenuListener />);

    await waitFor(() => expect(listeners.has("menu://redo")).toBe(true));
    act(() => {
      void listeners.get("menu://undo")?.();
      void listeners.get("menu://redo")?.();
      void listeners.get("menu://find")?.();
    });

    expect(requestUndo).toHaveBeenCalledOnce();
    expect(requestRedo).toHaveBeenCalledOnce();
    expect(useLayoutStore.getState().isSearchBarOpen).toBe(true);
  });

  it.each([
    ["welcome", [], null],
    ["attachment", [attachment], attachment.id],
  ] as const)("makes Page-only actions a safe no-op on %s", async (_name, files, currentFileId) => {
    const requestSave = vi.fn().mockResolvedValue(true);
    const requestUndo = vi.fn();
    const requestRedo = vi.fn();
    useEditorRefStore.setState({ requestSave, requestUndo, requestRedo });
    useFileStore.setState({ files: [...files], currentFileId });
    useLayoutStore.setState({ isSearchBarOpen: false });
    render(<NativeMenuListener />);

    await waitFor(() => expect(listeners.has("menu://redo")).toBe(true));
    await act(async () => {
      await listeners.get("menu://save")?.();
      await listeners.get("menu://undo")?.();
      await listeners.get("menu://redo")?.();
      await listeners.get("menu://find")?.();
    });

    expect(requestSave).not.toHaveBeenCalled();
    expect(requestUndo).not.toHaveBeenCalled();
    expect(requestRedo).not.toHaveBeenCalled();
    expect(useLayoutStore.getState().isSearchBarOpen).toBe(false);
  });

  it("creates a transient Markdown Page from the welcome screen", async () => {
    useFileStore.setState({ openTarget: "none", rootPath: null });
    render(<NativeMenuListener />);

    await waitFor(() => expect(listeners.has("menu://new-file")).toBe(true));
    act(() => {
      void listeners.get("menu://new-file")?.();
    });

    await waitFor(() => expect(useFileStore.getState().transientFile).not.toBeNull());
    const transient = useFileStore.getState().transientFile;
    expect(transient?.name).toBe("Untitled-1.md");
    expect(navigateMock).toHaveBeenCalledWith(transient?.id);
  });
});
