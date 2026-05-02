import type { DocumentHandle } from "@/lib/storage";
import type { WorkspaceDocumentType } from "@/lib/storage/types";

export interface FileItem {
  id: string;
  name: string;
  content: string;
  contentMarkdown?: string | null;
  storageHandle?: DocumentHandle;
  documentType?: WorkspaceDocumentType;
  isFolder: boolean;
  parentId: string | null;
  position: number;
  isFavorite: boolean;
  icon: string | null;
  coverImageUrl: string | null;
  coverPosition: number;
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
