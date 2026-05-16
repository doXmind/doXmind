"use client";

import { type CSSProperties, useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
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
import { isMarkdownFile } from "@/lib/document-types";
import { MINDLINES_WIDTH } from "@/lib/constants";
import { MarkdownSkeleton } from "@/components/workspace/markdown-skeleton";

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

  const isFilesSidebarOpen = useLayoutStore((s) => s.isFilesSidebarOpen);
  const setFilesSidebarOpen = useLayoutStore((s) => s.setFilesSidebarOpen);
  const isFocusMode = useLayoutStore((s) => s.isFocusMode);
  const setFocusMode = useLayoutStore((s) => s.setFocusMode);
  const filesSidebarWidth = useLayoutStore((s) => s.filesSidebarWidth);
  const setFilesSidebarWidth = useLayoutStore((s) => s.setFilesSidebarWidth);
  const resetPanelWidths = useLayoutStore((s) => s.resetPanelWidths);

  const editor = useEditorRefStore((s) => s.editor);
  const { headings, activeId, navigateTo } = useHeadings(editor);
  const hasLiveHeadings = !!currentFile && isMarkdownFile(currentFile) && headings.length > 0;
  // BrowsingRuntime renders its own collapsed outline rail in read mode using
  // the file's cached outline, so the content gutter must be reserved when
  // *either* surface will render a rail. Without this fallback the editor's
  // `--editor-outline-gutter` jumps from 0 (read) to 128 (edit) when the live
  // TipTap editor mounts, visibly shifting the page-frame on every toggle.
  const hasReservedOutline =
    hasLiveHeadings ||
    (!!currentFile && isMarkdownFile(currentFile) && (currentFile.outline?.length ?? 0) >= 2);

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
  // Outline lives in the collapsed rail and expands on hover.
  const outlineRailWidth = MINDLINES_WIDTH.COLLAPSED;
  const outlineContentGutterPx =
    !isFocusMode && hasReservedOutline ? MINDLINES_WIDTH.CONTENT_GUTTER : 0;

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
              {/* Outline rail — collapsed by default, expands into a floating
                outline popover on hover. Keep it close to the scroll edge so
                the popover reads as part of the document navigation chrome. */}
              {!isFocusMode && hasLiveHeadings && (
                <div
                  className="pointer-events-none absolute bottom-[14vh] right-2 top-[18vh] z-30 overflow-visible transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] md:right-2"
                  style={{ width: outlineRailWidth }}
                >
                  {/* `relative` so the OutlineCollapsed root, which is
                      `absolute right-0`, anchors to this 40px-wide column's
                      right edge and grows leftward when expanded. Without
                      relative positioning here, the absolute child would
                      anchor to the outer fixed-width column above and the
                      math would still work — but explicit relative keeps
                      the contract local. */}
                  <div className="pointer-events-auto relative h-full w-full">
                    <OutlineCollapsed
                      headings={headings}
                      activeId={activeId}
                      onNavigate={navigateTo}
                    />
                  </div>
                </div>
              )}

              <div className="relative flex h-full min-w-0 flex-col overflow-hidden">
                <ErrorBoundary>
                  {currentFile ? (
                    isCurrentFileLoaded ? (
                      <DocumentWorkspace
                        file={currentFile}
                        reservedRightInset={outlineContentGutterPx}
                      />
                    ) : (
                      <MarkdownSkeleton
                        file={{ name: currentFile.name, outline: currentFile.outline }}
                      />
                    )
                  ) : !isSynced && currentFileId ? (
                    <MarkdownSkeleton />
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

