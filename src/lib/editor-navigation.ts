"use client";

import { useFileStore } from "@/stores/file-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useEditorStore } from "@/stores/editor-store";

export const EDITOR_LOCATION_CHANGE_EVENT = "doxmind:editor-location-change";

export function editorPath(fileId: string | null): string {
  return fileId ? `/editor/${encodeURIComponent(fileId)}` : "/editor";
}

export function getEditorFileIdFromPathname(pathname?: string): string | null {
  const source = pathname ?? (typeof window !== "undefined" ? window.location.pathname : "/editor");
  const match = source.match(/^\/editor\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function setEditorLocation(fileId: string | null, options?: { replace?: boolean }) {
  if (typeof window === "undefined") return;

  const nextPath = `${editorPath(fileId)}${window.location.search}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current === nextPath) return;

  const method = options?.replace ? "replaceState" : "pushState";
  window.history[method]({ ...window.history.state, doxmindFileId: fileId }, "", nextPath);
  window.dispatchEvent(new CustomEvent(EDITOR_LOCATION_CHANGE_EVENT, { detail: { fileId } }));
}

export async function navigateToEditorFile(
  fileId: string | null,
  options?: { replace?: boolean }
): Promise<boolean> {
  const switched = await useFileStore.getState().requestCurrentFile(fileId);
  if (!switched) return false;
  setEditorLocation(fileId, options);
  return true;
}

/** Navigate to a Page returned by a fresh workspace index, even from standalone-file mode. */
export async function navigateToWorkspacePage(
  fileId: string,
  workspacePath: string
): Promise<boolean> {
  const state = useFileStore.getState();
  const normalizedPath = normalizeWorkspacePath(workspacePath);
  if (!normalizedPath) return false;

  const existing = state.files.find((file) => {
    if (file.isFolder || file.isAsset) return false;
    if (file.id === fileId) return true;
    const candidate = file.storageHandle?.relPath ?? file.storageHandle?.path;
    return candidate ? normalizeWorkspacePath(candidate) === normalizedPath : false;
  });
  if (existing) return navigateToEditorFile(existing.id);

  const absolutePath = absoluteWorkspacePath(state.rootPath, workspacePath);
  if (!absolutePath) return false;
  if (useEditorStore.getState().isDirty) {
    const requestSave = useEditorRefStore.getState().requestSave;
    if (!requestSave || !(await requestSave())) return false;
  }
  await state.openFile(absolutePath);
  return true;
}

function normalizeWorkspacePath(value: string): string | null {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return null;
  const segments = normalized.split("/").filter((segment) => segment && segment !== ".");
  if (!segments.length || segments.includes("..")) return null;
  return segments.join("/").normalize("NFC").toLowerCase();
}

function absoluteWorkspacePath(root: string | null, relative: string): string | null {
  if (!root || !normalizeWorkspacePath(relative)) return null;
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const cleanRoot = root.replace(/[\\/]+$/, "");
  const cleanRelative = relative.replaceAll("\\", "/").replaceAll("/", separator);
  return `${cleanRoot}${separator}${cleanRelative}`;
}
