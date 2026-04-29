"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";

import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useIsMobile } from "@/hooks/use-device-type";
import { useHighContrast } from "@/hooks/use-high-contrast";
import { useEditorKeyboardShortcuts } from "@/hooks/use-editor-keyboard-shortcuts";
import { useFileUrlSync } from "@/hooks/use-file-url-sync";
import { DesktopEditor } from "./_components/desktop-editor";
import { MobileEditor } from "./_components/mobile-editor";

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
  const files = useFileStore((s) => s.files);
  const loadFiles = useFileStore((s) => s.loadFiles);
  const isSynced = useFileStore((s) => s.isSynced);
  const loadFileContent = useFileStore((s) => s.loadFileContent);

  useFileUrlSync(fileIdFromUrl);
  useEditorKeyboardShortcuts();
  useHighContrast();

  const isKeyboardShortcutsOpen = useLayoutStore((s) => s.isKeyboardShortcutsOpen);
  const setKeyboardShortcutsOpen = useLayoutStore((s) => s.setKeyboardShortcutsOpen);
  const isCommandPaletteOpen = useLayoutStore((s) => s.isCommandPaletteOpen);
  const setCommandPaletteOpen = useLayoutStore((s) => s.setCommandPaletteOpen);

  const isMobile = useIsMobile();
  const currentFile = files.find((f) => f.id === currentFileId);

  // Load file list once on mount.
  useEffect(() => {
    if (!isSynced) {
      loadFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on mount
  }, []);

  // Load file content on demand when current file changes.
  useEffect(() => {
    if (!isSynced) return;
    if (currentFileId && !useFileStore.getState().loadedContentIds.has(currentFileId)) {
      loadFileContent(currentFileId);
    }
  }, [currentFileId, loadFileContent, isSynced]);

  // Sync browser tab title with current file
  useEffect(() => {
    document.title = currentFile ? currentFile.name.replace(/\.md$/i, "") : "doXmind";
  }, [currentFile]);

  return (
    <>
      {isMobile ? <MobileEditor /> : <DesktopEditor />}

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
