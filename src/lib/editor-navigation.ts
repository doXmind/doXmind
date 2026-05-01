"use client";

import { useFileStore } from "@/stores/file-store";

export const EDITOR_LOCATION_CHANGE_EVENT = "doxmind:editor-location-change";

export function editorPath(fileId: string | null): string {
  return fileId ? `/editor/${encodeURIComponent(fileId)}` : "/editor";
}

export function getEditorFileIdFromPathname(pathname?: string): string | null {
  const source =
    pathname ?? (typeof window !== "undefined" ? window.location.pathname : "/editor");
  const match = source.match(/^\/editor\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function setEditorLocation(fileId: string | null, options?: { replace?: boolean }) {
  if (typeof window === "undefined") return;

  const nextPath = editorPath(fileId);
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current === nextPath) return;

  const method = options?.replace ? "replaceState" : "pushState";
  window.history[method]({ ...window.history.state, doxmindFileId: fileId }, "", nextPath);
  window.dispatchEvent(new CustomEvent(EDITOR_LOCATION_CHANGE_EVENT, { detail: { fileId } }));
}

export function navigateToEditorFile(fileId: string | null, options?: { replace?: boolean }) {
  useFileStore.getState().setCurrentFile(fileId);
  setEditorLocation(fileId, options);
}
