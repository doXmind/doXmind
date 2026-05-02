"use client";

import { type CSSProperties, useEffect } from "react";
import { PanelRightOpen } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Sidebar } from "@/components/sidebar/sidebar";
import { FilesSidebar } from "@/components/sidebar/files-sidebar";
import { DocumentWorkspace } from "@/components/workspace/document-workspace";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { ErrorBoundary } from "@/components/error-boundary";
import { WelcomeScreen } from "@/components/welcome-screen";
import { WorkspaceHome } from "@/components/workspace/workspace-home";
import { UnifiedHeader } from "@/components/editor/unified-header";
import { OutlineCollapsed } from "@/components/editor/mindlines/outline-collapsed";
import { useHeadings } from "@/components/editor/mindlines/use-headings";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { cn } from "@/lib/utils";
import { isMarkdownFile } from "@/lib/document-types";
import { MINDLINES_WIDTH } from "@/lib/constants";

export function DesktopEditor() {
  const currentFileId = useFileStore((s) => s.currentFileId);
  const currentFile = useFileStore((s) =>
    s.currentFileId ? s.files.find((file) => file.id === s.currentFileId) : undefined
  );
  const isSynced = useFileStore((s) => s.isSynced);
  const isCurrentFileLoaded = useFileStore((s) =>
    s.currentFileId ? s.loadedContentIds.has(s.currentFileId) : false
  );
  const openTarget = useFileStore((s) => s.openTarget);
  // VSCode-style: the sidebar appears whenever a file or folder is open.
  // The welcome surface can remain mounted beside it, so opening a folder
  // expands the file tree instead of replacing the main content with a blank
  // editor state.
  const hasOpenTarget = openTarget !== "none";

  const isSidebarOpen = useLayoutStore((s) => s.isSidebarOpen);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const isFilesSidebarOpen = useLayoutStore((s) => s.isFilesSidebarOpen);
  const setFilesSidebarOpen = useLayoutStore((s) => s.setFilesSidebarOpen);
  const isFocusMode = useLayoutStore((s) => s.isFocusMode);
  const setFocusMode = useLayoutStore((s) => s.setFocusMode);
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth);
  const filesSidebarWidth = useLayoutStore((s) => s.filesSidebarWidth);
  const setFilesSidebarWidth = useLayoutStore((s) => s.setFilesSidebarWidth);
  const resetPanelWidths = useLayoutStore((s) => s.resetPanelWidths);

  const editor = useEditorRefStore((s) => s.editor);
  const { headings, activeId, navigateTo } = useHeadings(editor);
  const hasHeadings = !!currentFile && isMarkdownFile(currentFile) && headings.length > 0;

  // Do not animate grid-template-columns here. Even optimized grid column
  // animation forces the heavy TipTap editor to reflow on every frame in the
  // macOS WebView. The instant column snap is less decorative, but keeps
  // sidebar toggles responsive.
  const filesGridTransition = "none";
  const filesSidebarColPx =
    !isFocusMode && hasOpenTarget && isFilesSidebarOpen ? filesSidebarWidth : 0;
  // Handle column stays 0 — ResizeHandle is `w-0` and uses absolutely
  // positioned children for both the hit area and the visible separator.
  // Giving the column any pixel width creates a transparent strip that
  // exposes the NSVisualEffectView vibrancy as a stray vertical band
  // between sidebar and editor.
  const filesHandleColPx = 0;
  // The overlay reserves only the rail's footprint when collapsed; expanding
  // the panel floats it over the doc rather than reflowing the layout, so
  // the writing position never shifts when toggling the outline.
  const outlineRailWidth = MINDLINES_WIDTH.COLLAPSED;
  const outlineOverlayWidth =
    !isFocusMode && hasHeadings ? (isSidebarOpen ? sidebarWidth : outlineRailWidth) : 0;

  const shellStyle = {
    "--files-sidebar-width":
      !isFocusMode && hasOpenTarget && isFilesSidebarOpen ? `${filesSidebarWidth}px` : "0px",
  } as CSSProperties;

  useEffect(() => {
    // Auto-open the sidebar whenever a file or folder is opened, and
    // collapse it on the welcome screen. Without the false branch the
    // sidebar would linger from the previous session into the welcome.
    if (hasOpenTarget) {
      setFilesSidebarOpen(true);
    } else {
      setFilesSidebarOpen(false);
    }
    if (filesSidebarWidth < 288) {
      setFilesSidebarWidth(304);
    }
  }, [filesSidebarWidth, hasOpenTarget, setFilesSidebarOpen, setFilesSidebarWidth]);

  return (
    <AppShell hideHeader>
      <div className="desktop-window-shell flex h-full flex-col" style={shellStyle}>
        {!isFocusMode && <UnifiedHeader />}

        <div className="flex min-h-0 flex-1">
          <div
            className="grid min-h-0 flex-1"
            style={{
              gridTemplateColumns: `${filesSidebarColPx}px ${filesHandleColPx}px minmax(0, 1fr)`,
              transition: filesGridTransition,
            }}
          >
            <aside className="min-w-0 overflow-hidden">
              {!isFocusMode && hasOpenTarget && (
                <div style={{ minWidth: filesSidebarWidth }} className="h-full">
                  <FilesSidebar />
                </div>
              )}
            </aside>
            <div className="min-w-0 overflow-hidden">
              {!isFocusMode && hasOpenTarget && isFilesSidebarOpen && (
                <ResizeHandle
                  side="left"
                  onResize={(delta) => setFilesSidebarWidth(filesSidebarWidth + delta)}
                  onDoubleClick={() => resetPanelWidths()}
                />
              )}
            </div>

            <main
              id="main-content"
              className="desktop-content-surface relative min-h-0 min-w-0 overflow-hidden bg-background"
            >
              {/* The outline is an overlay, not a layout column. Expanding it
                must never resize the document surface or shift the writing
                position; it only changes the navigation layer above the page.
                Lives on the RIGHT edge of the editor — balances the file
                tree on the left and gives the writing surface a centered feel. */}
              {!isFocusMode && hasHeadings && (
                <div
                  className="pointer-events-none absolute inset-y-0 right-0 z-30 overflow-visible transition-[width] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
                  style={{ width: outlineOverlayWidth }}
                >
                  {/* Both outline states stay mounted and switch via opacity.
                    This keeps scroll-spy state stable and avoids remounting
                    the full outline tree during quick open/close cycles. */}
                  <div
                    className={cn(
                      "bg-background/96 pointer-events-auto absolute inset-0 border-l border-border/55 shadow-[-18px_0_32px_-30px_rgba(0,0,0,0.5)] backdrop-blur-md transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
                      isSidebarOpen
                        ? "translate-x-0 opacity-100"
                        : "pointer-events-none translate-x-2 opacity-0"
                    )}
                    aria-hidden={!isSidebarOpen}
                  >
                    <div style={{ width: sidebarWidth }} className="ml-auto h-full">
                      <Sidebar />
                    </div>
                  </div>
                  <div
                    onClick={toggleSidebar}
                    className={cn(
                      "outline-rail-trigger pointer-events-auto absolute inset-y-0 right-0 z-10 flex h-full cursor-pointer flex-col items-center bg-transparent transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
                      "border-l border-border/35 bg-background/70 backdrop-blur-sm hover:bg-background/85",
                      !isSidebarOpen
                        ? "translate-x-0 opacity-100"
                        : "pointer-events-none translate-x-1 opacity-0"
                    )}
                    style={{ width: outlineRailWidth }}
                    aria-hidden={isSidebarOpen}
                    role="button"
                    aria-label="Show outline"
                    tabIndex={isSidebarOpen ? -1 : 0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleSidebar();
                      }
                    }}
                    title="Show outline"
                  >
                    <span className="flex w-full items-center justify-center py-2 text-muted-foreground/55">
                      <PanelRightOpen className="h-3.5 w-3.5" />
                    </span>
                    <div className="scrollbar-none w-full flex-1 overflow-y-auto">
                      <OutlineCollapsed
                        headings={headings}
                        activeId={activeId}
                        onNavigate={navigateTo}
                        onExpand={toggleSidebar}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="relative flex h-full min-w-0 flex-col overflow-hidden">
                <ErrorBoundary>
                  {currentFile ? (
                    isCurrentFileLoaded ? (
                      <DocumentWorkspace file={currentFile} />
                    ) : (
                      <LoadingPlaceholder />
                    )
                  ) : !isSynced && currentFileId ? (
                    <LoadingPlaceholder />
                  ) : openTarget === "folder" ? (
                    <WorkspaceHome />
                  ) : (
                    <WelcomeScreen />
                  )}
                </ErrorBoundary>
              </div>
            </main>
          </div>
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
