import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopEditor } from "@/app/editor/[[...fileId]]/_components/desktop-editor";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { usePageSessionStore } from "@/stores/page-session-store";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

vi.mock("@/components/sidebar/files-sidebar", () => ({
  FilesSidebar: () => <div data-testid="files-sidebar" />,
}));

vi.mock("@/components/welcome-screen", () => ({
  WelcomeScreen: () => <div data-testid="welcome-screen" />,
}));

vi.mock("@/components/workspace/workspace-home", () => ({
  WorkspaceHome: () => <div data-testid="workspace-home" />,
}));

vi.mock("@/editor/page-editor-host", () => ({
  PageEditorHost: ({
    file,
    reservedRightInset,
  }: {
    file: FileItem;
    reservedRightInset?: number;
  }) => (
    <div
      data-testid="document-workspace"
      data-document-type="markdown"
      data-reserved-right-inset={reservedRightInset ?? 0}
    >
      {file.name}
      <div data-testid="document-blocks" dangerouslySetInnerHTML={{ __html: file.content }} />
    </div>
  ),
}));

vi.mock("@/components/workspace/attachment-workspace", () => ({
  AttachmentWorkspace: ({ file }: { file: FileItem }) => {
    const [lastAction, setLastAction] = React.useState("");

    return (
      <div
        data-testid="document-workspace"
        data-document-type="attachment"
        data-attachment-type={file.documentType}
        data-attachment-name={file.name}
      >
        <h2>{file.name}</h2>
        <div>Read-only attachment</div>
        <button type="button" onClick={() => setLastAction("opened externally")}>
          Open externally
        </button>
        <button type="button" onClick={() => setLastAction("revealed in folder")}>
          Reveal
        </button>
        <output aria-label="Attachment action">{lastAction}</output>
      </div>
    );
  },
}));

vi.mock("@/components/editor/unified-header", () => ({
  UnifiedHeader: () => <div data-testid="unified-header" />,
}));

vi.mock("@/components/editor/mindlines/outline-collapsed", () => ({
  OutlineCollapsed: ({ headings }: { headings: Array<{ text: string }> }) => (
    <div data-testid="outline-collapsed">{headings.map((heading) => heading.text).join(", ")}</div>
  ),
}));

vi.mock("@/components/ui/resize-handle", () => ({
  ResizeHandle: ({ onDoubleClick }: { onDoubleClick: () => void }) => (
    <button type="button" data-testid="resize-handle" onDoubleClick={onDoubleClick}>
      resize
    </button>
  ),
}));

const now = "2026-05-06T00:00:00.000Z";

function file(overrides: Partial<FileItem>): FileItem {
  return {
    id: "doc-1",
    name: "Project.md",
    content: "# Project\n\nDraft",
    isFolder: false,
    parentId: null,
    position: 0,
    isFavorite: false,
    createdAt: now,
    updatedAt: now,
    wordCount: 2,
    preview: "Draft",
    storageHandle: { mode: "disk", id: "doc-1", kind: "document", relPath: "Project.md" },
    documentType: "markdown",
    ...overrides,
  };
}

function resetGuiState() {
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
  usePageSessionStore.setState({ outlineSession: null });
}

describe("GUI preflight", () => {
  beforeEach(() => {
    resetGuiState();
  });

  it("starts at the welcome surface before a local target is opened", () => {
    render(<DesktopEditor />);

    expect(screen.getByTestId("unified-header")).toBeInTheDocument();
    expect(screen.getByTestId("welcome-screen")).toBeInTheDocument();
    expect(screen.queryByTestId("files-sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("document-workspace")).not.toBeInTheDocument();
  });

  it("keeps the file tree and workspace home visible for an opened folder with no selection", () => {
    useFileStore.setState({
      openTarget: "folder",
      rootPath: "/tmp/notes",
      files: [],
      currentFileId: null,
      isSynced: true,
    });

    render(<DesktopEditor />);

    expect(screen.getByTestId("files-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("resize-handle")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-home")).toBeInTheDocument();
    expect(screen.queryByTestId("welcome-screen")).not.toBeInTheDocument();
  });

  it("shows a loading placeholder until the selected file content has hydrated", () => {
    useFileStore.setState({
      openTarget: "folder",
      rootPath: "/tmp/notes",
      currentFileId: "doc-1",
      files: [file({ id: "doc-1" })],
      loadedContentIds: new Set(),
      isSynced: true,
    });

    render(<DesktopEditor />);

    expect(screen.getByTestId("markdown-skeleton")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("document-workspace")).not.toBeInTheDocument();
  });

  it.each([
    ["markdown", "Project.md", "markdown"],
    ["pdf", "Quarterly Review.pdf", "attachment"],
    ["excel", "Budget.xlsx", "attachment"],
    ["html", "Archive.html", "attachment"],
  ] as const)(
    "routes a hydrated %s file into the document workspace",
    async (documentType, name, workspaceType) => {
      useFileStore.setState({
        openTarget: "folder",
        rootPath: "/tmp/notes",
        currentFileId: `doc-${documentType}`,
        files: [file({ id: `doc-${documentType}`, name, documentType })],
        loadedContentIds: new Set([`doc-${documentType}`]),
        isSynced: true,
      });

      render(<DesktopEditor />);

      const workspace = await screen.findByTestId("document-workspace");
      expect(workspace).toHaveAttribute("data-document-type", workspaceType);
      expect(workspace).toHaveTextContent(name);
      if (workspaceType === "attachment") {
        expect(workspace).toHaveAttribute("data-attachment-type", documentType);
        expect(workspace).toHaveAttribute("data-attachment-name", name);
      }
      expect(screen.queryByTestId("markdown-skeleton")).not.toBeInTheDocument();
    }
  );

  it("reserves right gutter and exposes the collapsed outline for markdown headings", () => {
    useFileStore.setState({
      openTarget: "folder",
      rootPath: "/tmp/notes",
      currentFileId: "doc-1",
      files: [file({ id: "doc-1", name: "Project.md", documentType: "markdown" })],
      loadedContentIds: new Set(["doc-1"]),
      isSynced: true,
    });
    usePageSessionStore.setState({
      outlineSession: {
        pageId: "doc-1",
        headings: [{ id: "h-1", level: 1, text: "Project", pos: 0 }],
        activeId: "h-1",
        navigateTo: vi.fn(),
      },
    });

    render(<DesktopEditor />);

    expect(screen.getByTestId("outline-collapsed")).toHaveTextContent("Project");
    expect(screen.getByTestId("document-workspace")).toHaveAttribute(
      "data-reserved-right-inset",
      expect.stringMatching(/^[1-9]\d*$/)
    );
  });

  it("opens and reveals an Excel attachment without exposing editing controls", async () => {
    const user = userEvent.setup();
    useFileStore.setState({
      openTarget: "folder",
      rootPath: "/tmp/finance",
      currentFileId: "budget",
      files: [
        file({
          id: "budget",
          name: "Q1 Budget Review.xlsx",
          documentType: "excel",
          storageHandle: {
            mode: "disk",
            id: "budget",
            kind: "document",
            relPath: "Q1 Budget Review.xlsx",
          },
        }),
      ],
      loadedContentIds: new Set(["budget"]),
      isSynced: true,
    });

    render(<DesktopEditor />);

    const workspace = screen.getByTestId("document-workspace");
    expect(workspace).toHaveAttribute("data-document-type", "attachment");
    expect(workspace).toHaveAttribute("data-attachment-type", "excel");
    expect(workspace).toHaveTextContent("Read-only attachment");

    await user.click(screen.getByRole("button", { name: /open externally/i }));
    expect(screen.getByLabelText("Attachment action")).toHaveTextContent("opened externally");

    await user.click(screen.getByRole("button", { name: /reveal/i }));
    expect(screen.getByLabelText("Attachment action")).toHaveTextContent("revealed in folder");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /format|comment|freeze|export/i })
    ).not.toBeInTheDocument();
  });

  it("opens and reveals a PDF attachment without exposing editing controls", async () => {
    const user = userEvent.setup();
    useFileStore.setState({
      openTarget: "folder",
      rootPath: "/tmp/legal",
      currentFileId: "contract",
      files: [
        file({
          id: "contract",
          name: "Vendor Contract.pdf",
          documentType: "pdf",
          storageHandle: {
            mode: "disk",
            id: "contract",
            kind: "document",
            relPath: "Vendor Contract.pdf",
          },
        }),
      ],
      loadedContentIds: new Set(["contract"]),
      isSynced: true,
    });

    render(<DesktopEditor />);

    const workspace = screen.getByTestId("document-workspace");
    expect(workspace).toHaveAttribute("data-document-type", "attachment");
    expect(workspace).toHaveAttribute("data-attachment-type", "pdf");
    expect(workspace).toHaveTextContent("Read-only attachment");

    await user.click(screen.getByRole("button", { name: /open externally/i }));
    expect(screen.getByLabelText("Attachment action")).toHaveTextContent("opened externally");

    await user.click(screen.getByRole("button", { name: /reveal/i }));
    expect(screen.getByLabelText("Attachment action")).toHaveTextContent("revealed in folder");
    expect(
      screen.queryByRole("button", { name: /next page|add text|highlight|export/i })
    ).not.toBeInTheDocument();
  });

  it("hides chrome in focus mode and lets the user exit focus mode", async () => {
    const user = userEvent.setup();
    useLayoutStore.setState({ isFocusMode: true });
    useFileStore.setState({
      openTarget: "folder",
      rootPath: "/tmp/notes",
      currentFileId: "doc-1",
      files: [file({ id: "doc-1" })],
      loadedContentIds: new Set(["doc-1"]),
      isSynced: true,
    });

    render(<DesktopEditor />);

    expect(screen.queryByTestId("unified-header")).not.toBeInTheDocument();
    expect(screen.queryByTestId("files-sidebar")).not.toBeInTheDocument();
    expect(screen.getByTestId("document-workspace")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /exit focus mode/i }));

    expect(useLayoutStore.getState().isFocusMode).toBe(false);
  });
});
