import type { FileItem } from "@/types";
import type { WorkspaceDocumentType } from "@/lib/storage/types";

export function documentTypeFromName(name: string): WorkspaceDocumentType {
  return /\.pdf$/i.test(name) ? "pdf" : "markdown";
}

export function isPdfFile(file: Pick<FileItem, "name" | "documentType">): boolean {
  return file.documentType === "pdf" || /\.pdf$/i.test(file.name);
}

export function isMarkdownFile(file: Pick<FileItem, "name" | "documentType">): boolean {
  return !isPdfFile(file);
}

export function getDisplayName(name: string): string {
  return name.replace(/\.(md|markdown|pdf)$/i, "");
}

export function withOriginalExtension(originalName: string, nextBaseName: string): string {
  const extension = originalName.match(/\.(md|markdown|pdf)$/i)?.[0] ?? ".md";
  return `${nextBaseName}${extension}`;
}
