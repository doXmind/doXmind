import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DocumentWorkspace } from "@/components/workspace/document-workspace";
import en from "@/messages/en.json";
import type { FileItem } from "@/stores/file-store";

vi.mock("@/components/workspace/markdown-runtime", () => ({
  MarkdownRuntime: () => <div data-testid="markdown-runtime" />,
}));

vi.mock("@/components/workspace/attachment-workspace", () => ({
  AttachmentWorkspace: ({ onOpenLegacyRecovery }: { onOpenLegacyRecovery?: () => void }) => (
    <div data-testid="attachment-workspace">
      {onOpenLegacyRecovery && <button onClick={onOpenLegacyRecovery}>Recover legacy edits</button>}
    </div>
  ),
}));

vi.mock("@/components/pdf-editor/pdf-editor-workspace", () => ({
  PdfEditorWorkspace: () => <div data-testid="pdf-legacy-recovery" />,
}));

vi.mock("@/components/excel-editor/excel-editor-workspace", () => ({
  ExcelEditorWorkspace: () => <div data-testid="excel-legacy-recovery" />,
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

function renderWorkspace(file: FileItem) {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <DocumentWorkspace file={file} />
    </NextIntlClientProvider>
  );
}

describe("DocumentWorkspace", () => {
  it("routes HTML files through the read-only attachment surface", () => {
    renderWorkspace(htmlFile);

    expect(screen.getByTestId("attachment-workspace")).toBeInTheDocument();
    expect(screen.queryByTestId("markdown-runtime")).not.toBeInTheDocument();
  });

  it("routes PDF files through the read-only attachment surface", () => {
    renderWorkspace(pdfFile);

    expect(screen.getByTestId("attachment-workspace")).toBeInTheDocument();
    expect(screen.queryByTestId("markdown-runtime")).not.toBeInTheDocument();
  });

  it("loads the legacy PDF editor only after an explicit recovery action", async () => {
    const user = userEvent.setup();
    renderWorkspace(pdfFile);

    expect(screen.queryByTestId("pdf-legacy-recovery")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Recover legacy edits" }));

    expect(await screen.findByTestId("pdf-legacy-recovery")).toBeInTheDocument();
    expect(screen.getByText("Legacy recovery mode")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export recovered PDF" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exit recovery" })).toBeInTheDocument();
  });

  it("returns a recovered PDF to its read-only attachment surface", async () => {
    const user = userEvent.setup();
    renderWorkspace(pdfFile);

    await user.click(screen.getByRole("button", { name: "Recover legacy edits" }));
    await user.click(await screen.findByRole("button", { name: "Exit recovery" }));

    expect(screen.getByTestId("attachment-workspace")).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-legacy-recovery")).not.toBeInTheDocument();
  });

  it("exports recovered PDF edits through the legacy editor bridge", async () => {
    const user = userEvent.setup();
    const exportEvents: Event[] = [];
    const handleExport = (event: Event) => exportEvents.push(event);
    window.addEventListener("doxmind:export-pdf", handleExport);

    try {
      renderWorkspace(pdfFile);
      await user.click(screen.getByRole("button", { name: "Recover legacy edits" }));
      await user.click(await screen.findByRole("button", { name: "Export recovered PDF" }));

      expect(exportEvents).toHaveLength(1);
    } finally {
      window.removeEventListener("doxmind:export-pdf", handleExport);
    }
  });

  it("routes spreadsheets through the read-only attachment surface", () => {
    renderWorkspace(excelFile);

    expect(screen.getByTestId("attachment-workspace")).toBeInTheDocument();
    expect(screen.queryByTestId("excel-legacy-recovery")).not.toBeInTheDocument();
  });

  it("exports recovered spreadsheet edits through the legacy editor bridge", async () => {
    const user = userEvent.setup();
    const exportEvents: Event[] = [];
    const handleExport = (event: Event) => exportEvents.push(event);
    window.addEventListener("doxmind:export-xlsx", handleExport);

    try {
      renderWorkspace(excelFile);
      await user.click(screen.getByRole("button", { name: "Recover legacy edits" }));

      expect(await screen.findByTestId("excel-legacy-recovery")).toBeInTheDocument();
      expect(screen.getByText("Legacy recovery mode")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Export recovered spreadsheet" }));

      expect(exportEvents).toHaveLength(1);
    } finally {
      window.removeEventListener("doxmind:export-xlsx", handleExport);
    }
  });
});
