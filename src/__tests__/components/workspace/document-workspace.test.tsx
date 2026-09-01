import { NextIntlClientProvider } from "next-intl";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  DocumentWorkspace,
  type PageRecoveryServices,
} from "@/components/workspace/document-workspace";
import en from "@/messages/en.json";
import type { FileItem } from "@/stores/file-store";

vi.mock("@/editor/page-editor-host", () => ({
  PageEditorHost: () => <div data-testid="native-page-editor" />,
}));

vi.mock("@/components/workspace/attachment-workspace", () => ({
  AttachmentWorkspace: () => <div data-testid="attachment-workspace" />,
}));

const htmlFile: FileItem = {
  id: "path:index.html",
  name: "index.html",
  content: "<h1>Hello</h1>",
  isFolder: false,
  parentId: null,
  position: 0,
  isFavorite: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  wordCount: 0,
  preview: "",
  documentType: "html",
  storageHandle: {
    mode: "disk",
    id: "path:index.html",
    kind: "document",
    documentType: "html",
    path: "index.html",
    relPath: "index.html",
  },
};

const pdfFile: FileItem = {
  ...htmlFile,
  id: "path:spec.pdf",
  name: "Spec",
  documentType: "pdf",
  storageHandle: {
    ...htmlFile.storageHandle!,
    id: "path:spec.pdf",
    documentType: "pdf",
    path: "Spec.pdf",
    relPath: "Spec.pdf",
  },
};

const excelFile: FileItem = {
  ...pdfFile,
  id: "path:budget.xlsx",
  name: "Budget",
  documentType: "excel",
  storageHandle: {
    ...pdfFile.storageHandle!,
    id: "path:budget.xlsx",
    documentType: "excel",
    path: "Budget.xlsx",
    relPath: "Budget.xlsx",
  },
};

const markdownFile: FileItem = {
  ...htmlFile,
  id: "page-1",
  name: "Page",
  content: "# Page\n",
  documentType: "markdown",
  storageHandle: {
    ...htmlFile.storageHandle!,
    id: "page-1",
    documentType: "markdown",
    path: "Notes/Page.md",
    relPath: "Notes/Page.md",
  },
};

function renderWorkspace(file: FileItem, isActivePane = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <DocumentWorkspace file={file} isActivePane={isActivePane} />
    </NextIntlClientProvider>
  );
}

describe("DocumentWorkspace", () => {
  it("offers version history in the focused pane only", () => {
    // Snapshots come from the Electron write path, so the panel renders nothing without it.
    vi.stubGlobal("__DOXMIND_DESKTOP__", {
      platform: "macos",
      invoke: vi.fn(),
      listen: vi.fn(),
      getPathForFile: vi.fn(() => null),
    });
    try {
      const { unmount } = renderWorkspace(markdownFile);
      expect(screen.getByRole("button", { name: "History" })).toBeInTheDocument();
      unmount();

      // Its open state is one global flag, so a second copy would open in both panes at
      // once, each listing a different Page.
      renderWorkspace(markdownFile, false);
      expect(screen.queryByRole("button", { name: "History" })).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("routes HTML files through the read-only attachment surface", () => {
    renderWorkspace(htmlFile);

    expect(screen.getByTestId("attachment-workspace")).toBeInTheDocument();
    expect(screen.queryByTestId("native-page-editor")).not.toBeInTheDocument();
  });

  it("routes PDF files through the read-only attachment surface", () => {
    renderWorkspace(pdfFile);

    expect(screen.getByTestId("attachment-workspace")).toBeInTheDocument();
    expect(screen.queryByTestId("native-page-editor")).not.toBeInTheDocument();
  });

  it("routes spreadsheets through the read-only attachment surface", () => {
    renderWorkspace(excelFile);

    expect(screen.getByTestId("attachment-workspace")).toBeInTheDocument();
    expect(screen.queryByTestId("excel-legacy-recovery")).not.toBeInTheDocument();
  });

  it("never routes an unknown extension into the Page editor", () => {
    renderWorkspace({
      ...htmlFile,
      id: "path:report.docx",
      name: "Report.docx",
      documentType: undefined,
      storageHandle: {
        ...htmlFile.storageHandle!,
        id: "path:report.docx",
        documentType: undefined,
        path: "Report.docx",
        relPath: "Report.docx",
      },
    });

    expect(screen.getByTestId("unsupported-attachment")).toBeInTheDocument();
    expect(screen.queryByTestId("native-page-editor")).not.toBeInTheDocument();
  });

  it("does not mount legacy attachment editor stacks", () => {
    const { rerender } = renderWorkspace(pdfFile);
    expect(screen.getByTestId("attachment-workspace")).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <DocumentWorkspace file={excelFile} />
      </NextIntlClientProvider>
    );
    expect(screen.getByTestId("attachment-workspace")).toBeInTheDocument();
  });

  it("shows Page recovery artifacts and offers an explicit export", async () => {
    const user = userEvent.setup();
    const services: PageRecoveryServices = {
      inspect: vi.fn().mockResolvedValue({
        recoveryStatus: "available",
        artifacts: ["Notes/.Page.doxmind", "Notes/.Page.doxmind.lock"],
      }),
      exportRecovery: vi.fn().mockResolvedValue(undefined),
    };

    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <DocumentWorkspace file={markdownFile} pageRecoveryServices={services} />
      </NextIntlClientProvider>
    );

    expect(services.inspect).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Check legacy recovery" }));
    expect(await screen.findByText("Legacy Page recovery artifacts found")).toBeInTheDocument();
    expect(screen.getByText(/Notes\/.Page\.doxmind/)).toBeInTheDocument();
    expect(screen.getByTestId("native-page-editor")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Export Page recovery report" }));
    expect(services.exportRecovery).toHaveBeenCalledWith("Notes/Page.md");
  });

  it("does not re-inspect recovery artifacts when only Page content changes", async () => {
    const services: PageRecoveryServices = {
      inspect: vi.fn().mockResolvedValue({ recoveryStatus: "none", artifacts: [] }),
      exportRecovery: vi.fn().mockResolvedValue(undefined),
    };
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <DocumentWorkspace file={markdownFile} pageRecoveryServices={services} />
      </NextIntlClientProvider>
    );
    const user = userEvent.setup();
    expect(services.inspect).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Check legacy recovery" }));
    await waitFor(() => expect(services.inspect).toHaveBeenCalledTimes(1));

    rerender(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <DocumentWorkspace
          file={{ ...markdownFile, content: "# Page\n\nAutosaved" }}
          pageRecoveryServices={services}
        />
      </NextIntlClientProvider>
    );

    await waitFor(() => expect(screen.getByTestId("native-page-editor")).toBeInTheDocument());
    expect(services.inspect).toHaveBeenCalledTimes(1);
  });

  it("keeps an ordinary Markdown Page free of recovery UI", async () => {
    const services: PageRecoveryServices = {
      inspect: vi.fn().mockResolvedValue({ recoveryStatus: "none", artifacts: [] }),
      exportRecovery: vi.fn().mockResolvedValue(undefined),
    };

    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <DocumentWorkspace file={markdownFile} pageRecoveryServices={services} />
      </NextIntlClientProvider>
    );

    expect(services.inspect).not.toHaveBeenCalled();
    expect(screen.queryByTestId("page-legacy-recovery")).not.toBeInTheDocument();
    expect(screen.getByTestId("native-page-editor")).toBeInTheDocument();
  });

  it("exposes portable Page properties and backlinks only on Markdown Pages", async () => {
    const services: PageRecoveryServices = {
      inspect: vi.fn().mockResolvedValue({ recoveryStatus: "none", artifacts: [] }),
      exportRecovery: vi.fn().mockResolvedValue(undefined),
    };
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <DocumentWorkspace file={markdownFile} pageRecoveryServices={services} />
      </NextIntlClientProvider>
    );

    expect(screen.getByRole("button", { name: "Page properties" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Backlinks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check legacy recovery" })).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <DocumentWorkspace file={pdfFile} pageRecoveryServices={services} />
      </NextIntlClientProvider>
    );
    expect(screen.queryByRole("button", { name: "Page properties" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Backlinks" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check legacy recovery" })).not.toBeInTheDocument();
  });

  it("keeps Page editing available when advisory recovery inspection fails", async () => {
    const user = userEvent.setup();
    const services: PageRecoveryServices = {
      inspect: vi.fn().mockRejectedValue(new Error("artifact is unsafe")),
      exportRecovery: vi.fn().mockResolvedValue(undefined),
    };

    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <DocumentWorkspace file={markdownFile} pageRecoveryServices={services} />
      </NextIntlClientProvider>
    );

    expect(services.inspect).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Check legacy recovery" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not check legacy recovery");
    expect(screen.queryByTestId("page-legacy-recovery")).not.toBeInTheDocument();
    expect(screen.getByTestId("native-page-editor")).toBeInTheDocument();
  });
});
