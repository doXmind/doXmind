"use client";

import { useCallback, useEffect, useState } from "react";
import { useIsTauri } from "@/hooks/use-is-tauri";

/**
 * Live auto-update state for the desktop shell.
 *
 * The Electron main process owns the Squirrel updater and broadcasts every
 * transition as an `os://update-state` event (see electron/updater.js); this
 * hook seeds from `update_get_state` and then follows the pushes. Outside the
 * Electron shell (browser dev, legacy Tauri without these commands) the state
 * stays `unsupported` and consumers render nothing.
 */

export interface AppUpdateState {
  status:
    | "unsupported"
    | "idle"
    | "checking"
    | "downloading"
    | "downloaded"
    | "up-to-date"
    | "error";
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
  const { isTauri } = useIsTauri();
  const [state, setState] = useState<AppUpdateState>(UNSUPPORTED);

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const initial = await invoke<AppUpdateState>("update_get_state");
        if (!cancelled && initial) setState(initial);
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<AppUpdateState>("os://update-state", (event) => {
          if (!cancelled && event.payload) setState(event.payload);
        });
        if (cancelled) unlisten?.();
      } catch {
        // Shell without update commands (legacy Tauri) — stay unsupported.
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isTauri]);

  const checkForUpdates = useCallback(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("update_check");
    } catch {
      // unsupported shell — ignore
    }
  }, []);

  const restartToUpdate = useCallback(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("update_restart");
    } catch {
      // unsupported shell — ignore
    }
  }, []);

  return { state, checkForUpdates, restartToUpdate };
}
