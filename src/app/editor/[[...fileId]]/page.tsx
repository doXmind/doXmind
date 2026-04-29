"use client";

import { useEffect, useCallback, useState, Suspense } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { AppShell } from "@/components/layout/app-shell";
import { Sidebar } from "@/components/sidebar/sidebar";
import { FilesSidebar } from "@/components/sidebar/files-sidebar";
import { Editor } from "@/components/editor/editor";
import { ResizeHandle } from "@/components/ui/resize-handle";
// Shared Components
import { LoadingScreen } from "@/components/loading-screen";
import { NetworkStatusIndicator } from "@/components/ui/network-status-indicator";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useIsMobile } from "@/hooks/use-device-type";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { useHighContrast } from "@/hooks/use-high-contrast";
import { useMobileGestures } from "@/hooks/use-mobile-gestures";
import { useBlockSelection } from "@/hooks/use-block-selection";
import { useEditorKeyboardShortcuts } from "@/hooks/use-editor-keyboard-shortcuts";
import { useFileUrlSync } from "@/hooks/use-file-url-sync";
import { ErrorBoundary } from "@/components/error-boundary";
import { PanelLeftOpen } from "lucide-react";
import { useHeadings } from "@/components/editor/mindlines/use-headings";
import { OutlineCollapsed } from "@/components/editor/mindlines/outline-collapsed";
import { cn } from "@/lib/utils";
import { WelcomeScreen } from "@/components/welcome-screen";
import { UnifiedHeader } from "@/components/editor/unified-header";

// Dynamic imports — cold-path components split into separate chunks
const VersionHistoryPanel = dynamic(
  () =>
    import("@/components/editor/version-history-panel").then((m) => ({
      default: m.VersionHistoryPanel,
    })),
  { ssr: false }
);
const MobileEditorLayout = dynamic(
  () =>
    import("@/components/mobile/mobile-editor-layout").then((m) => ({
      default: m.MobileEditorLayout,
    })),
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

  // [[...fileId]] gives params.fileId as string[] | undefined
  // /editor -> undefined, /editor/abc123 -> ["abc123"]
  const fileIdFromUrl = (params.fileId as string[] | undefined)?.[0] ?? null;

  // Fine-grained Zustand selectors — only re-render when the specific field changes
  const currentFileId = useFileStore((s) => s.currentFileId);
  const files = useFileStore((s) => s.files);
  const loadFiles = useFileStore((s) => s.loadFiles);
  const isLoading = useFileStore((s) => s.isLoading);
  const isSynced = useFileStore((s) => s.isSynced);
  const loadFileContent = useFileStore((s) => s.loadFileContent);
  const loadedContentIds = useFileStore((s) => s.loadedContentIds);

  // Sync URL <-> Zustand store
  useFileUrlSync(fileIdFromUrl);

  const isSidebarOpen = useLayoutStore((s) => s.isSidebarOpen);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const isFilesSidebarOpen = useLayoutStore((s) => s.isFilesSidebarOpen);
  const isFocusMode = useLayoutStore((s) => s.isFocusMode);
  const setFocusMode = useLayoutStore((s) => s.setFocusMode);
  const isVersionHistoryOpen = useLayoutStore((s) => s.isVersionHistoryOpen);
  const setVersionHistoryOpen = useLayoutStore((s) => s.setVersionHistoryOpen);
  const isKeyboardShortcutsOpen = useLayoutStore((s) => s.isKeyboardShortcutsOpen);
  const setKeyboardShortcutsOpen = useLayoutStore((s) => s.setKeyboardShortcutsOpen);
  const isCommandPaletteOpen = useLayoutStore((s) => s.isCommandPaletteOpen);
  const setCommandPaletteOpen = useLayoutStore((s) => s.setCommandPaletteOpen);
  const setMobileSidebarOpen = useLayoutStore((s) => s.setMobileSidebarOpen);
  const setMobileOutlineOpen = useLayoutStore((s) => s.setMobileOutlineOpen);
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth);
  const filesSidebarWidth = useLayoutStore((s) => s.filesSidebarWidth);
  const setFilesSidebarWidth = useLayoutStore((s) => s.setFilesSidebarWidth);
  const resetPanelWidths = useLayoutStore((s) => s.resetPanelWidths);

  const editor = useEditorRefStore((s) => s.editor);
  const { headings, activeId, navigateTo } = useHeadings(editor);
  const hasHeadings = headings.length > 0;
  const currentFile = files.find((f) => f.id === currentFileId);
  const isMobile = useIsMobile();
  const [isResizing, setIsResizing] = useState(false);

  // Auth guard - handles 401 responses and redirects to login

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

  // Warn user when leaving with unsaved changes
  useUnsavedChangesWarning();

  // Apply high contrast mode from persisted settings
  useHighContrast();

  // Load files from server on mount. Skip if already synced to avoid redundant
  // fetches on page remounts (Next.js re-keys the page on param changes).
  useEffect(() => {
    if (!isSynced) {
      loadFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on mount
  }, []);

  // Load file content on demand when current file changes.
  // Wait for isSynced to avoid racing with loadFiles() which clears loadedContentIds.
  useEffect(() => {
    if (!isSynced) return;
    if (currentFileId && !useFileStore.getState().loadedContentIds.has(currentFileId)) {
      loadFileContent(currentFileId);
    }
  }, [currentFileId, loadFileContent, isSynced]);

  // Update browser tab title based on current file
  useEffect(() => {
    if (currentFile) {
      document.title = currentFile.name.replace(/\.md$/i, "");
    } else {
      document.title = "doXmind - Local Writing Studio";
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
              <ErrorBoundary>
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
              </ErrorBoundary>
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
      {/* Legacy URL handler — isolated in Suspense */}
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
              {!isFocusMode &&
                hasHeadings &&
                (isSidebarOpen ? (
                  <div
                    style={{ width: sidebarWidth }}
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
                ) : (
                  /* Collapsed outline with line indicators */
                  <div className="flex h-full w-12 flex-shrink-0 flex-col">
                    <div className="flex items-center justify-center px-1.5 py-2">
                      <button
                        onClick={toggleSidebar}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        title="Expand outline"
                        aria-label="Expand outline"
                      >
                        <PanelLeftOpen className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="scrollbar-none flex-1 overflow-y-auto">
                      <OutlineCollapsed
                        headings={headings}
                        activeId={activeId}
                        onNavigate={navigateTo}
                        onExpand={toggleSidebar}
                      />
                    </div>
                  </div>
                ))}

              {/* Outline border when expanded */}
              {!isFocusMode && hasHeadings && isSidebarOpen && (
                <div className="h-full w-px flex-shrink-0" />
              )}

              {/* Editor content */}
              <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
                <ErrorBoundary>
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
                </ErrorBoundary>
              </div>
            </main>

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
