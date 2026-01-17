"use client";

import { useEffect, useCallback } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Sidebar } from "@/components/sidebar/sidebar";
import { Editor } from "@/components/editor/editor";
import { ChatPanel } from "@/components/ai/chat-panel";
// Mobile V2 Components
import { AdaptiveNav } from "@/components/mobile/adaptive-nav";
import { AIPanel } from "@/components/mobile/ai-panel";
import { BlockSelector } from "@/components/mobile/block-selector";
import { FilesPanel, OutlinePanel } from "@/components/mobile/panel-container";
// Legacy mobile components (for outline content)
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
import { useMobileGestures } from "@/hooks/use-mobile-gestures";
import { cn } from "@/lib/utils";
import { WelcomeScreen } from "@/components/welcome-screen";
import { MOBILE_V2 } from "@/lib/constants";

export default function EditorPage() {
  const { currentFileId, files, loadFiles, isLoading } = useFileStore();
  const {
    isChatOpen,
    isSidebarOpen,
    isKeyboardShortcutsOpen,
    setKeyboardShortcutsOpen,
    isCommandPaletteOpen,
    setCommandPaletteOpen,
    openCommandPalette,
    isSearchBarOpen,
    setSearchBarOpen,
    openSearchBarWithAI,
    // Mobile V2 state
    isMobileSidebarOpen,
    setMobileSidebarOpen,
    isMobileOutlineOpen,
    setMobileOutlineOpen,
    aiPanelState,
  } = useLayoutStore();
  const currentFile = files.find((f) => f.id === currentFileId);
  const isMobile = useIsMobile();

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

      // Ctrl+K or Cmd+K - Command palette (all scope)
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        if (isCommandPaletteOpen) {
          setCommandPaletteOpen(false);
        } else {
          openCommandPalette();
        }
        return;
      }

      // Ctrl+Shift+F or Cmd+Shift+F - AI Search (semantic search)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        // Close command palette if open
        if (isCommandPaletteOpen) {
          setCommandPaletteOpen(false);
        }
        // Open search bar in AI mode
        openSearchBarWithAI();
        return;
      }

      // Ctrl+F or Cmd+F - Search bar (find in document)
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        // Close command palette if open
        if (isCommandPaletteOpen) {
          setCommandPaletteOpen(false);
        }
        // Toggle search bar
        setSearchBarOpen(!isSearchBarOpen);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isKeyboardShortcutsOpen, setKeyboardShortcutsOpen, isCommandPaletteOpen, setCommandPaletteOpen, openCommandPalette, isSearchBarOpen, setSearchBarOpen, openSearchBarWithAI]);

  // Mobile Layout V2: Redesigned with adaptive navigation and gesture support
  if (isMobile) {
    return (
      <LoadingScreen isLoading={isLoading} isMobile={true}>
        <AppShell>
          <div
            className="flex flex-col h-full"
            style={{
              // Nav bar height (48px) + extra space for FAB (16px) + safe area
              paddingBottom:
                aiPanelState === "closed" ? MOBILE_V2.NAV_BAR_HEIGHT + 16 : 0,
            }}
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

          {/* Mobile V2: Adaptive Bottom Navigation */}
          <AdaptiveNav />

          {/* Mobile V2: Files Panel (slide from right on edge swipe) */}
          <FilesPanel
            isOpen={isMobileSidebarOpen}
            onClose={() => setMobileSidebarOpen(false)}
          >
            <Sidebar />
          </FilesPanel>

          {/* Mobile V2: AI Panel (multi-mode bottom sheet) */}
          {currentFile && <AIPanel />}

          {/* Mobile V2: Block Selector */}
          <BlockSelector editor={null} />

          {/* Mobile Outline Sheet (using legacy for now - can be upgraded later) */}
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
