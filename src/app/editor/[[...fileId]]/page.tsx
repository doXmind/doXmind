"use client";

import { useEffect, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Sidebar } from "@/components/sidebar/sidebar";
import { Editor } from "@/components/editor/editor";
import { ChatPanel } from "@/components/ai/chat-panel";
import { VersionHistoryPanel } from "@/components/editor/version-history-panel";
import { ResizeHandle } from "@/components/ui/resize-handle";
// Mobile V3 Components (New Design)
import { MobileEditorLayout } from "@/components/mobile/mobile-editor-layout";
// Shared Components
import { LoadingScreen } from "@/components/loading-screen";
import { KeyboardShortcutsModal } from "@/components/ui/keyboard-shortcuts-modal";
import { CommandPalette } from "@/components/ui/command-palette";
import { QuickSwitcher } from "@/components/ui/quick-switcher";
import { OnboardingTour } from "@/components/onboarding/onboarding-tour";
import { NetworkStatusIndicator } from "@/components/ui/network-status-indicator";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useIsMobile } from "@/hooks/use-device-type";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { useHighContrast } from "@/hooks/use-high-contrast";
import { useMobileGestures } from "@/hooks/use-mobile-gestures";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useBlockSelection } from "@/hooks/use-block-selection";
import { useDiffReview } from "@/hooks/use-diff-review";
import { useEditorKeyboardShortcuts } from "@/hooks/use-editor-keyboard-shortcuts";
import { useFileUrlSync } from "@/hooks/use-file-url-sync";
import { cn } from "@/lib/utils";
import { WelcomeScreen } from "@/components/welcome-screen";

export default function EditorPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  // [[...fileId]] gives params.fileId as string[] | undefined
  // /editor -> undefined, /editor/abc123 -> ["abc123"]
  const fileIdFromUrl = (params.fileId as string[] | undefined)?.[0] ?? null;

  // Legacy URL format: /editor?id=xxx -> /editor/xxx
  const legacyId = searchParams.get("id");
  useEffect(() => {
    if (legacyId) {
      router.replace(`/editor/${legacyId}`);
    }
  }, [legacyId, router]);

  const { currentFileId, files, loadFiles, isLoading } = useFileStore();

  // Sync URL <-> Zustand store
  useFileUrlSync(fileIdFromUrl);

  const {
    isChatOpen,
    isSidebarOpen,
    isFocusMode,
    setFocusMode,
    isVersionHistoryOpen,
    setVersionHistoryOpen,
    isKeyboardShortcutsOpen,
    setKeyboardShortcutsOpen,
    isCommandPaletteOpen,
    setCommandPaletteOpen,
    setMobileSidebarOpen,
    setMobileOutlineOpen,
    sidebarWidth,
    chatPanelWidth,
    setSidebarWidth,
    setChatPanelWidth,
    resetPanelWidths,
  } = useLayoutStore();

  const { editor } = useEditorRefStore();
  const currentFile = files.find((f) => f.id === currentFileId);
  const isMobile = useIsMobile();

  // Auth guard - handles 401 responses and redirects to login
  useAuthGuard();

  // Global keyboard shortcuts (Ctrl+K, Ctrl+F, etc.)
  useEditorKeyboardShortcuts();

  // Mobile block selection (tap to select)
  useBlockSelection({
    editor,
    enabled: isMobile,
  });

  // Mobile gesture navigation
  const handleEdgeSwipe = useCallback(
    (event: { edge: string; completed: boolean }) => {
      if (!event.completed) return;

      switch (event.edge) {
        case "left":
          setMobileOutlineOpen(true);
          break;
        case "right":
          setMobileSidebarOpen(true);
          break;
      }
    },
    [setMobileSidebarOpen, setMobileOutlineOpen]
  );

  useMobileGestures({
    onEdgeSwipe: handleEdgeSwipe,
    enabled: isMobile,
  });

  // Diff review hook for accept/reject operations
  useDiffReview({
    editor,
    fileId: currentFileId || "",
  });

  // Warn user when leaving with unsaved changes
  useUnsavedChangesWarning();

  // Apply high contrast mode from persisted settings
  useHighContrast();

  // Load files from server on mount
  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Update browser tab title based on current file
  useEffect(() => {
    if (currentFile) {
      document.title = `${currentFile.name} - doXmind`;
    } else {
      document.title = "doXmind - AI Writing Studio";
    }
  }, [currentFile]);

  // Mobile Layout: New design with always-visible input
  if (isMobile) {
    return (
      <LoadingScreen isLoading={isLoading} isMobile={true}>
        <AppShell hideHeader>
          <MobileEditorLayout>
            {/* Editor Content - no overflow-hidden to allow parent scrolling */}
            <div id="main-content">
              {currentFile ? <Editor file={currentFile} /> : <WelcomeScreen />}
            </div>
          </MobileEditorLayout>

          {/* Keyboard Shortcuts Modal */}
          <KeyboardShortcutsModal
            open={isKeyboardShortcutsOpen}
            onClose={() => setKeyboardShortcutsOpen(false)}
          />

          {/* Command Palette */}
          <CommandPalette
            open={isCommandPaletteOpen}
            onClose={() => setCommandPaletteOpen(false)}
          />

          {/* Quick File Switcher */}
          <QuickSwitcher />

          {/* Onboarding Tour */}
          <OnboardingTour />

          {/* Network Status */}
          <NetworkStatusIndicator />
        </AppShell>
      </LoadingScreen>
    );
  }

  // Desktop Layout: Three-panel view
  return (
    <LoadingScreen isLoading={isLoading} isMobile={false}>
      <AppShell hideHeader={isFocusMode}>
        <div className="flex h-full">
          {/* Sidebar - hidden in focus mode */}
          {!isFocusMode && (
            <>
              <aside
                style={{ width: isSidebarOpen ? sidebarWidth : 0 }}
                className={cn(
                  "flex-shrink-0 border-r border-border bg-card transition-[opacity] duration-300",
                  !isSidebarOpen && "overflow-hidden opacity-0"
                )}
              >
                <Sidebar />
              </aside>
              {isSidebarOpen && (
                <ResizeHandle
                  side="left"
                  onResize={(delta) => setSidebarWidth(sidebarWidth + delta)}
                  onDoubleClick={() => resetPanelWidths()}
                />
              )}
            </>
          )}

          {/* Main Editor Area */}
          <main id="main-content" className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {currentFile ? <Editor file={currentFile} /> : <WelcomeScreen />}
          </main>

          {/* AI Chat Panel - hidden in focus mode */}
          {!isFocusMode && currentFile && (
            <>
              {isChatOpen && (
                <ResizeHandle
                  side="right"
                  onResize={(delta) => setChatPanelWidth(chatPanelWidth + delta)}
                  onDoubleClick={() => resetPanelWidths()}
                />
              )}
              <aside
                style={{ width: isChatOpen ? chatPanelWidth : 0 }}
                className={cn(
                  "flex-shrink-0 border-l border-border bg-card transition-[opacity] duration-300",
                  !isChatOpen && "overflow-hidden opacity-0"
                )}
              >
                <ChatPanel />
              </aside>
            </>
          )}

          {/* Version History Panel - hidden in focus mode */}
          {!isFocusMode && currentFile && isVersionHistoryOpen && (
            <VersionHistoryPanel
              fileId={currentFile.id}
              isOpen={isVersionHistoryOpen}
              onClose={() => setVersionHistoryOpen(false)}
            />
          )}
        </div>

        {/* Focus mode: floating exit bar (visible on hover) */}
        {isFocusMode && (
          <div className="fixed left-1/2 top-0 z-50 -translate-x-1/2 opacity-0 transition-opacity duration-300 hover:opacity-100">
            <button
              onClick={() => setFocusMode(false)}
              className="mt-2 rounded-full border border-border bg-card/80 px-4 py-1.5 text-xs text-muted-foreground shadow-lg backdrop-blur-sm transition-colors hover:text-foreground"
            >
              Exit Focus Mode (F11)
            </button>
          </div>
        )}

        {/* Keyboard Shortcuts Modal */}
        <KeyboardShortcutsModal
          open={isKeyboardShortcutsOpen}
          onClose={() => setKeyboardShortcutsOpen(false)}
        />

        {/* Command Palette */}
        <CommandPalette open={isCommandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />

        {/* Quick File Switcher */}
        <QuickSwitcher />

        {/* Onboarding Tour */}
        <OnboardingTour />

        {/* Network Status */}
        <NetworkStatusIndicator />
      </AppShell>
    </LoadingScreen>
  );
}
