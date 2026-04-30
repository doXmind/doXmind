export type {
  DocumentContent,
  DocumentHandle,
  StorageAdapter,
  StorageCreateInput,
  StorageWriteInput,
  WorkspaceEntry,
  WorkspaceEntryKind,
  WorkspaceMode,
} from "./types";

export { DbStorageAdapter, type DbStorageAdapterOptions } from "./db-storage-adapter";
export { DiskStorageAdapter, type DiskStorageAdapterOptions } from "./disk-storage-adapter";
export {
  DEFAULT_WORKSPACE_MODE,
  createStorageAdapter,
  getStorageAdapter,
  isWorkspaceMode,
  normalizeWorkspaceMode,
  resetStorageAdapterCache,
  type StorageAdapterSelectionOptions,
} from "./adapter-selection";
