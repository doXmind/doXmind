"use client";

import { useCallback, useEffect, useState } from "react";
import { getDesktopBridge } from "@/lib/native-shell";

/**
 * Live auto-update state for the desktop shell.
 *
 * The Electron main process owns the Squirrel updater and broadcasts every
 * transition as an `os://update-state` event (see electron/updater.js); this
 * hook seeds from `update_get_state` and then follows the pushes. Outside the
 * Electron shell (browser development or a preload failure) the state stays
 * `unsupported` and consumers render nothing.
 */

export interface AppUpdateState {
  status:
    "unsupported" | "idle" | "checking" | "downloading" | "downloaded" | "up-to-date" | "error";
  currentVersion: string;
  availableVersion: string | null;
  error: string | null;
  lastCheckedAt: string | null;
}

const UNSUPPORTED: AppUpdateState = {
  status: "unsupported",
  currentVersion: "",
  availableVersion: null,
  error: null,
  lastCheckedAt: null,
};

export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState>(UNSUPPORTED);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let receivedEvent = false;

    (async () => {
      try {
        unlisten = bridge.listen<AppUpdateState>("os://update-state", (event) => {
          receivedEvent = true;
          if (!cancelled && event.payload) setState(event.payload);
        });
        const initial = await bridge.invoke<AppUpdateState>("update_get_state");
        if (!cancelled && !receivedEvent && initial) setState(initial);
        if (cancelled) unlisten?.();
      } catch {
        // Shell without update commands — stay unsupported.
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const checkForUpdates = useCallback(async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    try {
      await bridge.invoke("update_check");
    } catch {
      // unsupported shell — ignore
    }
  }, []);

  const restartToUpdate = useCallback(async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    try {
      await bridge.invoke("update_restart");
    } catch {
      // unsupported shell — ignore
    }
  }, []);

  return { state, checkForUpdates, restartToUpdate };
}
