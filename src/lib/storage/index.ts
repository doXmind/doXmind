export type {
  DocumentContent,
  DocumentHandle,
  DocumentMeta,
  MarkdownSearchOptions,
  MarkdownSearchResult,
  MarkdownSearchResults,
  StorageAdapter,
  StorageCreateInput,
  StorageWriteInput,
  WorkspaceEntry,
  WorkspaceEntryKind,
  WorkspaceIndexEntry,
  WorkspaceIndexQuery,
  WorkspaceMode,
} from "./types";

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
