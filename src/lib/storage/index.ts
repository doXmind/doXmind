export type {
  DocumentContent,
  DocumentHandle,
  DocumentMeta,
  ExcelCellStyle,
  ExcelEditorState,
  MarkdownSearchOptions,
  MarkdownSearchResult,
  MarkdownSearchResults,
  StorageAdapter,
  StorageCreateInput,
  StorageWriteInput,
  PdfEditorState,
  WorkspaceEntry,
  WorkspaceEntryKind,
  WorkspaceDocumentType,
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
