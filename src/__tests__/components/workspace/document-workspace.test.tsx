import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentWorkspace } from "@/components/workspace/document-workspace";
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

function renderWorkspace(file: FileItem, isActivePane = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <DocumentWorkspace file={file} isActivePane={isActivePane} />
    </NextIntlClientProvider>
  );
}

describe("DocumentWorkspace", () => {
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
});
