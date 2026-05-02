import { useFileStore } from "@/stores/file-store";
import type { FileItem } from "@/types";

// Build the absolute on-disk path for a FileItem so we can hand it to
// `revealItemInDir`. The active storage root lives at `rootPath` regardless
// of whether a folder is mounted or a single file is open.
export function absolutePathForFile(file: FileItem): string | null {
  const state = useFileStore.getState();
  const root = state.rootPath;
  if (!root) return null;
  const relPath = file.storageHandle?.relPath || file.storageHandle?.path;
  if (!relPath) return null;
  const trimmedRoot = root.replace(/[/\\]+$/, "");
  const trimmedRel = relPath.replace(/^[/\\]+/, "");
  return `${trimmedRoot}/${trimmedRel}`;
}

export async function revealFileInFinder(file: FileItem): Promise<void> {
  const path = absolutePathForFile(file);
  if (!path) throw new Error("File has no absolute path to reveal");
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}

export async function revealPathInFinder(path: string): Promise<void> {
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}
