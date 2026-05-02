"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";

import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useHighContrast } from "@/hooks/use-high-contrast";
import { useEditorKeyboardShortcuts } from "@/hooks/use-editor-keyboard-shortcuts";
import { useFileUrlSync } from "@/hooks/use-file-url-sync";
import { openNewWindow, openWindowForTarget, syncRecentsToDock } from "@/lib/window";

const DesktopEditor = dynamic(
  () => import("./_components/desktop-editor").then((m) => ({ default: m.DesktopEditor })),
  { ssr: false }
);

const KeyboardShortcutsModal = dynamic(
  () =>
    import("@/components/ui/keyboard-shortcuts-modal").then((m) => ({
      default: m.KeyboardShortcutsModal,
    })),
  { ssr: false }
);
const CommandPalette = dynamic(
  () => import("@/components/ui/command-palette").then((m) => ({ default: m.CommandPalette })),
  { ssr: false }
);
const QuickSwitcher = dynamic(
  () => import("@/components/ui/quick-switcher").then((m) => ({ default: m.QuickSwitcher })),
  { ssr: false }
);
const PresentationMode = dynamic(
  () =>
    import("@/components/editor/presentation-mode").then((m) => ({
      default: m.PresentationMode,
    })),
  { ssr: false }
);

export function EditorClient() {
  const params = useParams();
  // [[...fileId]] gives params.fileId as string[] | undefined
  const fileIdFromUrl = (params.fileId as string[] | undefined)?.[0] ?? null;

  const currentFileId = useFileStore((s) => s.currentFileId);
  const currentFileName = useFileStore((s) =>
    s.currentFileId ? s.files.find((file) => file.id === s.currentFileId)?.name : undefined
  );
  const isSynced = useFileStore((s) => s.isSynced);
  const loadFileContent = useFileStore((s) => s.loadFileContent);

  useFileUrlSync(fileIdFromUrl);
  useEditorKeyboardShortcuts();
  useHighContrast();

  const isKeyboardShortcutsOpen = useLayoutStore((s) => s.isKeyboardShortcutsOpen);
  const setKeyboardShortcutsOpen = useLayoutStore((s) => s.setKeyboardShortcutsOpen);
  const isCommandPaletteOpen = useLayoutStore((s) => s.isCommandPaletteOpen);
  const setCommandPaletteOpen = useLayoutStore((s) => s.setCommandPaletteOpen);

  // Boot: per-window state arrives via ?folder=... / ?file=... URL params,
  // set by Rust at window creation. If neither is present we land on the
  // welcome screen — loadFiles short-circuits because openTarget === "none".
  useEffect(() => {
    if (isSynced) return;
    const params = new URLSearchParams(window.location.search);
    const folder = params.get("folder");
    const file = params.get("file");
    const store = useFileStore.getState();
    // Push the persisted recents to Rust on cold boot so the dock right-click
    // menu is populated even before the user opens anything in this session.
    void syncRecentsToDock(store.recents);
    if (folder) {
      void store.openFolder(folder);
    } else if (file) {
      void store.openFile(file);
    } else {
      void store.loadFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on mount
  }, []);

  // Listen for dock-menu clicks. Rust emits these events when the user picks
  // an item from the macOS dock right-click menu.
  useEffect(() => {
    let unlistenRecent: (() => void) | undefined;
    let unlistenNew: (() => void) | undefined;
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlistenRecent = await listen<{ kind: "file" | "folder"; path: string }>(
          "dock://open-recent",
          (event) => {
            void openWindowForTarget(event.payload);
          }
        );
        unlistenNew = await listen("dock://open-new-window", () => {
          void openNewWindow();
        });
      } catch {
        // Non-Tauri build: nothing to do.
      }
    })();
    return () => {
      unlistenRecent?.();
      unlistenNew?.();
    };
  }, []);

  // Load file content on demand when current file changes.
  useEffect(() => {
    if (!isSynced) return;
    if (currentFileId && !useFileStore.getState().loadedContentIds.has(currentFileId)) {
      loadFileContent(currentFileId);
    }
  }, [currentFileId, loadFileContent, isSynced]);

  // Files on disk can be edited by external tools. On focus, re-read the
  // active document so stale sidecars are ignored and markdown wins.
  useEffect(() => {
    const refreshCurrentFile = () => {
      const id = useFileStore.getState().currentFileId;
      if (id) {
        void useFileStore.getState().loadFileContent(id, { force: true });
      }
    };
    window.addEventListener("focus", refreshCurrentFile);
    return () => window.removeEventListener("focus", refreshCurrentFile);
  }, []);

  // Sync browser tab title with current file
  useEffect(() => {
    document.title = currentFileName ? currentFileName.replace(/\.md$/i, "") : "doXmind";
  }, [currentFileName]);

  return (
    <>
      <DesktopEditor />

      <KeyboardShortcutsModal
        open={isKeyboardShortcutsOpen}
        onClose={() => setKeyboardShortcutsOpen(false)}
      />
      <CommandPalette open={isCommandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
      <QuickSwitcher />
      <PresentationMode />
    </>
  );
}
