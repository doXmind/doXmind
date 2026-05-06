"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";

import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useHighContrast } from "@/hooks/use-high-contrast";
import { useEditorKeyboardShortcuts } from "@/hooks/use-editor-keyboard-shortcuts";
import { useFileUrlSync } from "@/hooks/use-file-url-sync";
import { openNewWindow, openWindowForTarget, syncRecentsToDock } from "@/lib/window";
import { perfMark, perfMeasure } from "@/lib/perf";

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
const PerfOverlay = dynamic(
  () => import("@/components/dev/perf-overlay").then((m) => ({ default: m.PerfOverlay })),
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
    // Push persisted recents to Rust + open the requested target in parallel.
    // syncRecentsToDock is independent of file load and shouldn't gate the
    // editor first paint.
    const open = folder
      ? store.openFolder(folder)
      : file
        ? store.openFile(file)
        : store.loadFiles();
    void Promise.all([syncRecentsToDock(store.recents), open]);
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
    if (currentFileId) {
      // Mark the user-perceived "switch starts here" boundary even when the
      // file is already in loadedContentIds — the editor-side `setContent`
      // and first-paint still happen and dominate cost on hot switches.
      const startMark = `doxmind.switch.start:${currentFileId}`;
      perfMark(startMark);
      if (typeof window !== "undefined") {
        // Stash the mark name so the editor-side first-paint listener can
        // close the measure on the next animation frame after setContent.
        // Typed via the augmented Window interface in src/lib/perf.ts.
        window.__doxmindSwitchStartMark = startMark;
        window.__doxmindSwitchFileId = currentFileId;
      }
      if (!useFileStore.getState().loadedContentIds.has(currentFileId)) {
        loadFileContent(currentFileId);
      } else {
        // Hot-switch: nothing to read. The editor-side effect closes the
        // measure once setContent has flushed.
        perfMeasure("doxmind.switch.cacheHitNoRead", startMark, undefined, {
          fileId: currentFileId,
        });
      }
    }
  }, [currentFileId, loadFileContent, isSynced]);

  // Files on disk can be edited by external tools. On focus, re-read the
  // active document so stale sidecars are ignored and markdown wins.
  // Throttle per-file: alt-tabbing in/out within a few seconds doesn't need
  // another full read — we just looked. External editors taking longer than
  // the throttle window (5s) will still be picked up on the next focus.
  useEffect(() => {
    const lastRefreshAt = new Map<string, number>();
    const REFRESH_THROTTLE_MS = 5000;
    const refreshCurrentFile = () => {
      const id = useFileStore.getState().currentFileId;
      if (!id) return;
      const now = Date.now();
      const last = lastRefreshAt.get(id) ?? 0;
      if (now - last < REFRESH_THROTTLE_MS) return;
      lastRefreshAt.set(id, now);
      void useFileStore.getState().loadFileContent(id, { force: true });
    };
    window.addEventListener("focus", refreshCurrentFile);
    return () => window.removeEventListener("focus", refreshCurrentFile);
  }, []);

  // Sync browser tab title with current file
  useEffect(() => {
    document.title = currentFileName ? currentFileName.replace(/\.md$/i, "") : "doXmind";
  }, [currentFileName]);

  // ?perf=1 in the URL turns on the in-app perf overlay for this session.
  // The flag persists in localStorage so a refresh keeps the panel visible.
  const [perfEnabled, setPerfEnabled] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const search = new URLSearchParams(window.location.search);
    if (search.get("perf") === "1") {
      try {
        window.localStorage.setItem("DOXMIND_PERF", "1");
      } catch {
        // storage may be locked in some sandboxed contexts
      }
    }
    try {
      setPerfEnabled(window.localStorage.getItem("DOXMIND_PERF") === "1");
    } catch {
      setPerfEnabled(false);
    }
  }, []);

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
      {perfEnabled && <PerfOverlay />}
    </>
  );
}
