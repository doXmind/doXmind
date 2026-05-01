import type { FileItem } from "@/types";
import type { WorkspaceDocumentType } from "@/lib/storage/types";

const PDF_RE = /\.pdf$/i;
const EXCEL_RE = /\.(xlsx|xlsm)$/i;
const ANY_DOC_RE = /\.(md|markdown|pdf|xlsx|xlsm)$/i;

export function documentTypeFromName(name: string): WorkspaceDocumentType {
  if (PDF_RE.test(name)) return "pdf";
  if (EXCEL_RE.test(name)) return "excel";
  return "markdown";
}

export function isPdfFile(file: Pick<FileItem, "name" | "documentType">): boolean {
  return file.documentType === "pdf" || PDF_RE.test(file.name);
}

export function isExcelFile(file: Pick<FileItem, "name" | "documentType">): boolean {
  return file.documentType === "excel" || EXCEL_RE.test(file.name);
}

export function isMarkdownFile(file: Pick<FileItem, "name" | "documentType">): boolean {
  return !isPdfFile(file) && !isExcelFile(file);
}

export function getDisplayName(name: string): string {
  return name.replace(ANY_DOC_RE, "");
}

export function withOriginalExtension(originalName: string, nextBaseName: string): string {
  const extension = originalName.match(ANY_DOC_RE)?.[0] ?? ".md";
  return `${nextBaseName}${extension}`;
}
