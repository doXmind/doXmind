export type {
  DocumentContent,
  DocumentHandle,
  DocumentMeta,
  MarkdownSearchOptions,
  MarkdownSearchResult,
  MarkdownSearchResults,
  PageRelocationInput,
  PageRelocationResult,
  PageRelocationWrite,
  PageRevisionCheck,
  FolderRelocationInput,
  FolderRelocationResult,
  FolderRelocationWrite,
  StorageAdapter,
  StorageCreateInput,
  StorageImportInput,
  StorageWriteInput,
  ImportErrorCode,
  WorkspaceEntry,
  WorkspaceEntryKind,
  WorkspaceDocumentType,
  WorkspaceIndexEntry,
  WorkspaceIndexQuery,
  WorkspaceMode,
  WorkspaceAssetImportInput,
  WorkspaceAssetImportResult,
  WorkspaceAssetRead,
} from "./types";

export { ImportError } from "./types";
export { DiskStorageAdapter, type DiskStorageAdapterOptions } from "./disk-storage-adapter";
export { entriesToWorkspaceIndex, queryWorkspaceIndex, searchMarkdown } from "./search";
export {
  DEFAULT_WORKSPACE_MODE,
  createStorageAdapter,
  getStorageAdapter,
  isWorkspaceMode,
  normalizeWorkspaceMode,
  resetStorageAdapterCache,
  type StorageAdapterSelectionOptions,
} from "./adapter-selection";
