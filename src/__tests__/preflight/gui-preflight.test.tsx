import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopEditor } from "@/app/editor/[[...fileId]]/_components/desktop-editor";
import { CustomBlockExtensions } from "@/extensions/registry";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";

const { headingState } = vi.hoisted(() => ({
  headingState: {
    headings: [] as Array<{ id: string; level: number; text: string }>,
  },
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

vi.mock("@/components/workspace/markdown-runtime", () => ({
  MarkdownRuntime: ({
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

vi.mock("@/components/editor/mindlines/use-headings", () => ({
  useHeadings: () => ({
    headings: headingState.headings,
    activeId: headingState.headings[0]?.id ?? null,
    navigateTo: vi.fn(),
  }),
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

vi.mock("@/stores/editor-ref-store", () => ({
  useEditorRefStore: (
    selector?: (state: { editor: null; setEditor: (editor: unknown) => void }) => unknown
  ) => {
    const state = {
      editor: null,
      setEditor: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

const now = "2026-05-06T00:00:00.000Z";

const ALL_GUI_BLOCK_FIXTURES = [
  { id: "text", customBlockType: null, html: '<p data-preflight-block="text">Text</p>' },
  { id: "heading-1", customBlockType: null, html: '<h1 data-preflight-block="heading-1">H1</h1>' },
  { id: "heading-2", customBlockType: null, html: '<h2 data-preflight-block="heading-2">H2</h2>' },
  { id: "heading-3", customBlockType: null, html: '<h3 data-preflight-block="heading-3">H3</h3>' },
  { id: "heading-4", customBlockType: null, html: '<h4 data-preflight-block="heading-4">H4</h4>' },
  { id: "heading-5", customBlockType: null, html: '<h5 data-preflight-block="heading-5">H5</h5>' },
  { id: "heading-6", customBlockType: null, html: '<h6 data-preflight-block="heading-6">H6</h6>' },
  {
    id: "quote",
    customBlockType: null,
    html: '<blockquote data-preflight-block="quote"><p>Quote</p></blockquote>',
  },
  {
    id: "bullet-list",
    customBlockType: null,
    html: '<ul data-preflight-block="bullet-list"><li><p>Bullet</p></li></ul>',
  },
  {
    id: "ordered-list",
    customBlockType: null,
    html: '<ol data-preflight-block="ordered-list"><li><p>Ordered</p></li></ol>',
  },
  {
    id: "task-list",
    customBlockType: null,
    html: '<ul data-type="taskList" data-preflight-block="task-list"><li data-type="taskItem" data-checked="true"><p>Task</p></li></ul>',
  },
  { id: "divider", customBlockType: null, html: '<hr data-preflight-block="divider">' },
  {
    id: "table",
    customBlockType: null,
    html: '<table data-preflight-block="table"><tbody><tr><th>Column</th></tr><tr><td>Value</td></tr></tbody></table>',
  },
  {
    id: "image",
    customBlockType: null,
    html: '<img data-preflight-block="image" src="assets/diagram.png" alt="Diagram">',
  },
  {
    id: "code-block",
    customBlockType: null,
    html: '<pre data-preflight-block="code-block"><code>console.log("preflight")</code></pre>',
  },
  {
    id: "columns-2",
    customBlockType: null,
    html: '<div data-columns="2" data-preflight-block="columns-2"><div data-column><p>Left</p></div><div data-column><p>Right</p></div></div>',
  },
  {
    id: "columns-3",
    customBlockType: null,
    html: '<div data-columns="3" data-preflight-block="columns-3"><div data-column><p>A</p></div><div data-column><p>B</p></div><div data-column><p>C</p></div></div>',
  },
  {
    id: "columns-4",
    customBlockType: null,
    html: '<div data-columns="4" data-preflight-block="columns-4"><div data-column><p>A</p></div><div data-column><p>B</p></div><div data-column><p>C</p></div><div data-column><p>D</p></div></div>',
  },
  {
    id: "toc",
    customBlockType: null,
    html: '<div data-type="table-of-contents" data-preflight-block="toc">Table of Contents</div>',
  },
  {
    id: "web-bookmark",
    customBlockType: null,
    html: '<div data-type="web-bookmark" data-url="https://example.com" data-title="Example" data-preflight-block="web-bookmark">Example</div>',
  },
  {
    id: "pdf-block",
    customBlockType: "pdf-block",
    html: '<div data-type="pdf-block" data-id="pdf-1" data-src="assets/spec.pdf" data-preflight-block="pdf-block">PDF</div>',
  },
  {
    id: "excel-block",
    customBlockType: "excel-block",
    html: '<div data-type="excel-block" data-id="excel-1" data-src="assets/budget.xlsx" data-preflight-block="excel-block">Excel</div>',
  },
  {
    id: "mermaid",
    customBlockType: "mermaid",
    html: '<div data-type="mermaid-chart" data-code="graph TD; A-->B" data-preflight-block="mermaid"></div>',
  },
  {
    id: "callout",
    customBlockType: "callout",
    html: '<div data-callout-type="info" data-preflight-block="callout"><p>Callout</p></div>',
  },
  {
    id: "inline-math",
    customBlockType: "math",
    html: '<span data-type="inline-math" data-latex="x^2" data-preflight-block="inline-math">x^2</span>',
  },
  {
    id: "block-math",
    customBlockType: "math",
    html: '<div data-type="block-math" data-latex="E = mc^2" data-preflight-block="block-math">E = mc^2</div>',
  },
  {
    id: "toggle",
    customBlockType: "toggle",
    html: '<div data-toggle-open="true" data-preflight-block="toggle"><div data-toggle-summary><p>Toggle</p></div><div data-toggle-body><p>Body</p></div></div>',
  },
  {
    id: "page-link",
    customBlockType: "page-link",
    html: '<div data-type="page-link" data-page-id="doc-2" data-page-title="Linked Page" data-preflight-block="page-link">Linked Page</div>',
  },
] as const;

function file(overrides: Partial<FileItem>): FileItem {
  return {
    id: "doc-1",
    name: "Project.md",
    content: "<h1>Project</h1><p>Draft</p>",
    contentMarkdown: "# Project\n\nDraft",
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

function allBlocksHtml() {
  return ALL_GUI_BLOCK_FIXTURES.map((fixture) => fixture.html).join("\n");
}

function resetGuiState() {
  headingState.headings = [];
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
    headingState.headings = [{ id: "h-1", level: 1, text: "Project" }];
    useFileStore.setState({
      openTarget: "folder",
      rootPath: "/tmp/notes",
      currentFileId: "doc-1",
      files: [file({ id: "doc-1", name: "Project.md", documentType: "markdown" })],
      loadedContentIds: new Set(["doc-1"]),
      isSynced: true,
    });

    render(<DesktopEditor />);

    expect(screen.getByTestId("outline-collapsed")).toHaveTextContent("Project");
    expect(screen.getByTestId("document-workspace")).toHaveAttribute(
      "data-reserved-right-inset",
      expect.stringMatching(/^[1-9]\d*$/)
    );
  });

  it("loads a markdown document fixture containing every supported block", () => {
    const expectedCustomBlockTypes = Object.keys(CustomBlockExtensions).sort();
    const fixtureCustomBlockTypes = Array.from(
      new Set(
        ALL_GUI_BLOCK_FIXTURES.flatMap((fixture) =>
          fixture.customBlockType ? [fixture.customBlockType] : []
        )
      )
    ).sort();

    expect(fixtureCustomBlockTypes).toEqual(expectedCustomBlockTypes);

    useFileStore.setState({
      openTarget: "folder",
      rootPath: "/tmp/notes",
      currentFileId: "all-blocks",
      files: [
        file({
          id: "all-blocks",
          name: "All Blocks.md",
          documentType: "markdown",
          content: allBlocksHtml(),
        }),
      ],
      loadedContentIds: new Set(["all-blocks"]),
      isSynced: true,
    });

    render(<DesktopEditor />);

    for (const { id } of ALL_GUI_BLOCK_FIXTURES) {
      expect(
        screen.getByTestId("document-blocks").querySelector(`[data-preflight-block="${id}"]`)
      ).toBeInTheDocument();
    }
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
