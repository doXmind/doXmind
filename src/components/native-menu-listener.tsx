"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notifications";
import { navigateToEditorFile } from "@/lib/editor-navigation";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { pickNativeFile, pickNativeFolder } from "@/lib/native-dialog";
import { openNewWindow, openWindowForTarget, syncRecentsToDock } from "@/lib/window";
import { revealFileInFinder, revealPathInFinder } from "@/lib/storage/reveal";
import { storeLogger } from "@/lib/logger";

const log = storeLogger.child("NativeMenu");

const FILE_FILTERS = [
  {
    name: "Documents",
    extensions: ["md", "markdown", "pdf", "xlsx", "xlsm", "docx", "pptx"],
  },
];

// Bridges native macOS menu-bar and tray clicks (emitted from
// src-tauri/src/menu_bar.rs and the tray builder in src-tauri/src/lib.rs)
// to the same store actions the in-app UI uses, so behavior stays in one
// place. Each handler is intentionally small — anything heavier should
// move into the relevant store, not balloon this bridge.
export function NativeMenuListener() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("__TAURI_BACKEND_URL__" in window)) return;

    const unlisteners: Array<() => void> = [];
    let cancelled = false;

    const nextUntitledName = (): string => {
      const { files } = useFileStore.getState();
      const rootFiles = files.filter((f) => !f.isFolder && f.parentId === null);
      let max = 0;
      for (const f of rootFiles) {
        const m = f.name.match(/^Untitled-(\d+)\.md$/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > max) max = n;
        }
      }
      return `Untitled-${max + 1}.md`;
    };

    const createUntitled = async () => {
      const { createFile } = useFileStore.getState();
      try {
        const id = await createFile(nextUntitledName(), "", null);
        navigateToEditorFile(id);
      } catch {
        // The store already surfaces failures via the global toaster.
      }
    };

    const openFilePicker = async () => {
      try {
        const selected = await pickNativeFile("Open File", FILE_FILTERS);
        if (!selected) return;
        await openWindowForTarget({ kind: "file", path: selected });
      } catch (error) {
        log.error("open file failed", error);
        notify.error("Failed to open file");
      }
    };

    const openFolderPicker = async () => {
      try {
        const selected = await pickNativeFolder("Open Folder");
        if (!selected) return;
        await openWindowForTarget({ kind: "folder", path: selected });
      } catch (error) {
        log.error("open folder failed", error);
        notify.error("Failed to open folder");
      }
    };

    const revealCurrent = async () => {
      const state = useFileStore.getState();
      const file = state.currentFileId
        ? state.files.find((f) => f.id === state.currentFileId)
        : undefined;
      try {
        if (file) {
          await revealFileInFinder(file);
          return;
        }
        const root = state.rootPath ?? state.openFilePath;
        if (root) {
          await revealPathInFinder(root);
        }
      } catch (error) {
        log.error("reveal failed", error);
        notify.error("Couldn't reveal in Finder");
      }
    };

    const clearRecents = () => {
      useFileStore.setState({ recents: [] });
      void syncRecentsToDock([]);
    };

    // Drain any file paths the OS handed us via file association — populated
    // from CLI args at startup (Windows/Linux) and from RunEvent::Opened
    // (macOS Finder "Open With" / drag-to-dock). Multiple windows may race
    // here; the Rust queue is drained atomically so only the first caller
    // gets the paths, and openWindowForTarget dedupes by focusing an
    // existing window when one already shows the file.
    const drainPendingOpenPaths = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const paths = await invoke<string[]>("take_pending_open_paths");
        for (const path of paths) {
          try {
            await openWindowForTarget({ kind: "file", path });
          } catch (error) {
            log.error("open from os association failed", error);
            notify.error("Failed to open file");
          }
        }
      } catch (error) {
        log.error("take_pending_open_paths failed", error);
      }
    };

    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");

      const subs: Array<{ name: string; fn: () => void | Promise<void> }> = [
        { name: "menu://new-file", fn: () => createUntitled() },
        { name: "menu://new-window", fn: () => openNewWindow() },
        { name: "menu://open-file", fn: () => openFilePicker() },
        { name: "menu://open-folder", fn: () => openFolderPicker() },
        { name: "menu://settings", fn: () => router.push("/settings") },
        { name: "menu://save", fn: () => window.dispatchEvent(new Event("doxmind:save-now")) },
        { name: "menu://reveal", fn: () => revealCurrent() },
        {
          name: "menu://find",
          fn: () => useLayoutStore.getState().setSearchBarOpen(true),
        },
        {
          name: "menu://command-palette",
          fn: () => useLayoutStore.getState().openCommandPalette(),
        },
        {
          name: "menu://quick-switcher",
          fn: () => useLayoutStore.getState().setQuickSwitcherOpen(true),
        },
        {
          name: "menu://toggle-sidebar",
          fn: () => useLayoutStore.getState().toggleFilesSidebar(),
        },
        {
          name: "menu://toggle-focus",
          fn: () => useLayoutStore.getState().toggleFocusMode(),
        },
        { name: "menu://clear-recents", fn: clearRecents },
        // Tray surface
        { name: "tray://new-file", fn: () => createUntitled() },
        { name: "tray://settings", fn: () => router.push("/settings") },
        { name: "tray://open-file", fn: () => openFilePicker() },
        { name: "tray://open-folder", fn: () => openFolderPicker() },
      ];

      for (const sub of subs) {
        const off = await listen(sub.name, () => {
          void Promise.resolve(sub.fn());
        });
        if (cancelled) {
          off();
        } else {
          unlisteners.push(off);
        }
      }

      // Open Recent payload comes from native code as { kind, path }.
      const offRecent = await listen<{ kind: "file" | "folder"; path: string }>(
        "menu://open-recent",
        (event) => {
          void openWindowForTarget(event.payload);
        }
      );
      const offTrayRecent = await listen<{ kind: "file" | "folder"; path: string }>(
        "tray://open-recent",
        (event) => {
          void openWindowForTarget(event.payload);
        }
      );
      const offUrl = await listen<string>("menu://open-url", (event) => {
        void (async () => {
          try {
            const { openUrl } = await import("@tauri-apps/plugin-opener");
            await openUrl(event.payload);
          } catch (error) {
            log.error("open url failed", error);
          }
        })();
      });

      const offOsOpen = await listen("os://open-pending", () => {
        void drainPendingOpenPaths();
      });

      if (cancelled) {
        offRecent();
        offTrayRecent();
        offUrl();
        offOsOpen();
      } else {
        unlisteners.push(offRecent, offTrayRecent, offUrl, offOsOpen);
      }

      // Pick up anything queued before this listener mounted — covers both
      // CLI args harvested in setup() and Opened events that fired during
      // the webview's boot.
      void drainPendingOpenPaths();
    })();

    return () => {
      cancelled = true;
      for (const off of unlisteners) off();
    };
  }, [router]);

  return null;
}
