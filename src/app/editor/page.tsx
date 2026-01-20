"use client";

import { useEffect, useCallback, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Sidebar } from "@/components/sidebar/sidebar";
import { Editor } from "@/components/editor/editor";
import { ChatPanel } from "@/components/ai/chat-panel";
// Mobile V2 Components (Reading Mode)
import { AdaptiveNav } from "@/components/mobile/adaptive-nav";
import { FilesPanel } from "@/components/mobile/panel-container";
import { MobileActionBar } from "@/components/mobile/mobile-action-bar";
import { VoiceRecordingOverlay } from "@/components/mobile/voice-recording-overlay";
import { FloatingOutline } from "@/components/mobile/floating-outline";
import { VoiceEditPreview } from "@/components/mobile/voice-edit-preview";
// Shared Components
import { LoadingScreen } from "@/components/loading-screen";
import { KeyboardShortcutsModal } from "@/components/ui/keyboard-shortcuts-modal";
import { CommandPalette } from "@/components/ui/command-palette";
import { OnboardingTour } from "@/components/onboarding/onboarding-tour";
import { NetworkStatusIndicator } from "@/components/ui/network-status-indicator";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useBlockSelectionStore } from "@/stores/block-selection-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useEditorStore } from "@/stores/editor-store";
import { useIsMobile } from "@/hooks/use-device-type";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { useHighContrast } from "@/hooks/use-high-contrast";
import { useMobileGestures } from "@/hooks/use-mobile-gestures";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useBlockSelection } from "@/hooks/use-block-selection";
import { useChat } from "@/hooks/use-chat";
import { useDiffReview } from "@/hooks/use-diff-review";
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
    setMobileOutlineOpen,
  } = useLayoutStore();

  const { isSelectionActive, selectedBlocks, getSelectedText, clearSelection } =
    useBlockSelectionStore();

  const { editor } = useEditorRefStore();

  const currentFile = files.find((f) => f.id === currentFileId);
  const isMobile = useIsMobile();

  // Mobile voice recording state
  const [isVoiceRecordingOpen, setVoiceRecordingOpen] = useState(false);

  // Mobile AI chat sheet state
  const [isVoiceEditPreviewOpen, setVoiceEditPreviewOpen] = useState(false);

  // Chat hook for AI interactions
  const { sendMessage, isStreaming, toolHistory, thinking } = useChat();

  // Editor store for chat contexts
  const { addChatContext } = useEditorStore();

  // Diff review hook for accept/reject operations
  const { handleAcceptAll, handleRejectAll } = useDiffReview({
    editor,
    fileId: currentFileId || "",
  });

  // Auth guard - handles 401 responses and redirects to login
  useAuthGuard();

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
        if (isCommandPaletteOpen) {
          setCommandPaletteOpen(false);
        }
        openSearchBarWithAI();
        return;
      }

      // Ctrl+F or Cmd+F - Search bar (find in document)
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        if (isCommandPaletteOpen) {
          setCommandPaletteOpen(false);
        }
        setSearchBarOpen(!isSearchBarOpen);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isKeyboardShortcutsOpen,
    setKeyboardShortcutsOpen,
    isCommandPaletteOpen,
    setCommandPaletteOpen,
    openCommandPalette,
    isSearchBarOpen,
    setSearchBarOpen,
    openSearchBarWithAI,
  ]);

  // Mobile: Handle copy
  const handleCopy = useCallback(() => {
    const text = getSelectedText();
    if (text) {
      navigator.clipboard.writeText(text);
    }
  }, [getSelectedText]);

  // Mobile: Handle cut (copy + delete)
  const handleCut = useCallback(() => {
    const text = getSelectedText();
    if (text && editor) {
      navigator.clipboard.writeText(text);
      // Delete selected blocks
      for (const block of selectedBlocks) {
        editor.chain().focus().deleteRange({ from: block.from, to: block.to }).run();
      }
      clearSelection();
    }
  }, [getSelectedText, editor, selectedBlocks, clearSelection]);

  // Mobile: Handle delete
  const handleDelete = useCallback(() => {
    if (editor && selectedBlocks.length > 0) {
      // Delete selected blocks in reverse order to maintain positions
      const sortedBlocks = [...selectedBlocks].sort((a, b) => b.from - a.from);
      for (const block of sortedBlocks) {
        editor.chain().focus().deleteRange({ from: block.from, to: block.to }).run();
      }
      clearSelection();
    }
  }, [editor, selectedBlocks, clearSelection]);

  // Mobile: Handle AI button click (opens AI Chat Sheet)
  const handleAIOpen = useCallback(() => {
    // If there's selected text, add it as chat context
    const selectedText = getSelectedText();
    if (selectedText && selectedBlocks.length > 0) {
      // Get the range from the first and last selected blocks
      const firstBlock = selectedBlocks[0];
      const lastBlock = selectedBlocks[selectedBlocks.length - 1];
      addChatContext({
        type: "selection",
        text: selectedText,
        from: firstBlock.from,
        to: lastBlock.to,
      });
    }
    setVoiceEditPreviewOpen(true);
  }, [getSelectedText, selectedBlocks, addChatContext]);

  // Mobile: Handle voice transcription complete
  const handleVoiceTranscriptionComplete = useCallback(
    (transcription: string, selectedText: string) => {
      console.log("[Mobile] Voice transcription complete:", transcription);
      if (!currentFile) {
        console.error("[Mobile] No current file!");
        return;
      }

      // Build the AI message with context
      const message = selectedText
        ? `Based on the following selected text:\n\n"${selectedText}"\n\n${transcription}`
        : transcription;

      // Send to AI chat
      sendMessage(message, [currentFile.id]);

      // Close voice overlay and clear selection
      setVoiceRecordingOpen(false);
      clearSelection();
    },
    [currentFile, sendMessage, clearSelection]
  );

  // Mobile Layout: Reading-focused with block selection
  if (isMobile) {
    return (
      <LoadingScreen isLoading={isLoading} isMobile={true}>
        <AppShell>
          <div
            className="flex h-full flex-col"
            style={{
              // Adjust padding based on what's showing at the bottom
              paddingBottom: isSelectionActive
                ? 0 // Action bar handles its own spacing
                : MOBILE_V2.NAV_BAR_HEIGHT + 16,
            }}
          >
            {/* Editor Content - Always Visible */}
            <main id="main-content" className="flex-1 overflow-hidden">
              {currentFile ? <Editor file={currentFile} /> : <WelcomeScreen />}
            </main>
          </div>

          {/* Mobile: Adaptive Bottom Navigation (AI + Files) */}
          <AdaptiveNav onAITap={handleAIOpen} />

          {/* Mobile: Action Bar (shows when blocks are selected via tap) */}
          <MobileActionBar
            onCopy={handleCopy}
            onCut={handleCut}
            onDelete={handleDelete}
            onAIVoice={handleAIOpen}
          />

          {/* Mobile: Voice Recording Overlay */}
          <VoiceRecordingOverlay
            isOpen={isVoiceRecordingOpen}
            onClose={() => setVoiceRecordingOpen(false)}
            onTranscriptionComplete={handleVoiceTranscriptionComplete}
          />

          {/* Mobile: Files Panel (slide from right) */}
          <FilesPanel isOpen={isMobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)}>
            <Sidebar />
          </FilesPanel>

          {/* Mobile: Floating Outline (Google Docs style) */}
          <FloatingOutline />

          {/* Mobile: AI Chat Sheet */}
          <VoiceEditPreview
            isOpen={isVoiceEditPreviewOpen}
            isStreaming={isStreaming}
            toolHistory={toolHistory}
            thinking={thinking}
            onAccept={() => {
              handleAcceptAll();
              setVoiceEditPreviewOpen(false);
            }}
            onReject={() => {
              handleRejectAll();
              setVoiceEditPreviewOpen(false);
            }}
            onClose={() => {
              setVoiceEditPreviewOpen(false);
            }}
            onVoiceRecord={() => {
              setVoiceRecordingOpen(true);
            }}
          />

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
