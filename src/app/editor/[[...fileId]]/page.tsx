"use client";

import { useEffect, useCallback, useState, Suspense } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Sidebar } from "@/components/sidebar/sidebar";
import { FilesSidebar } from "@/components/sidebar/files-sidebar";
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
import { ONBOARDING_STEPS } from "@/stores/onboarding-store";
import { NetworkStatusIndicator } from "@/components/ui/network-status-indicator";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useOnboardingStore } from "@/stores/onboarding-store";
import { useIsMobile } from "@/hooks/use-device-type";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { useHighContrast } from "@/hooks/use-high-contrast";
import { useMobileGestures } from "@/hooks/use-mobile-gestures";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useBlockSelection } from "@/hooks/use-block-selection";
import { useDiffReview } from "@/hooks/use-diff-review";
import { useEditorKeyboardShortcuts } from "@/hooks/use-editor-keyboard-shortcuts";
import { useFileUrlSync } from "@/hooks/use-file-url-sync";
import { useOnboardingStepDetector } from "@/hooks/use-onboarding-step-detector";
import { PanelLeftOpen } from "lucide-react";
import { useHeadings } from "@/components/editor/mindlines/use-headings";
import { cn } from "@/lib/utils";
import { WelcomeScreen } from "@/components/welcome-screen";
import { UnifiedHeader } from "@/components/editor/unified-header";
import { FloatingChatButton } from "@/components/ai/floating-chat-button";
import { FloatingChatWindow } from "@/components/ai/floating-chat-window";
import { PresentationMode } from "@/components/editor/presentation-mode";

/**
 * Legacy URL redirect: /editor?id=xxx -> /editor/xxx
 * Wrapped in Suspense because useSearchParams() requires it in Next.js 15
 * to avoid suspending the entire page tree during client-side navigation.
 */
function LegacyUrlRedirect() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const legacyId = searchParams.get("id");
  useEffect(() => {
    if (legacyId) {
      router.replace(`/editor/${legacyId}`);
    }
  }, [legacyId, router]);
  return null;
}

export default function EditorPage() {
  const params = useParams();
  const router = useRouter();

  // [[...fileId]] gives params.fileId as string[] | undefined
  // /editor -> undefined, /editor/abc123 -> ["abc123"]
  const fileIdFromUrl = (params.fileId as string[] | undefined)?.[0] ?? null;

  const {
    currentFileId,
    files,
    loadFiles,
    isLoading,
    isSynced,
    loadFileContent,
    loadedContentIds,
  } = useFileStore();

  // Sync URL <-> Zustand store
  useFileUrlSync(fileIdFromUrl);

  const {
    isChatOpen,
    chatMode,
    isSidebarOpen,
    toggleSidebar,
    isFilesSidebarOpen,
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
    filesSidebarWidth,
    chatPanelWidth,
    setFilesSidebarWidth,
    setChatPanelWidth,
    resetPanelWidths,
  } = useLayoutStore();

  const { editor } = useEditorRefStore();
  const { headings } = useHeadings(editor);
  const hasHeadings = headings.length > 0;
  const currentFile = files.find((f) => f.id === currentFileId);
  const isMobile = useIsMobile();
  const [isResizing, setIsResizing] = useState(false);

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

  // Interactive onboarding step detection
  useOnboardingStepDetector();

  // Bind tutorial file when the tour navigates to an editor step
  const { onboardingCompleted, currentStepIndex } = useOnboardingStore();
  useEffect(() => {
    if (onboardingCompleted || currentStepIndex < 0) return;
    if (isLoading) return;
    const step = ONBOARDING_STEPS[currentStepIndex];
    if (!step || step.page !== "editor") return;
    if (useOnboardingStore.getState().tutorialFileId) return;

    const existingTutorial = files.find((f) => f.name.startsWith("Getting Started with doXmind"));
    if (existingTutorial) {
      useOnboardingStore.getState().setTutorialFileId(existingTutorial.id);
      router.push(`/editor/${existingTutorial.id}`);
    }
  }, [onboardingCompleted, currentStepIndex, isLoading, files, router]);

  // Load files from server on mount
  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Load file content on demand when current file changes
  useEffect(() => {
    if (currentFileId && !loadedContentIds.has(currentFileId)) {
      loadFileContent(currentFileId);
    }
  }, [currentFileId, loadedContentIds, loadFileContent]);

  // Update browser tab title based on current file
  useEffect(() => {
    if (currentFile) {
      document.title = currentFile.name.replace(/\.md$/i, "");
    } else {
      document.title = "doXmind - AI Writing Studio";
    }
  }, [currentFile]);

  // Mobile Layout: New design with always-visible input
  if (isMobile) {
    return (
      <LoadingScreen isLoading={isLoading} isMobile={true}>
        {/* Legacy URL handler — isolated in Suspense to avoid blocking the page */}
        <Suspense fallback={null}>
          <LegacyUrlRedirect />
        </Suspense>
        <AppShell hideHeader>
          <MobileEditorLayout>
            {/* Editor Content - no overflow-hidden to allow parent scrolling */}
            <div id="main-content">
              {currentFile ? (
                loadedContentIds.has(currentFile.id) ? (
                  <Editor file={currentFile} />
                ) : (
                  <div className="flex flex-1 items-center justify-center">
                    <div className="animate-pulse text-muted-foreground">Loading...</div>
                  </div>
                )
              ) : !isSynced && currentFileId ? (
                <div className="flex flex-1 items-center justify-center">
                  <div className="animate-pulse text-muted-foreground">Loading...</div>
                </div>
              ) : (
                <WelcomeScreen />
              )}
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

          {/* Presentation Mode */}
          <PresentationMode />

          {/* Network Status */}
          <NetworkStatusIndicator />
        </AppShell>
      </LoadingScreen>
    );
  }

  // Desktop Layout: Three-panel view
  return (
    <LoadingScreen isLoading={isLoading} isMobile={false}>
      {/* Legacy URL handler — isolated in Suspense to avoid blocking the page */}
      <Suspense fallback={null}>
        <LegacyUrlRedirect />
      </Suspense>
      <AppShell hideHeader>
        <div className="flex h-full flex-col">
          {/* Unified Header — spans full width, above all panels */}
          {!isFocusMode && <UnifiedHeader />}

          <div className="flex min-h-0 flex-1">
            {/* Files Sidebar - independent, hidden in focus mode */}
            {!isFocusMode && (
              <>
                <aside
                  style={{ width: isFilesSidebarOpen ? filesSidebarWidth : 0 }}
                  className={cn(
                    "bg-sidebar flex-shrink-0 overflow-hidden",
                    !isResizing &&
                      "transition-[width] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]"
                  )}
                >
                  <div style={{ minWidth: filesSidebarWidth }} className="h-full">
                    <FilesSidebar />
                  </div>
                </aside>
                {isFilesSidebarOpen && (
                  <ResizeHandle
                    side="left"
                    onResize={(delta) => setFilesSidebarWidth(filesSidebarWidth + delta)}
                    onResizeStart={() => setIsResizing(true)}
                    onResizeEnd={() => setIsResizing(false)}
                    onDoubleClick={() => resetPanelWidths()}
                  />
                )}
              </>
            )}

            {/* Main Editor Area — Outline is embedded inside, sharing the same background */}
            <main
              id="main-content"
              className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
            >
              {/* Inline Outline Panel — fused with editor */}
              {!isFocusMode && hasHeadings && (
                <div
                  style={{ width: isSidebarOpen ? sidebarWidth : 0 }}
                  className={cn(
                    "flex-shrink-0 overflow-hidden",
                    !isResizing &&
                      "transition-[width] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]"
                  )}
                >
                  <div style={{ minWidth: sidebarWidth }} className="h-full">
                    <Sidebar />
                  </div>
                </div>
              )}

              {/* Outline border when open */}
              {!isFocusMode && hasHeadings && isSidebarOpen && (
                <div className="h-full w-px flex-shrink-0 bg-border/30" />
              )}

              {/* Editor content */}
              <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
                {/* Show Outline button when collapsed */}
                {!isFocusMode && hasHeadings && !isSidebarOpen && (
                  <button
                    onClick={toggleSidebar}
                    className="absolute left-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                    aria-label="Show Outline"
                    title="Show Outline"
                  >
                    <PanelLeftOpen className="h-4 w-4" />
                  </button>
                )}
                {currentFile ? (
                  loadedContentIds.has(currentFile.id) ? (
                    <Editor file={currentFile} />
                  ) : (
                    <div className="flex flex-1 items-center justify-center">
                      <div className="animate-pulse text-muted-foreground">Loading...</div>
                    </div>
                  )
                ) : !isSynced && currentFileId ? (
                  <div className="flex flex-1 items-center justify-center">
                    <div className="animate-pulse text-muted-foreground">Loading...</div>
                  </div>
                ) : (
                  <WelcomeScreen />
                )}
                {/* Floating chat window — overlays editor when in floating mode */}
                {!isFocusMode && currentFile && chatMode === "floating" && <FloatingChatWindow />}
                {/* Floating AI button — visible when chat is closed */}
                {!isFocusMode && currentFile && !isChatOpen && <FloatingChatButton />}
              </div>
            </main>

            {/* AI Chat Panel (sidebar mode) - hidden in focus mode */}
            {!isFocusMode && currentFile && chatMode === "sidebar" && (
              <>
                {isChatOpen && (
                  <ResizeHandle
                    side="right"
                    onResize={(delta) => setChatPanelWidth(chatPanelWidth + delta)}
                    onResizeStart={() => setIsResizing(true)}
                    onResizeEnd={() => setIsResizing(false)}
                    onDoubleClick={() => resetPanelWidths()}
                  />
                )}
                <aside
                  style={{ width: isChatOpen ? chatPanelWidth : 0 }}
                  className={cn(
                    "bg-sidebar flex-shrink-0 overflow-hidden",
                    !isResizing &&
                      "transition-[width] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]"
                  )}
                >
                  <div style={{ minWidth: chatPanelWidth }} className="h-full">
                    <ChatPanel />
                  </div>
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
          <CommandPalette
            open={isCommandPaletteOpen}
            onClose={() => setCommandPaletteOpen(false)}
          />

          {/* Quick File Switcher */}
          <QuickSwitcher />

          {/* Presentation Mode */}
          <PresentationMode />

          {/* Network Status */}
          <NetworkStatusIndicator />
        </div>
      </AppShell>
    </LoadingScreen>
  );
}
