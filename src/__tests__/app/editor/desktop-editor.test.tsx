import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopEditor } from "@/app/editor/[[...fileId]]/_components/desktop-editor";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { usePageSessionStore } from "@/stores/page-session-store";

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

vi.mock("@/components/editor/mindlines/outline-collapsed", () => ({
  OutlineCollapsed: ({
    headings,
    onNavigate,
  }: {
    headings: Array<{ id: string; text: string }>;
    onNavigate: (heading: { id: string; text: string }) => void;
  }) => (
    <div data-testid="outline-collapsed">
      {headings.map((heading) => (
        <button key={heading.id} type="button" onClick={() => onNavigate(heading)}>
          {heading.text}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@/components/ui/resize-handle", () => ({
  ResizeHandle: () => <div data-testid="resize-handle" />,
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
    usePageSessionStore.setState({ outlineSession: null, revealRequest: null });
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

  it("renders and navigates the current native Page outline", () => {
    const markdownFile = {
      id: "page-1",
      name: "Project.md",
      content: "# Project\n\n## Next\n",
      documentType: "markdown",
      isFolder: false,
      parentId: null,
      position: 0,
      isFavorite: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      wordCount: 2,
      preview: "Project",
    } as FileItem;
    const headings = [
      { id: "block-1", level: 1, text: "Project", pos: 0 },
      { id: "block-2", level: 2, text: "Next", pos: 11 },
    ];
    const navigateTo = vi.fn();
    useFileStore.setState({
      openTarget: "folder",
      rootPath: "/tmp/workspace",
      currentFileId: markdownFile.id,
      files: [markdownFile],
      loadedContentIds: new Set([markdownFile.id]),
      isSynced: true,
    });
    usePageSessionStore.setState({
      outlineSession: {
        pageId: markdownFile.id,
        headings,
        activeId: headings[0].id,
        navigateTo,
      },
    });

    render(<DesktopEditor />);

    expect(screen.getByTestId("outline-collapsed")).toHaveTextContent("Project");
    expect(screen.getByTestId("outline-collapsed")).toHaveTextContent("Next");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(navigateTo).toHaveBeenCalledWith(headings[1]);
  });
});

/**
 * The sidebar has always had a ResizeHandle wired to `setFilesSidebarWidth`, but two things
 * kept the user from actually dragging it: the handle's grid column clipped its own hit strip
 * to nothing, and a layout effect snapped any width under 288px back to 304 on the very next
 * render. Both are geometry the DOM can be asked about, so both are guarded here.
 */
describe("DesktopEditor sidebar resizing", () => {
  beforeEach(() => {
    useFileStore.setState({
      files: [],
      currentFileId: null,
      currentFolderId: null,
      openTarget: "folder",
      rootPath: "/tmp/workspace",
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
    usePageSessionStore.setState({ outlineSession: null, revealRequest: null });
  });

  it("gives the resize handle a column that neither clips nor collapses it", () => {
    render(<DesktopEditor />);

    const column = screen.getByTestId("resize-handle").parentElement!.className.split(/\s+/);
    // jsdom does no layout, so this asserts the two class-level conditions that were
    // measured in a real browser. Either one wrong and the handle's hit strip lays out
    // 8x0 — present in the DOM, unreachable by the pointer:
    //   - the column is 0px wide, so `overflow-hidden` clips the ±4px strip away;
    //   - ResizeHandle declares no height and holds only absolute children, so it needs
    //     a flex parent to stretch instead of collapsing to zero.
    expect(column).not.toContain("overflow-hidden");
    expect(column).toContain("flex");
  });

  it("keeps a width dragged below the old 288px floor", () => {
    render(<DesktopEditor />);

    act(() => {
      useLayoutStore.getState().setFilesSidebarWidth(240);
    });

    expect(useLayoutStore.getState().filesSidebarWidth).toBe(240);
    expect(screen.getByRole("complementary").firstElementChild).toHaveStyle({
      minWidth: "240px",
    });
  });

  it("clamps a drag to the store's bounds rather than letting the pane vanish", () => {
    render(<DesktopEditor />);
    const { setFilesSidebarWidth } = useLayoutStore.getState();

    act(() => setFilesSidebarWidth(40));
    expect(useLayoutStore.getState().filesSidebarWidth).toBe(200);

    act(() => setFilesSidebarWidth(900));
    expect(useLayoutStore.getState().filesSidebarWidth).toBe(400);
  });
});
