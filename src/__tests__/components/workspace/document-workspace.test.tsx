import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentWorkspace } from "@/components/workspace/document-workspace";
import en from "@/messages/en.json";
import type { FileItem } from "@/stores/file-store";

vi.mock("@/components/workspace/markdown-runtime", () => ({
  MarkdownRuntime: () => <div data-testid="markdown-runtime" />,
}));

vi.mock("@/components/workspace/attachment-workspace", () => ({
  AttachmentWorkspace: () => <div data-testid="attachment-workspace" />,
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

const otherAttachment: FileItem = {
  ...htmlFile,
  id: "path:reference.docx",
  name: "reference.docx",
  documentType: "other",
  storageHandle: {
    ...htmlFile.storageHandle!,
    id: "path:reference.docx",
    documentType: "other",
    path: "reference.docx",
    relPath: "reference.docx",
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

  it("never mounts the legacy PDF editor", () => {
    renderWorkspace(pdfFile);

    expect(screen.getByTestId("attachment-workspace")).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-legacy-recovery")).not.toBeInTheDocument();
  });

  it("routes spreadsheets through the read-only attachment surface", () => {
    renderWorkspace(excelFile);

    expect(screen.getByTestId("attachment-workspace")).toBeInTheDocument();
    expect(screen.queryByTestId("excel-legacy-recovery")).not.toBeInTheDocument();
  });

  it("never mounts the legacy spreadsheet editor", () => {
    renderWorkspace(excelFile);

    expect(screen.getByTestId("attachment-workspace")).toBeInTheDocument();
    expect(screen.queryByTestId("excel-legacy-recovery")).not.toBeInTheDocument();
  });

  it("routes unknown non-Markdown files through the read-only attachment surface", () => {
    renderWorkspace(otherAttachment);

    expect(screen.getByTestId("attachment-workspace")).toBeInTheDocument();
    expect(screen.queryByTestId("markdown-runtime")).not.toBeInTheDocument();
  });
});
