import type { FileItem } from "@/types";
import type { WorkspaceDocumentType } from "@/lib/storage/types";

const PDF_RE = /\.pdf$/i;
const EXCEL_RE = /\.(xlsx|xlsm|csv)$/i;
const HTML_RE = /\.html?$/i;
const MARKDOWN_RE = /\.(md|markdown)$/i;
const ANY_DOC_RE = /\.(md|markdown|pdf|xlsx|xlsm|csv|html?)$/i;

export function documentTypeFromName(name: string): WorkspaceDocumentType | null {
  if (MARKDOWN_RE.test(name)) return "markdown";
  if (PDF_RE.test(name)) return "pdf";
  if (EXCEL_RE.test(name)) return "excel";
  if (HTML_RE.test(name)) return "html";
  return null;
}

export function isPdfFile(file: Pick<FileItem, "name" | "documentType">): boolean {
  return file.documentType ? file.documentType === "pdf" : PDF_RE.test(file.name);
}

export function isExcelFile(file: Pick<FileItem, "name" | "documentType">): boolean {
  return file.documentType ? file.documentType === "excel" : EXCEL_RE.test(file.name);
}

export function isHtmlFile(file: Pick<FileItem, "name" | "documentType">): boolean {
  return file.documentType ? file.documentType === "html" : HTML_RE.test(file.name);
}

export function isMarkdownFile(file: Pick<FileItem, "name" | "documentType">): boolean {
  return file.documentType ? file.documentType === "markdown" : MARKDOWN_RE.test(file.name);
}

export function getDisplayName(name: string): string {
  return name.replace(ANY_DOC_RE, "");
}

export function withOriginalExtension(originalName: string, nextBaseName: string): string {
  const extension = originalName.match(ANY_DOC_RE)?.[0] ?? ".md";
  return `${nextBaseName}${extension}`;
}
