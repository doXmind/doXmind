import { DiskStorageAdapter, type DiskStorageAdapterOptions } from "./disk-storage-adapter";
import type { StorageAdapter, WorkspaceMode } from "./types";

export const DEFAULT_WORKSPACE_MODE: WorkspaceMode = "disk";

export interface StorageAdapterSelectionOptions {
  mode?: WorkspaceMode | string | null;
  disk?: DiskStorageAdapterOptions;
}

export function isWorkspaceMode(value: unknown): value is WorkspaceMode {
  return value === "disk";
}

export function normalizeWorkspaceMode(value: unknown): WorkspaceMode {
  return isWorkspaceMode(value) ? value : DEFAULT_WORKSPACE_MODE;
}

export function createStorageAdapter(options: StorageAdapterSelectionOptions = {}): StorageAdapter {
  normalizeWorkspaceMode(options.mode);
  return new DiskStorageAdapter(options.disk);
}

export function getStorageAdapter(mode?: WorkspaceMode | string | null): StorageAdapter {
  normalizeWorkspaceMode(mode);
  return new DiskStorageAdapter();
}

export function resetStorageAdapterCache(): void {
  // Disk adapters carry their workspace root, so callers should create fresh instances.
}
