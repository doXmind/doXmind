import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WorkspaceSettingsState {
  /** Folder names skipped when scanning, on top of the built-in list the scanner owns. */
  excludedScanDirs: string[];

  setExcludedScanDirs: (dirs: string[]) => void;
}

export const useWorkspaceSettingsStore = create<WorkspaceSettingsState>()(
  persist(
    (set) => ({
      excludedScanDirs: [],

      setExcludedScanDirs: (dirs) => set({ excludedScanDirs: dirs }),
    }),
    {
      name: "doxmind-workspace-settings",
    }
  )
);

/**
 * Plain directory names, one per line.
 *
 * Anything path-shaped is dropped rather than matched: the scanner compares a single path segment,
 * so `Archive/Old` would silently exclude nothing and read as if it had worked.
 */
export function parseExcludedScanDirs(text: string): string[] {
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const name = line.trim();
    if (!name || name === "." || name === ".." || /[/\\]/.test(name)) continue;
    seen.add(name);
  }
  return [...seen];
}

/** Read outside React, for the storage adapter's scan call. */
export function getExcludedScanDirs(): string[] {
  return useWorkspaceSettingsStore.getState().excludedScanDirs;
}
