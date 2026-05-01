"use client";

import { useEffect, useRef } from "react";
import {
  EDITOR_LOCATION_CHANGE_EVENT,
  getEditorFileIdFromPathname,
  navigateToEditorFile,
  setEditorLocation,
} from "@/lib/editor-navigation";
import { useFileStore } from "@/stores/file-store";

/**
 * Bidirectional sync between URL (/editor/[fileId]) and Zustand currentFileId.
 *
 * Uses a `lastSyncedId` ref to track what fileId was last synced,
 * preventing infinite loops between URL→Store and Store→URL directions.
 *
 * Sidebar navigation may update only currentFileId so the editor can switch
 * immediately; this hook keeps the URL aligned after the store update. It also handles:
 *   - Initial page load (deep link or localStorage restore)
 *   - Browser back/forward (popstate → fileIdFromUrl changes)
 *   - Store-driven changes (file deletion, loadFiles clearing invalid ID)
 */
export function useFileUrlSync(fileIdFromUrl: string | null) {
  const currentFileId = useFileStore((s) => s.currentFileId);
  const setCurrentFile = useFileStore((s) => s.setCurrentFile);
  const isLoading = useFileStore((s) => s.isLoading);
  const isSynced = useFileStore((s) => s.isSynced);
  const fileIds = useFileStore((s) => s.files.map((f) => f.id).join(","));

  const hasInitialized = useRef(false);
  // Tracks the last fileId we synced to, preventing duplicate navigations
  const lastSyncedId = useRef<string | null>(fileIdFromUrl);

  // === ONE-TIME INIT: sync on first load after files are ready ===
  // Wait for isSynced (server data loaded) to avoid acting on stale/empty
  // localStorage state before Zustand persist hydration + loadFiles() complete.
  useEffect(() => {
    if (hasInitialized.current) return;
    if (isLoading || !isSynced) return;

    hasInitialized.current = true;
    const urlFileId = getEditorFileIdFromPathname() ?? fileIdFromUrl;
    const files = useFileStore.getState().files;

    if (urlFileId) {
      // Deep link: /editor/abc123
      const exists = files.some((f) => f.id === urlFileId);
      if (exists) {
        if (currentFileId !== urlFileId) {
          setCurrentFile(urlFileId);
        }
        // Always sync lastSyncedId to the URL file ID.
        // This prevents the Store→URL effect (which fires later in this commit
        // with the stale render-captured currentFileId) from redirecting away.
        lastSyncedId.current = urlFileId;
      } else if (files.length > 0) {
        // File not in current list — it may have just been created.
        // Clear currentFileId to avoid briefly showing the wrong file, but
        // DON'T redirect. The guard effect will sync to the correct file
        // after loadFiles completes with fresh data from the server.
        setCurrentFile(null);
        lastSyncedId.current = null;
      }
    } else if (currentFileId) {
      // /editor with no fileId, but store has one from localStorage → redirect
      const exists = files.some((f) => f.id === currentFileId);
      if (exists) {
        lastSyncedId.current = currentFileId;
        setEditorLocation(currentFileId, { replace: true });
      } else {
        setCurrentFile(null);
        lastSyncedId.current = currentFileId;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time init on load complete
  }, [isLoading, isSynced]);

  // === URL → Store: browser back/forward and manual History API changes ===
  useEffect(() => {
    const syncLocationToStore = () => {
      if (!hasInitialized.current) return;
      const nextFileId = getEditorFileIdFromPathname();
      // Only react when URL actually changed (not from our own History API calls)
      if (nextFileId === lastSyncedId.current) return;

      lastSyncedId.current = nextFileId;

      if (nextFileId) {
        const files = useFileStore.getState().files;
        const exists = files.some((f) => f.id === nextFileId);
        if (exists) {
          setCurrentFile(nextFileId);
        } else {
          setCurrentFile(null);
          setEditorLocation(null, { replace: true });
          lastSyncedId.current = null;
        }
      } else {
        setCurrentFile(null);
      }
    };

    window.addEventListener("popstate", syncLocationToStore);
    window.addEventListener(EDITOR_LOCATION_CHANGE_EVENT, syncLocationToStore);
    return () => {
      window.removeEventListener("popstate", syncLocationToStore);
      window.removeEventListener(EDITOR_LOCATION_CHANGE_EVENT, syncLocationToStore);
    };
  }, [setCurrentFile]);

  // === Store → URL: file deletion or programmatic store change ===
  useEffect(() => {
    if (!hasInitialized.current) return;

    // Use live store value instead of stale render-captured value.
    // During the first render cycle, the init effect may call setCurrentFile()
    // but the Store→URL effect still sees the old render value. Reading from
    // getState() ensures we act on the latest value.
    const liveCurrentFileId = useFileStore.getState().currentFileId;

    // Only react when store changed independently of URL sync
    if (liveCurrentFileId === lastSyncedId.current) return;

    lastSyncedId.current = liveCurrentFileId;

    // Skip navigation if the URL already shows the correct file.
    // This prevents unnecessary RSC fetches when the init effect calls
    // setCurrentFile to match the URL (e.g., syncing localStorage → URL).
    const urlAlreadyMatches =
      (liveCurrentFileId && fileIdFromUrl === liveCurrentFileId) ||
      (!liveCurrentFileId && !fileIdFromUrl);
    if (urlAlreadyMatches) return;

    // Use push (not replace) so sidebar file switches create history entries
    // for browser back/forward navigation. This intentionally uses the
    // History API instead of Next router navigation: the packaged Tauri app
    // is a static export and has no per-file `/editor/<id>.html` files.
    setEditorLocation(liveCurrentFileId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to store changes
  }, [currentFileId]);

  // === Guard: redirect when URL points to a deleted/non-existent file ===
  // This handles cases where the Store→URL effect doesn't fire (e.g., component
  // unmount race conditions, lastSyncedId ref getting out of sync), AND handles
  // newly-created files that weren't in the file list during init.
  //
  // Only react to file list *membership* changes (files added/removed), not
  // content updates from loadFileContent which mutate the same array reference.
  useEffect(() => {
    if (!hasInitialized.current) return;
    const urlFileId = getEditorFileIdFromPathname() ?? fileIdFromUrl;
    if (!urlFileId) return;
    if (isLoading) return;

    // Use live store value to avoid stale closure issues
    const liveCurrentFileId = useFileStore.getState().currentFileId;
    const files = useFileStore.getState().files;
    const exists = files.some((f) => f.id === urlFileId);
    if (exists) {
      // File now exists after loadFiles completed — sync store
      if (liveCurrentFileId !== urlFileId) {
        setCurrentFile(urlFileId);
        lastSyncedId.current = urlFileId;
      }
    } else {
      const nextFile = files.find((f) => !f.isFolder);
      const nextId = nextFile?.id ?? null;
      setCurrentFile(nextId);
      lastSyncedId.current = nextId;
      navigateToEditorFile(nextId, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- guard against stale URL after file list membership changes
  }, [fileIds, fileIdFromUrl]);
}
