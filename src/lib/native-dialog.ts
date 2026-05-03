"use client";

import { invoke } from "@tauri-apps/api/core";

export interface NativeFileFilter {
  name: string;
  extensions: string[];
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
