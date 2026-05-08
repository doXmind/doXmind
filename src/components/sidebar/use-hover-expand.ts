"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Hover-expand timer for sidebar folder DnD.
 *
 * When the user drags an item over a collapsed folder row, we want the row to
 * auto-expand after a short hover so they can drop into a deeper subfolder
 * without first interrupting the drag to expand it manually. This is the D3
 * slice from PRD #63.
 *
 * Contract:
 *  - Call `onFolderDragOver(folderId)` from the folder row's `onDragOver`
 *    handler. The hook starts a 500 ms timer (or whatever `delay` is set to);
 *    when it elapses, `onExpand(folderId)` fires once.
 *  - If `onFolderDragOver` is called again with a *different* folder id within
 *    the delay window, the timer resets and only the new folder's expand
 *    fires after another full delay. This matches what users expect when they
 *    sweep across siblings during a drag — each row gets its own grace period.
 *  - `onFolderDragLeave()` and `cancel()` clear any pending timer. Wire
 *    `onFolderDragLeave` into `onDragLeave`, and `cancel` into `onDrop` and
 *    `onDragEnd`.
 *  - The `onExpand` callback is stored in a ref so the consumer doesn't have
 *    to memoize it; the hook's identity stays stable across renders.
 *
 * Folders only — sub-page hierarchy is intentionally out of scope (per PRD).
 */
export function useHoverExpand(
  onExpand: (folderId: string) => void,
  delay = 500
): {
  onFolderDragOver: (folderId: string) => void;
  onFolderDragLeave: () => void;
  cancel: () => void;
} {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFolderRef = useRef<string | null>(null);
  const callbackRef = useRef(onExpand);

  // Keep the latest callback without forcing consumers to memoize it.
  useEffect(() => {
    callbackRef.current = onExpand;
  }, [onExpand]);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingFolderRef.current = null;
  }, []);

  // Cancel on unmount so a teardown mid-drag doesn't fire a stray expand.
  useEffect(() => cancel, [cancel]);

  const onFolderDragOver = useCallback(
    (folderId: string) => {
      // Same folder still under the cursor — keep the existing timer running
      // so a steady hover doesn't get reset on every dragover tick.
      if (pendingFolderRef.current === folderId && timerRef.current !== null) {
        return;
      }
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      pendingFolderRef.current = folderId;
      timerRef.current = setTimeout(() => {
        const target = pendingFolderRef.current;
        timerRef.current = null;
        pendingFolderRef.current = null;
        if (target !== null) {
          callbackRef.current(target);
        }
      }, delay);
    },
    [delay]
  );

  const onFolderDragLeave = useCallback(() => {
    cancel();
  }, [cancel]);

  return { onFolderDragOver, onFolderDragLeave, cancel };
}
