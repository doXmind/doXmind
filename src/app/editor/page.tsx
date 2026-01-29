"use client";

import { useEffect, useCallback } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Sidebar } from "@/components/sidebar/sidebar";
import { Editor } from "@/components/editor/editor";
import { ChatPanel } from "@/components/ai/chat-panel";
// Mobile V3 Components (New Design)
import { MobileEditorLayout } from "@/components/mobile/mobile-editor-layout";
// Shared Components
import { LoadingScreen } from "@/components/loading-screen";
import { KeyboardShortcutsModal } from "@/components/ui/keyboard-shortcuts-modal";
import { CommandPalette } from "@/components/ui/command-palette";
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
import { cn } from "@/lib/utils";
import { WelcomeScreen } from "@/components/welcome-screen";

export default function EditorPage() {
  const { currentFileId, files, loadFiles, isLoading } = useFileStore();
  const {
    isChatOpen,
    isSidebarOpen,
    isKeyboardShortcutsOpen,
    setKeyboardShortcutsOpen,
    isCommandPaletteOpen,
    setCommandPaletteOpen,
    setMobileSidebarOpen,
    setMobileOutlineOpen,
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
      <AppShell>
        <div className="flex h-full">
          {/* Sidebar */}
          <aside
            className={cn(
              "w-64 flex-shrink-0 border-r border-border bg-card transition-all duration-300",
              !isSidebarOpen && "w-0 overflow-hidden opacity-0"
            )}
          >
            <Sidebar />
          </aside>

          {/* Main Editor Area */}
          <main id="main-content" className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {currentFile ? <Editor file={currentFile} /> : <WelcomeScreen />}
          </main>

          {/* AI Chat Panel - Only show when a file is open */}
          {currentFile && (
            <aside
              className={cn(
                "w-96 flex-shrink-0 border-l border-border bg-card transition-all duration-300",
                !isChatOpen && "w-0 overflow-hidden opacity-0"
              )}
            >
              <ChatPanel />
            </aside>
          )}
        </div>

        {/* Keyboard Shortcuts Modal */}
        <KeyboardShortcutsModal
          open={isKeyboardShortcutsOpen}
          onClose={() => setKeyboardShortcutsOpen(false)}
        />

        {/* Command Palette */}
        <CommandPalette open={isCommandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />

        {/* Onboarding Tour */}
        <OnboardingTour />

        {/* Network Status */}
        <NetworkStatusIndicator />
      </AppShell>
    </LoadingScreen>
  );
}
