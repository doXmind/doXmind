import { DbStorageAdapter, type DbStorageAdapterOptions } from "./db-storage-adapter";
import { DiskStorageAdapter, type DiskStorageAdapterOptions } from "./disk-storage-adapter";
import type { StorageAdapter, WorkspaceMode } from "./types";

export const DEFAULT_WORKSPACE_MODE: WorkspaceMode = "disk";

export interface StorageAdapterSelectionOptions {
  mode?: WorkspaceMode | string | null;
  db?: DbStorageAdapterOptions;
  disk?: DiskStorageAdapterOptions;
}

const adapterCache = new Map<WorkspaceMode, StorageAdapter>();

export function isWorkspaceMode(value: unknown): value is WorkspaceMode {
  return value === "db" || value === "disk";
}

export function normalizeWorkspaceMode(value: unknown): WorkspaceMode {
  return isWorkspaceMode(value) ? value : DEFAULT_WORKSPACE_MODE;
}

export function createStorageAdapter(options: StorageAdapterSelectionOptions = {}): StorageAdapter {
  const mode = normalizeWorkspaceMode(options.mode);

  if (mode === "disk") {
    return new DiskStorageAdapter(options.disk);
  }

  return new DbStorageAdapter(options.db);
}

export function getStorageAdapter(mode?: WorkspaceMode | string | null): StorageAdapter {
  const normalizedMode = normalizeWorkspaceMode(mode);
  if (normalizedMode === "disk") {
    return new DiskStorageAdapter();
  }
  const cached = adapterCache.get(normalizedMode);

  if (cached) {
    return cached;
  }

  const adapter = createStorageAdapter({ mode: normalizedMode });
  adapterCache.set(normalizedMode, adapter);
  return adapter;
}

export function resetStorageAdapterCache(): void {
  adapterCache.clear();
}
