"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notifications";
import { isMarkdownFile } from "@/lib/document-types";
import { navigateToEditorFile } from "@/lib/editor-navigation";
import { createPageForContext } from "@/lib/new-page";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { pickNativeFile, pickNativeFolder } from "@/lib/native-dialog";
import { openNewWindow, openWindowForTarget, syncRecentsToDock } from "@/lib/window";
import { revealFileInFinder, revealPathInFinder } from "@/lib/storage/reveal";
import { storeLogger } from "@/lib/logger";
import { hasDesktopBridge, invokeDesktop, listenDesktop } from "@/lib/native-shell";
import { useEditorRefStore } from "@/stores/editor-ref-store";

const log = storeLogger.child("NativeMenu");

export const NATIVE_FILE_FILTERS = [
  {
    name: "Documents",
    extensions: ["md", "markdown", "pdf", "xlsx", "xlsm", "csv", "html", "htm"],
  },
];

// Bridges Electron menu-bar, Dock, and tray clicks
// to the same store actions the in-app UI uses, so behavior stays in one
// place. Each handler is intentionally small — anything heavier should
// move into the relevant store, not balloon this bridge.
export function NativeMenuListener() {
  const router = useRouter();

  useEffect(() => {
    if (!hasDesktopBridge()) return;

    const unlisteners: Array<() => void> = [];
    let cancelled = false;

    const createUntitled = async () => {
      try {
        const id = await createPageForContext(useFileStore.getState());
        await navigateToEditorFile(id);
      } catch (error) {
        log.error("create Page failed", error);
        notify.error("Could not create Page");
      }
    };

    const activeMarkdownPage = () => {
      const state = useFileStore.getState();
      if (!state.currentFileId) return null;
      const file = state.files.find((candidate) => candidate.id === state.currentFileId);
      return file && !file.isFolder && isMarkdownFile(file) ? file : null;
    };

    const openFilePicker = async () => {
      try {
        const selected = await pickNativeFile("Open File", NATIVE_FILE_FILTERS);
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

    const saveCurrentPage = async () => {
      if (!activeMarkdownPage()) return;
      const requestSave = useEditorRefStore.getState().requestSave;
      if (!requestSave) return;
      try {
        await requestSave();
      } catch (error) {
        log.error("save failed", error);
        notify.error("Could not save Page");
      }
    };

    const undoCurrentPage = () => {
      if (!activeMarkdownPage()) return;
      useEditorRefStore.getState().requestUndo?.();
    };

    const redoCurrentPage = () => {
      if (!activeMarkdownPage()) return;
      useEditorRefStore.getState().requestRedo?.();
    };

    const findInCurrentPage = () => {
      if (!activeMarkdownPage()) return;
      useLayoutStore.getState().setSearchBarOpen(true);
    };

    // Drain any file paths the OS handed us via file association — populated
    // from CLI args at startup (Windows/Linux) and Electron's open-file event
    // (macOS Finder "Open With" / drag-to-dock). Multiple windows may race
    // here; the main-process queue is drained atomically so only the first caller
    // gets the paths, and openWindowForTarget dedupes by focusing an
    // existing window when one already shows the file.
    const drainPendingOpenPaths = async () => {
      try {
        const paths = await invokeDesktop<string[]>("take_pending_open_paths");
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
      const subs: Array<{ name: string; fn: () => void | Promise<void> }> = [
        { name: "menu://new-file", fn: () => createUntitled() },
        { name: "menu://new-window", fn: () => openNewWindow() },
        { name: "menu://open-file", fn: () => openFilePicker() },
        { name: "menu://open-folder", fn: () => openFolderPicker() },
        { name: "menu://settings", fn: () => router.push("/settings") },
        { name: "menu://save", fn: saveCurrentPage },
        { name: "menu://undo", fn: undoCurrentPage },
        { name: "menu://redo", fn: redoCurrentPage },
        { name: "menu://reveal", fn: () => revealCurrent() },
        { name: "menu://find", fn: findInCurrentPage },
        { name: "menu://find-replace", fn: () => useLayoutStore.getState().openReplaceBar() },
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
        const off = listenDesktop(sub.name, () => {
          void Promise.resolve(sub.fn());
        });
        if (cancelled) {
          off();
        } else {
          unlisteners.push(off);
        }
      }

      // Open Recent payload comes from native code as { kind, path }.
      const offRecent = listenDesktop<{ kind: "file" | "folder"; path: string }>(
        "menu://open-recent",
        (event) => {
          void openWindowForTarget(event.payload);
        }
      );
      const offTrayRecent = listenDesktop<{ kind: "file" | "folder"; path: string }>(
        "tray://open-recent",
        (event) => {
          void openWindowForTarget(event.payload);
        }
      );
      const offUrl = listenDesktop<string>("menu://open-url", (event) => {
        void (async () => {
          try {
            await invokeDesktop("shell_open_external", { url: event.payload });
          } catch (error) {
            log.error("open url failed", error);
          }
        })();
      });

      const offOsOpen = listenDesktop("os://open-pending", () => {
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
      // CLI args and open-file events that fired during renderer boot.
      void drainPendingOpenPaths();
    })();

    return () => {
      cancelled = true;
      for (const off of unlisteners) off();
    };
  }, [router]);

  return null;
}
