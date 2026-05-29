"use client";

import { useEffect } from "react";
import { useFileStore } from "@/stores/file-store";
import { storeLogger } from "@/lib/logger";
import { debounce } from "@/lib/utils";

const log = storeLogger.child("WorkspaceWatch");

// Small debounce to collapse the rare duplicate event into one re-scan. The
// Rust watcher already coalesces bursts (~400 ms, 800 ms ceiling), so this is
// only a thin guard against same-tick repeats; keeping it short keeps total
// latency well under the ~1 s target. The re-scan itself is the source of truth.
const REFRESH_DEBOUNCE_MS = 50;

// Watches the open workspace folder via the native Tauri watcher and refreshes
// the sidebar when its contents change externally (Finder, terminal, another
// app). Mounted app-wide; the effect only does work while a folder workspace is
// open under Tauri. The manual right-click → Refresh remains as a fallback, and
// the window-focus handler that re-reads the *current file* is untouched — tree
// refresh lives only here.
export function WorkspaceChangeListener() {
  const openTarget = useFileStore((s) => s.openTarget);
  const rootPath = useFileStore((s) => s.rootPath);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("__TAURI_BACKEND_URL__" in window)) return;
    if (openTarget !== "folder" || !rootPath) return;

    const root = rootPath;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    // Re-scan via the same path the Refresh button uses. loadFiles() preserves
    // selection / expanded state, so a refresh doesn't reset the tree.
    const refresh = debounce(() => {
      void useFileStore.getState().loadFiles();
    }, REFRESH_DEBOUNCE_MS);

    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const { listen } = await import("@tauri-apps/api/event");

        // The backend scopes delivery to this window via emit_to, so every
        // event we receive is for our own workspace. We deliberately don't
        // string-compare payload.root against rootPath: rootPath holds the raw
        // picker path while the backend canonicalizes (symlinks, /tmp →
        // /private/tmp, trailing slash), so an equality check would drop real
        // events. Stale-folder events are handled by re-registering this effect
        // on rootPath change, plus the root-scoped unwatch on teardown.
        const off = await listen("workspace://changed", () => {
          refresh();
        });

        if (cancelled) {
          off();
          return;
        }
        unlisten = off;

        await invoke("workspace_watch", { root });
      } catch (error) {
        // Non-Tauri build, or the watcher failed to start (e.g. OS watch
        // limits). The manual Refresh remains available either way.
        log.error("workspace watch unavailable", error);
      }
    })();

    return () => {
      cancelled = true;
      refresh.cancel();
      unlisten?.();
      void (async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          // Pass the root we installed: on a folder swap this teardown races the
          // next window's workspace_watch across IPC, and a root-scoped unwatch
          // only removes the watcher if it's still ours — never the new one.
          await invoke("workspace_unwatch", { root });
        } catch {
          // Nothing to tear down outside Tauri.
        }
      })();
    };
  }, [openTarget, rootPath]);

  return null;
}
