import type { DocumentHandle, DocumentMeta } from "@/lib/storage";
import type { DocumentOutlineItem, WorkspaceDocumentType } from "@/lib/storage/types";

export interface FileItem {
  id: string;
  name: string;
  /** Canonical Markdown for Pages; empty for unloaded entries, folders, and attachments. */
  content: string;
  sourceRevision?: string | null;
  outline?: DocumentOutlineItem[];
  /** Typed projection of Page frontmatter; canonical bytes remain on disk. */
  meta?: DocumentMeta;
  storageHandle?: DocumentHandle;
  documentType?: WorkspaceDocumentType;
  isFolder: boolean;
  parentId: string | null;
  position: number;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  wordCount: number;
  preview: string;
}

export interface SearchResult {
  id: string;
  content: string;
  metadata: {
    file_id: string;
    chunk_index: number;
    start?: number;
    end?: number;
    [key: string]: unknown;
  };
  distance?: number;
}
