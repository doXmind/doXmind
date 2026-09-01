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
import { listenDesktop } from "@/lib/native-shell";
import { perfMark, perfMeasure } from "@/lib/perf";

const DesktopEditor = dynamic(
  () => import("./_components/desktop-editor").then((m) => ({ default: m.DesktopEditor })),
  { ssr: false }
);

const loadKeyboardShortcutsModal = () =>
  import("@/components/ui/keyboard-shortcuts-modal").then((m) => m.KeyboardShortcutsModal);
const loadCommandPalette = () =>
  import("@/components/ui/command-palette").then((m) => m.CommandPalette);
const loadQuickSwitcher = () =>
  import("@/components/ui/quick-switcher").then((m) => m.QuickSwitcher);

/**
 * Fetch an overlay's chunk the first time it opens, without going through
 * `React.lazy`.
 *
 * These three used to be `next/dynamic`, which wraps its lazy component in
 * `<Suspense fallback={null}>`. The first open therefore suspended, committed
 * that invisible fallback, and React then held the real content back by
 * `FALLBACK_THROTTLE_MS` — 300ms — so that a loading state could not flash past
 * the user. Measured on the packaged app, first Cmd+P (n=6): the 17kB palette
 * chunk finished downloading at +2.0ms and the dialog did not enter the DOM
 * until +304.4ms, pixels at +313.2ms. Every open after that was 1.6-5.8ms to
 * insert, 14.9-16.7ms to pixels — a 20x cliff on the first press, and 2x the
 * whole sanctioned menu-entry animation (docs/BLOCK_UX_REFERENCE.md: "only
 * around 150ms"). No long task fired in that window; nothing was busy.
 *
 * What proves it is a timer and not work: artificially delaying the chunk moves
 * the total but not the sum. Chunk at +18ms gave the dialog at +314ms (296ms of
 * waiting); chunk held to +446ms gave the dialog at +454ms — 8ms. The same
 * module doing the same work commits in 8ms once the 300ms floor has already
 * expired. React is smoothing over a flash that a `null` fallback cannot
 * produce, and we paid a third of a second of blank for it.
 *
 * Importing here keeps the chunk out of the boot payload exactly as `dynamic`
 * did — nothing is prefetched, the request still starts on the keystroke — but
 * the arrival is a plain state update rather than a Suspense retry, so it
 * commits as soon as it lands.
 */
function useOverlayComponent<P>(
  load: () => Promise<React.ComponentType<P>>,
  isOpen: boolean
): React.ComponentType<P> | null {
  const [Component, setComponent] = useState<React.ComponentType<P> | null>(null);
  useEffect(() => {
    if (!isOpen || Component) return;
    let cancelled = false;
    void load().then((loaded) => {
      if (!cancelled) setComponent(() => loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, Component, load]);
  return Component;
}

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
  const isQuickSwitcherOpen = useLayoutStore((s) => s.isQuickSwitcherOpen);

  const KeyboardShortcutsModal = useOverlayComponent(
    loadKeyboardShortcutsModal,
    isKeyboardShortcutsOpen
  );
  const CommandPalette = useOverlayComponent(loadCommandPalette, isCommandPaletteOpen);
  const QuickSwitcher = useOverlayComponent(loadQuickSwitcher, isQuickSwitcherOpen);

  // Boot: per-window state arrives via ?folder=... / ?file=... URL params,
  // set by Electron at window creation. If neither is present we land on the
  // welcome screen — loadFiles short-circuits because openTarget === "none".
  useEffect(() => {
    if (isSynced) return;
    const params = new URLSearchParams(window.location.search);
    const folder = params.get("folder");
    const file = params.get("file");
    const store = useFileStore.getState();
    // Push persisted recents to Electron + open the requested target in parallel.
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

  // Listen for Electron Dock-menu clicks.
  useEffect(() => {
    let unlistenRecent: (() => void) | undefined;
    let unlistenNew: (() => void) | undefined;
    void (async () => {
      try {
        unlistenRecent = listenDesktop<{ kind: "file" | "folder"; path: string }>(
          "dock://open-recent",
          (event) => {
            void openWindowForTarget(event.payload);
          }
        );
        unlistenNew = listenDesktop("dock://open-new-window", () => {
          void openNewWindow();
        });
      } catch {
        // Browser development: nothing to do.
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
  // active Page from its authoritative Markdown source.
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

  // ?perf=1 in the URL turns on the in-app perf overlay for this load only.
  // We deliberately do NOT persist it: a stale localStorage flag used to keep
  // the panel showing across every launch with no easy way to dismiss it. Now
  // the URL param is the single source of truth, and any leftover flag from
  // older builds is cleared on mount so the overlay never lingers.
  const [perfEnabled, setPerfEnabled] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const enabled = new URLSearchParams(window.location.search).get("perf") === "1";
    try {
      if (enabled) window.localStorage.setItem("DOXMIND_PERF", "1");
      else window.localStorage.removeItem("DOXMIND_PERF");
    } catch {
      // storage may be locked in some sandboxed contexts
    }
    setPerfEnabled(enabled);
  }, []);

  return (
    <>
      <DesktopEditor />

      {isKeyboardShortcutsOpen && KeyboardShortcutsModal && (
        <KeyboardShortcutsModal
          open={isKeyboardShortcutsOpen}
          onClose={() => setKeyboardShortcutsOpen(false)}
        />
      )}
      {isCommandPaletteOpen && CommandPalette && (
        <CommandPalette open={isCommandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
      )}
      {isQuickSwitcherOpen && QuickSwitcher && <QuickSwitcher />}
      {perfEnabled && (
        <PerfOverlay
          onClose={() => {
            try {
              window.localStorage.removeItem("DOXMIND_PERF");
            } catch {
              // storage may be locked in some sandboxed contexts
            }
            setPerfEnabled(false);
          }}
        />
      )}
    </>
  );
}
