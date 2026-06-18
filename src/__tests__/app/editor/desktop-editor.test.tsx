import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopEditor } from "@/app/editor/[[...fileId]]/_components/desktop-editor";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";

vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/sidebar/files-sidebar", () => ({
  FilesSidebar: () => <div data-testid="files-sidebar" />,
}));

vi.mock("@/components/welcome-screen", () => ({
  WelcomeScreen: () => <div data-testid="welcome-screen" />,
}));

vi.mock("@/components/workspace/document-workspace", () => ({
  DocumentWorkspace: () => <div data-testid="document-workspace" />,
}));

vi.mock("@/components/workspace/workspace-home", () => ({
  WorkspaceHome: () => <div data-testid="workspace-home" />,
}));

vi.mock("@/components/editor/unified-header", () => ({
  UnifiedHeader: () => <div data-testid="unified-header" />,
}));

vi.mock("@/components/editor/mindlines/use-headings", () => ({
  useHeadings: () => ({ headings: [], activeId: null, navigateTo: vi.fn() }),
}));

vi.mock("@/components/editor/mindlines/outline-collapsed", () => ({
  OutlineCollapsed: () => <div data-testid="outline-collapsed" />,
}));

vi.mock("@/components/ui/resize-handle", () => ({
  ResizeHandle: () => <div data-testid="resize-handle" />,
}));

vi.mock("@/stores/editor-ref-store", () => ({
  useEditorRefStore: () => null,
}));

describe("DesktopEditor welcome shell", () => {
  beforeEach(() => {
    useFileStore.setState({
      files: [],
      currentFileId: null,
      currentFolderId: null,
      openTarget: "none",
      rootPath: null,
      openFilePath: null,
      transientFile: null,
      isSynced: true,
      isLoading: false,
      loadedContentIds: new Set(),
    });
    useLayoutStore.setState({
      isFocusMode: false,
      isFilesSidebarOpen: true,
      filesSidebarWidth: 304,
    });
  });

  it("keeps the workspace home visible when a folder is mounted with no selected file", () => {
    useFileStore.setState({
      openTarget: "folder",
      rootPath: "/tmp/workspace",
      currentFileId: null,
      files: [],
      isSynced: true,
    });

    render(<DesktopEditor />);

    expect(screen.getByTestId("files-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-home")).toBeInTheDocument();
    expect(screen.queryByTestId("document-workspace")).not.toBeInTheDocument();
  });

  it("unmounts the file sidebar contents when the sidebar is collapsed", () => {
    useFileStore.setState({
      openTarget: "folder",
      rootPath: "/tmp/workspace",
      currentFileId: null,
      files: [],
      isSynced: true,
    });

    render(<DesktopEditor />);
    expect(screen.getByTestId("files-sidebar")).toBeInTheDocument();

    act(() => {
      useLayoutStore.setState({ isFilesSidebarOpen: false });
    });

    expect(screen.queryByTestId("files-sidebar")).not.toBeInTheDocument();
    expect(screen.getByTestId("workspace-home")).toBeInTheDocument();
  });
});
