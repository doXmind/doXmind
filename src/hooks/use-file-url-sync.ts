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
  const { currentFileId, setCurrentFile, files, isLoading } = useFileStore();

  const hasInitialized = useRef(false);
  // Tracks the last fileId we synced to, preventing duplicate navigations
  const lastSyncedId = useRef<string | null>(fileIdFromUrl);

  // === ONE-TIME INIT: sync on first load after files are ready ===
  useEffect(() => {
    if (hasInitialized.current) return;
    if (isLoading) return;

    hasInitialized.current = true;

    if (fileIdFromUrl) {
      // Deep link: /editor/abc123
      const exists = files.some((f) => f.id === fileIdFromUrl);
      if (exists) {
        if (currentFileId !== fileIdFromUrl) {
          setCurrentFile(fileIdFromUrl);
        }
        lastSyncedId.current = fileIdFromUrl;
      } else if (files.length > 0) {
        // File doesn't exist — show welcome
        setCurrentFile(null);
        lastSyncedId.current = null;
        router.replace("/editor");
      }
    } else if (currentFileId) {
      // /editor with no fileId, but store has one from localStorage → redirect
      const exists = files.some((f) => f.id === currentFileId);
      if (exists) {
        lastSyncedId.current = currentFileId;
        router.replace(`/editor/${currentFileId}`);
      } else {
        setCurrentFile(null);
        lastSyncedId.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time init on load complete
  }, [isLoading]);

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
    // Only react when store changed independently of URL sync
    if (currentFileId === lastSyncedId.current) return;

    lastSyncedId.current = currentFileId;
    const newPath = currentFileId ? `/editor/${currentFileId}` : "/editor";
    router.replace(newPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to store changes
  }, [currentFileId]);
}
