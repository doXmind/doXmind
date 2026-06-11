"use client";

import { invoke } from "@tauri-apps/api/core";

declare global {
  interface Window {
    __DOXMIND_DESKTOP__?: {
      getPathForFile: (file: File) => string | null;
    };
  }
}

export interface NativeFileFilter {
  name: string;
  extensions: string[];
}

export interface DroppedPath {
  path: string;
  isDirectory: boolean;
}

// Resolve OS-dropped File objects to absolute on-disk paths, tagging each as a
// file or directory. Only works in the desktop shell — the browser has no way
// to learn a dropped file's real path, so it returns []. The path comes from
// the preload bridge (webUtils); the file/dir distinction is stat'd in main.
export async function resolveDroppedFiles(files: File[]): Promise<DroppedPath[]> {
  if (!isNativeDialogAvailable()) return [];
  const getPathForFile = window.__DOXMIND_DESKTOP__?.getPathForFile;
  if (!getPathForFile) return [];
  const resolved = await Promise.all(
    files.map(async (file) => {
      const raw = getPathForFile(file);
      if (!raw) return null;
      return invoke<DroppedPath | null>("resolve_dropped_path", { path: raw });
    })
  );
  return resolved.filter((entry): entry is DroppedPath => entry !== null);
}

export function isNativeDialogAvailable(): boolean {
  return typeof window !== "undefined" && !!window.__TAURI_BACKEND_URL__;
}

export async function pickNativeFolder(title: string): Promise<string | null> {
  if (!isNativeDialogAvailable()) {
    throw new Error("Native folder dialogs require the desktop app.");
  }
  return await invoke<string | null>("pick_workspace_folder", { title });
}

export async function pickNativeFile(
  title: string,
  filters: NativeFileFilter[]
): Promise<string | null> {
  if (!isNativeDialogAvailable()) {
    throw new Error("Native file dialogs require the desktop app.");
  }
  return await invoke<string | null>("pick_workspace_file", { title, filters });
}

export async function pickNativeSaveLocation(
  title: string,
  defaultName: string,
  filters: NativeFileFilter[]
): Promise<string | null> {
  if (!isNativeDialogAvailable()) {
    throw new Error("Native save dialogs require the desktop app.");
  }
  return await invoke<string | null>("pick_save_location", {
    title,
    defaultName,
    filters,
  });
}
