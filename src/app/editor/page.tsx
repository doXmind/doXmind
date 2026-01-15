"use client";

import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Sidebar } from "@/components/sidebar/sidebar";
import { Editor } from "@/components/editor/editor";
import { ChatPanel } from "@/components/ai/chat-panel";
import { MobileNavBar } from "@/components/mobile/mobile-nav-bar";
import { MobileSidebar } from "@/components/mobile/mobile-sidebar";
import { MobileChatSheet } from "@/components/mobile/mobile-chat-sheet";
import { MobileOutlineSheet } from "@/components/mobile/mobile-outline-sheet";
import { LoadingScreen } from "@/components/loading-screen";
import { KeyboardShortcutsModal } from "@/components/ui/keyboard-shortcuts-modal";
import { CommandPalette } from "@/components/ui/command-palette";
import { OnboardingTour } from "@/components/onboarding/onboarding-tour";
import { NetworkStatusIndicator } from "@/components/ui/network-status-indicator";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useIsMobile } from "@/hooks/use-device-type";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { useHighContrast } from "@/hooks/use-high-contrast";
import { cn } from "@/lib/utils";
import { WelcomeScreen } from "@/components/welcome-screen";
import { MOBILE_PANEL } from "@/lib/constants";

export default function EditorPage() {
  const { currentFileId, files, loadFiles, isLoading } = useFileStore();
  const { isChatOpen, isSidebarOpen, isKeyboardShortcutsOpen, setKeyboardShortcutsOpen, isCommandPaletteOpen, setCommandPaletteOpen } = useLayoutStore();
  const currentFile = files.find((f) => f.id === currentFileId);
  const isMobile = useIsMobile();

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

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+? or Cmd+? (Shift+/ on most keyboards) - Keyboard shortcuts
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "?") {
        e.preventDefault();
        setKeyboardShortcutsOpen(!isKeyboardShortcutsOpen);
        return;
      }

      // Ctrl+K or Cmd+K - Command palette
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(!isCommandPaletteOpen);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isKeyboardShortcutsOpen, setKeyboardShortcutsOpen, isCommandPaletteOpen, setCommandPaletteOpen]);

  // Mobile Layout: Editor always visible + overlay sheets/sidebar
  if (isMobile) {
    return (
      <LoadingScreen isLoading={isLoading} isMobile={true}>
        <AppShell>
          <div
            className="flex flex-col h-full"
            style={{ paddingBottom: MOBILE_PANEL.BOTTOM_NAV_HEIGHT }}
          >
            {/* Editor Content - Always Visible */}
            <main id="main-content" className="flex-1 overflow-hidden">
              {currentFile ? (
                <Editor file={currentFile} />
              ) : (
                <WelcomeScreen />
              )}
            </main>
          </div>

          {/* Mobile Bottom Navigation */}
          <MobileNavBar />

          {/* Mobile Sidebar Overlay (Files) */}
          <MobileSidebar />

          {/* Mobile Chat Bottom Sheet (AI) - Only show when a file is open */}
          {currentFile && <MobileChatSheet />}

          {/* Mobile Outline Sheet */}
          <MobileOutlineSheet />

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
              "w-64 border-r border-border bg-card flex-shrink-0 transition-all duration-300",
              !isSidebarOpen && "w-0 opacity-0 overflow-hidden"
            )}
          >
            <Sidebar />
          </aside>

          {/* Main Editor Area */}
          <main id="main-content" className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {currentFile ? (
              <Editor file={currentFile} />
            ) : (
              <WelcomeScreen />
            )}
          </main>

          {/* AI Chat Panel - Only show when a file is open */}
          {currentFile && (
            <aside
              className={cn(
                "w-96 border-l border-border bg-card flex-shrink-0 transition-all duration-300",
                !isChatOpen && "w-0 opacity-0 overflow-hidden"
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
