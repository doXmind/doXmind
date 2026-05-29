"use client";

import { useEffect } from "react";

import { useFileStore } from "@/stores/file-store";
import { startWorkspaceWatch, stopWorkspaceWatch } from "@/lib/window";

/**
 * Debounce for the re-scan triggered by a filesystem change. The Rust watcher
 * already coalesces a burst of events into one signal; this coalesces signals
 * that span the watcher's own debounce windows (e.g. a long extraction that
 * emits several batches) into a single `loadFiles`.
 */
const RESCAN_DEBOUNCE_MS = 250;

/**
 * Keeps the folder sidebar in sync with changes made on disk outside doXmind.
 *
 * While a folder is open in the Tauri shell, asks Rust to watch it and re-scans
 * (`loadFiles`) when a `workspace://changed` event arrives for that exact root.
 * No-op in file/welcome modes and in the browser build (no native watcher).
 */
export function WorkspaceWatch() {
  const openTarget = useFileStore((s) => s.openTarget);
  const rootPath = useFileStore((s) => s.rootPath);

  useEffect(() => {
    if (openTarget !== "folder" || !rootPath) return;
    if (typeof window === "undefined" || !("__TAURI_BACKEND_URL__" in window)) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    void startWorkspaceWatch(rootPath);

    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const off = await listen<{ root: string }>("workspace://changed", (event) => {
        // Every window receives the broadcast; act only on our own folder.
        if (event.payload?.root !== rootPath) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          void useFileStore.getState().loadFiles();
        }, RESCAN_DEBOUNCE_MS);
      });
      if (cancelled) off();
      else unlisten = off;
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unlisten?.();
      void stopWorkspaceWatch(rootPath);
    };
  }, [openTarget, rootPath]);

  return null;
}
