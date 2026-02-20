"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useFileStore } from "@/stores/file-store";

/**
 * Bidirectional sync between URL (/editor/[fileId]) and Zustand currentFileId.
 *
 * Uses a `lastSyncedId` ref to track what fileId was last synced,
 * preventing infinite loops between URL→Store and Store→URL directions.
 *
 * All explicit user navigation (sidebar click, file creation, home page click)
 * calls both setCurrentFile AND router.push directly. This hook only handles:
 *   - Initial page load (deep link or localStorage restore)
 *   - Browser back/forward (popstate → fileIdFromUrl changes)
 *   - Store-driven changes (file deletion, loadFiles clearing invalid ID)
 */
export function useFileUrlSync(fileIdFromUrl: string | null) {
  const router = useRouter();
  const { currentFileId, setCurrentFile, files, isLoading, isSynced } = useFileStore();

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

    if (fileIdFromUrl) {
      // Deep link: /editor/abc123
      const exists = files.some((f) => f.id === fileIdFromUrl);
      if (exists) {
        if (currentFileId !== fileIdFromUrl) {
          setCurrentFile(fileIdFromUrl);
        }
        // Always sync lastSyncedId to the URL file ID.
        // This prevents the Store→URL effect (which fires later in this commit
        // with the stale render-captured currentFileId) from redirecting away.
        lastSyncedId.current = fileIdFromUrl;
      } else if (files.length > 0) {
        // File not in current list — might be newly created (e.g., fork).
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
        router.replace(`/editor/${currentFileId}`);
      } else {
        setCurrentFile(null);
        lastSyncedId.current = currentFileId;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time init on load complete
  }, [isLoading, isSynced]);

  // === URL → Store: browser back/forward ===
  useEffect(() => {
    if (!hasInitialized.current) return;
    // Only react when URL actually changed (not from our own router calls)
    if (fileIdFromUrl === lastSyncedId.current) return;

    lastSyncedId.current = fileIdFromUrl;

    if (fileIdFromUrl) {
      const exists = files.some((f) => f.id === fileIdFromUrl);
      if (exists) {
        setCurrentFile(fileIdFromUrl);
      } else {
        setCurrentFile(null);
        router.replace("/editor");
        lastSyncedId.current = null;
      }
    } else {
      setCurrentFile(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to URL param changes
  }, [fileIdFromUrl]);

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

    const newPath = liveCurrentFileId ? `/editor/${liveCurrentFileId}` : "/editor";
    router.replace(newPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to store changes
  }, [currentFileId]);

  // === Guard: redirect when URL points to a deleted/non-existent file ===
  // This handles cases where the Store→URL effect doesn't fire (e.g., component
  // unmount race conditions, lastSyncedId ref getting out of sync), AND handles
  // newly-created files (e.g., fork) that weren't in the file list during init.
  useEffect(() => {
    if (!hasInitialized.current) return;
    if (!fileIdFromUrl) return;
    if (isLoading) return;

    const exists = files.some((f) => f.id === fileIdFromUrl);
    if (exists) {
      // File now exists (e.g., loadFiles completed after fork) — sync store
      if (currentFileId !== fileIdFromUrl) {
        setCurrentFile(fileIdFromUrl);
        lastSyncedId.current = fileIdFromUrl;
      }
    } else {
      const nextFile = files.find((f) => !f.isFolder);
      const nextId = nextFile?.id ?? null;
      setCurrentFile(nextId);
      lastSyncedId.current = nextId;
      router.replace(nextId ? `/editor/${nextId}` : "/editor");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- guard against stale URL after file list changes
  }, [files, fileIdFromUrl]);
}
