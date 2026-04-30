"use client";

import { type CSSProperties, useEffect, useState } from "react";
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

  // Sidebar collapse/expand used to animate `width` on a flex child, which
  // forces the flex container to re-distribute on every frame and reflows
  // the editor (TipTap is heavy). Animating `grid-template-columns` on a
  // grid container is the path WebKit/Blink optimize for column resizing —
  // the editor still reflows, but only as part of the column update, not
  // through a flex-distribution chain. Duration lowered from 300→180ms so
  // the unavoidable layout work has fewer frames to spread over.
  const easing = "cubic-bezier(0.25, 0.1, 0.25, 1)";
  const filesGridTransition = !isResizing ? `grid-template-columns 180ms ${easing}` : "none";
  const filesSidebarColPx = !isFocusMode && isFilesSidebarOpen ? filesSidebarWidth : 0;
  // Handle column stays 0 — ResizeHandle is `w-0` and uses absolutely
  // positioned children for both the hit area and the visible separator.
  // Giving the column any pixel width creates a transparent strip that
  // exposes the NSVisualEffectView vibrancy as a stray vertical band
  // between sidebar and editor.
  const filesHandleColPx = 0;
  const outlineColPx = !isFocusMode && hasHeadings ? (isSidebarOpen ? sidebarWidth : 44) : 0;
  // Shorter than the files sidebar transition — the outline lives inside
  // <main>, so its column animation reflows the editor on every frame.
  // 120ms keeps the unavoidable reflow window small enough to not register
  // as jank, while staying smooth enough to read as an animation.
  const outlineGridTransition = !isResizing ? `grid-template-columns 120ms ${easing}` : "none";

  const shellStyle = {
    "--files-sidebar-width": !isFocusMode && isFilesSidebarOpen ? `${filesSidebarWidth}px` : "0px",
  } as CSSProperties;

  useEffect(() => {
    setFilesSidebarOpen(true);
    if (filesSidebarWidth < 288) {
      setFilesSidebarWidth(304);
    }
  }, [filesSidebarWidth, setFilesSidebarOpen, setFilesSidebarWidth]);

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
              {!isFocusMode && (
                <div style={{ minWidth: filesSidebarWidth }} className="h-full">
                  <FilesSidebar />
                </div>
              )}
            </aside>
            <div className="min-w-0 overflow-hidden">
              {!isFocusMode && isFilesSidebarOpen && (
                <ResizeHandle
                  side="left"
                  onResize={(delta) => setFilesSidebarWidth(filesSidebarWidth + delta)}
                  onResizeStart={() => setIsResizing(true)}
                  onResizeEnd={() => setIsResizing(false)}
                  onDoubleClick={() => resetPanelWidths()}
                />
              )}
            </div>

            <main
              id="main-content"
              className="desktop-content-surface relative grid min-h-0 min-w-0 overflow-hidden bg-background"
              style={{
                gridTemplateColumns: `${outlineColPx}px minmax(0, 1fr)`,
                transition: outlineGridTransition,
              }}
            >
              <div className="relative min-w-0 overflow-hidden">
                {/* Both outline states stay mounted and switch via opacity —
                  swapping the DOM on every toggle remounts the whole
                  OutlineView tree (one component per heading, each with
                  its own useEffect + framer-motion chevron) which made
                  the open/close noticeably janky on top of the editor's
                  width reflow. Keeping them mounted reduces the toggle
                  cost to a paint-only opacity transition. */}
                {!isFocusMode && hasHeadings && (
                  <>
                    <div
                      className={cn(
                        "absolute inset-0 transition-opacity duration-150 ease-out",
                        isSidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
                      )}
                      aria-hidden={!isSidebarOpen}
                    >
                      <div style={{ minWidth: sidebarWidth }} className="h-full">
                        <Sidebar />
                      </div>
                    </div>
                    <div
                      className={cn(
                        "absolute inset-0 transition-opacity duration-150 ease-out",
                        !isSidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
                      )}
                      aria-hidden={isSidebarOpen}
                    >
                      <div className="flex h-full w-11 flex-col">
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
                    </div>
                  </>
                )}
              </div>

              <div className="relative flex min-w-0 flex-col overflow-hidden">
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
          </div>

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
