export type WorkspaceMode = "db" | "disk";

export type WorkspaceEntryKind = "document" | "folder";

export interface DocumentHandle {
  mode: WorkspaceMode;
  id: string;
  kind?: WorkspaceEntryKind;
  path?: string | null;
  relPath?: string | null;
}

export interface DocumentContent {
  handle: DocumentHandle;
  name: string;
  html: string;
  markdown: string | null;
  meta?: DocumentMeta;
  extras?: unknown;
  source?: "sidecar" | "markdown" | "empty";
  updatedAt: string;
}

export interface DocumentMeta {
  id: string;
  title?: string | null;
  icon?: string | null;
  favorite?: boolean | null;
  cover?: string | null;
  created?: string | null;
  updated?: string | null;
  [key: string]: unknown;
}

export interface WorkspaceEntry {
  handle: DocumentHandle;
  kind: WorkspaceEntryKind;
  name: string;
  parent: DocumentHandle | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  preview?: string;
  wordCount?: number;
  isFavorite?: boolean;
  icon?: string | null;
  coverImageUrl?: string | null;
  coverPosition?: number;
}

export interface StorageWriteInput {
  html?: string;
  markdown?: string | null;
  name?: string;
  meta?: DocumentMeta;
  extras?: unknown;
}

export interface StorageCreateInput {
  name: string;
  kind?: WorkspaceEntryKind;
  parent?: DocumentHandle | null;
  content?: StorageWriteInput;
}

export interface WorkspaceIndexQuery {
  query?: string;
  limit?: number;
  includeFolders?: boolean;
}

export interface WorkspaceIndexEntry {
  handle: DocumentHandle;
  id: string;
  kind: WorkspaceEntryKind;
  name: string;
  title: string;
  path?: string | null;
  parent: DocumentHandle | null;
  preview?: string;
  icon?: string | null;
  updatedAt: string;
}

export interface MarkdownSearchOptions {
  fileIds?: string[];
  limit?: number;
  signal?: AbortSignal;
}

export interface MarkdownSearchResult {
  id: string;
  content: string;
  metadata: {
    fileId: string;
    name?: string;
    path?: string | null;
    start?: number;
    end?: number;
    chunkIndex?: number;
  };
  score?: number;
}

export interface MarkdownSearchResults {
  results: MarkdownSearchResult[];
}

export interface StorageAdapter {
  readonly mode: WorkspaceMode;

  list(parent?: DocumentHandle | null): Promise<WorkspaceEntry[]>;
  read(handle: DocumentHandle): Promise<DocumentContent>;
  write(handle: DocumentHandle, content: StorageWriteInput): Promise<DocumentContent>;
  create(input: StorageCreateInput): Promise<WorkspaceEntry>;
  rename(handle: DocumentHandle, name: string): Promise<WorkspaceEntry>;
  move(handle: DocumentHandle, parent: DocumentHandle | null): Promise<WorkspaceEntry>;
  delete(handle: DocumentHandle): Promise<void>;
  queryWorkspaceIndex?(query?: WorkspaceIndexQuery): Promise<WorkspaceIndexEntry[]>;
  searchMarkdown?(query: string, options?: MarkdownSearchOptions): Promise<MarkdownSearchResults>;
}
