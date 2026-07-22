"use client";

import { useEffect } from "react";
import { useFileStore } from "@/stores/file-store";
import { isMarkdownFile } from "@/lib/document-types";
import { eventBus } from "@/lib/events";
import { storeLogger } from "@/lib/logger";
import { debounce } from "@/lib/utils";
import { hasDesktopBridge, invokeDesktop, listenDesktop } from "@/lib/native-shell";

const log = storeLogger.child("WorkspaceWatch");

// Small debounce to collapse the rare duplicate event into one re-scan. The
// Electron watcher already coalesces bursts, so this is
// only a thin guard against same-tick repeats; keeping it short keeps total
// latency well under the ~1 s target.
const REFRESH_DEBOUNCE_MS = 50;

// Watches the open workspace folder via Electron and refreshes
// the sidebar when its contents change externally (Finder, terminal, another
// app). Mounted app-wide; the effect only does work while a folder workspace is
// open in the desktop app. The manual right-click → Refresh and window-focus re-read
// remain as fallbacks.
export function WorkspaceChangeListener() {
  const openTarget = useFileStore((s) => s.openTarget);
  const rootPath = useFileStore((s) => s.rootPath);

  useEffect(() => {
    if (!hasDesktopBridge()) return;
    if (openTarget !== "folder" || !rootPath) return;

    const root = rootPath;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    // Re-scan the tree first, then re-read the active Page so a content-only
    // external edit reaches the editor even when the scan shape is unchanged.
    const refresh = debounce(() => {
      void (async () => {
        try {
          await useFileStore.getState().loadFiles({ silent: true });
          if (cancelled) return;
          const state = useFileStore.getState();
          const current = state.currentFileId
            ? state.files.find((file) => file.id === state.currentFileId)
            : undefined;
          if (current && isMarkdownFile(current)) {
            await state.loadFileContent(current.id, { force: true });
          }
        } catch (error) {
          log.error("workspace refresh failed", error);
        } finally {
          if (!cancelled) eventBus.emit("storage:changed");
        }
      })();
    }, REFRESH_DEBOUNCE_MS);

    void (async () => {
      try {
        // The backend scopes delivery to this window via emit_to, so every
        // event we receive is for our own workspace. We deliberately don't
        // string-compare payload.root against rootPath: rootPath holds the raw
        // picker path while the backend canonicalizes (symlinks, /tmp →
        // /private/tmp, trailing slash), so an equality check would drop real
        // events. Stale-folder events are handled by re-registering this effect
        // on rootPath change, plus the root-scoped unwatch on teardown.
        const off = listenDesktop("workspace://changed", () => {
          refresh();
        });

        if (cancelled) {
          off();
          return;
        }
        unlisten = off;

        await invokeDesktop("workspace_watch", { root });
      } catch (error) {
        // Browser dev, or the watcher failed to start (e.g. OS watch
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
          // Pass the root we installed: on a folder swap this teardown races the
          // next window's workspace_watch across IPC, and a root-scoped unwatch
          // only removes the watcher if it's still ours — never the new one.
          await invokeDesktop("workspace_unwatch", { root });
        } catch {
          // Nothing to tear down outside Electron.
        }
      })();
    };
  }, [openTarget, rootPath]);

  return null;
}
