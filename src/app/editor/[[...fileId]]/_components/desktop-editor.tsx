"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { PanelLeftOpen } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Sidebar } from "@/components/sidebar/sidebar";
import { FilesSidebar } from "@/components/sidebar/files-sidebar";
import { Editor } from "@/components/editor/editor";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { ErrorBoundary } from "@/components/error-boundary";
import { WelcomeScreen } from "@/components/welcome-screen";
import { UnifiedHeader } from "@/components/editor/unified-header";
import { OutlineCollapsed } from "@/components/editor/mindlines/outline-collapsed";
import { useHeadings } from "@/components/editor/mindlines/use-headings";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { cn } from "@/lib/utils";

const VersionHistoryPanel = dynamic(
  () =>
    import("@/components/editor/version-history-panel").then((m) => ({
      default: m.VersionHistoryPanel,
    })),
  { ssr: false }
);

export function DesktopEditor() {
  const currentFileId = useFileStore((s) => s.currentFileId);
  const files = useFileStore((s) => s.files);
  const isSynced = useFileStore((s) => s.isSynced);
  const loadedContentIds = useFileStore((s) => s.loadedContentIds);

  const isSidebarOpen = useLayoutStore((s) => s.isSidebarOpen);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const isFilesSidebarOpen = useLayoutStore((s) => s.isFilesSidebarOpen);
  const setFilesSidebarOpen = useLayoutStore((s) => s.setFilesSidebarOpen);
  const isFocusMode = useLayoutStore((s) => s.isFocusMode);
  const setFocusMode = useLayoutStore((s) => s.setFocusMode);
  const isVersionHistoryOpen = useLayoutStore((s) => s.isVersionHistoryOpen);
  const setVersionHistoryOpen = useLayoutStore((s) => s.setVersionHistoryOpen);
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth);
  const filesSidebarWidth = useLayoutStore((s) => s.filesSidebarWidth);
  const setFilesSidebarWidth = useLayoutStore((s) => s.setFilesSidebarWidth);
  const resetPanelWidths = useLayoutStore((s) => s.resetPanelWidths);

  const editor = useEditorRefStore((s) => s.editor);
  const { headings, activeId, navigateTo } = useHeadings(editor);
  const hasHeadings = headings.length > 0;
  const currentFile = files.find((f) => f.id === currentFileId);
  const [isResizing, setIsResizing] = useState(false);

  const transitionClass = "transition-[width] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]";

  useEffect(() => {
    setFilesSidebarOpen(true);
    if (filesSidebarWidth < 288) {
      setFilesSidebarWidth(304);
    }
  }, [filesSidebarWidth, setFilesSidebarOpen, setFilesSidebarWidth]);

  return (
    <AppShell hideHeader>
      <div className="flex h-full flex-col">
        {!isFocusMode && <UnifiedHeader />}

        <div className="flex min-h-0 flex-1">
          {!isFocusMode && (
            <>
              <aside
                style={{ width: isFilesSidebarOpen ? filesSidebarWidth : 0 }}
                className={cn(
                  "bg-sidebar flex-shrink-0 overflow-hidden",
                  !isResizing && transitionClass
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

          <main
            id="main-content"
            className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
          >
            {!isFocusMode &&
              hasHeadings &&
              (isSidebarOpen ? (
                <div
                  style={{ width: sidebarWidth }}
                  className={cn("flex-shrink-0 overflow-hidden", !isResizing && transitionClass)}
                >
                  <div style={{ minWidth: sidebarWidth }} className="h-full">
                    <Sidebar />
                  </div>
                </div>
              ) : (
                <div className="flex h-full w-11 flex-shrink-0 flex-col border-r border-border/30 bg-background/60">
                  <div className="flex items-center justify-center px-1.5 py-2">
                    <button
                      onClick={toggleSidebar}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
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

            {!isFocusMode && hasHeadings && isSidebarOpen && (
              <div className="h-full w-px flex-shrink-0" />
            )}

            <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
              <ErrorBoundary>
                {currentFile ? (
                  loadedContentIds.has(currentFile.id) ? (
                    <Editor file={currentFile} />
                  ) : (
                    <LoadingPlaceholder />
                  )
                ) : !isSynced && currentFileId ? (
                  <LoadingPlaceholder />
                ) : (
                  <WelcomeScreen />
                )}
              </ErrorBoundary>
            </div>
          </main>

          {!isFocusMode && currentFile && isVersionHistoryOpen && (
            <VersionHistoryPanel
              fileId={currentFile.id}
              isOpen={isVersionHistoryOpen}
              onClose={() => setVersionHistoryOpen(false)}
            />
          )}
        </div>

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
      </div>
    </AppShell>
  );
}

function LoadingPlaceholder() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}
