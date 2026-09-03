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
import { useFileStore, type FileItem } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { usePageSessionStore } from "@/stores/page-session-store";
import { isMarkdownFile } from "@/lib/document-types";
import { MINDLINES_WIDTH } from "@/lib/constants";
import { MarkdownSkeleton } from "@/components/workspace/markdown-skeleton";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

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

  const outlineSession = usePageSessionStore((s) => s.outlineSession);
  const currentPageOutline =
    currentFile && isMarkdownFile(currentFile) && outlineSession?.pageId === currentFile.id
      ? outlineSession
      : null;
  const headings = currentPageOutline?.headings ?? [];
  const activeId = currentPageOutline?.activeId ?? null;
  const navigateTo = currentPageOutline?.navigateTo ?? (() => undefined);
  const hasLiveHeadings = !!currentFile && isMarkdownFile(currentFile) && headings.length > 0;
  // Live heading extraction arrives after the active editor runtime mounts.
  // Reserve the outline gutter from the cached read model too, otherwise the
  // page frame shifts when the live headings become available.
  const hasReservedOutline =
    hasLiveHeadings ||
    (!!currentFile && isMarkdownFile(currentFile) && (currentFile.outline?.length ?? 0) >= 2);

  // Do not animate grid-template-columns here. Editor reflow on every frame
  // makes sidebar toggles visibly lag in the macOS WebView.
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
    // Nothing repairs the width here. This effect re-runs on every width change, so a
    // "snap anything under 288px back to 304" rule reads as a broken drag: the pane
    // jumps back the moment the pointer crosses that line. The store's clamp is the
    // single place the bounds live.
  }, [hasOpenTarget, setFilesSidebarOpen]);

  return (
    <AppShell hideHeader>
      <div className="desktop-window-shell relative flex h-full flex-col" style={shellStyle}>
        {/* Header floats above the scroll surfaces, but paints an opaque
              backing so editor content never shows through it. Each scroll
              surface reserves the header's height at its top (h-11 spacers)
              so the first line clears the floating controls. */}
        {!isFocusMode && (
          <div className="absolute inset-x-0 top-0 z-30">
            <UnifiedHeader />
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <div
            className="desktop-content-canvas grid min-h-0 flex-1"
            style={{
              gridTemplateColumns: `${filesSidebarColPx}px ${filesHandleColPx}px minmax(0, 1fr)`,
              transition: filesGridTransition,
            }}
          >
            <aside data-native-editor-chrome className="min-w-0 overflow-hidden">
              {!isFocusMode && hasOpenTarget && isFilesSidebarOpen && (
                <div style={{ minWidth: filesSidebarWidth }} className="h-full">
                  <FilesSidebar />
                </div>
              )}
            </aside>
            {/* Two things this column must not do, or the sidebar cannot be dragged at all.
                It must not be `overflow-hidden` like the aside: the column is 0px wide, so
                clipping to it erases the handle's absolutely positioned ±4px hit strip. And
                it must stretch the handle vertically — ResizeHandle sets no height and its
                only children are absolute, so as a plain block child it collapses to 0px
                tall. `flex` makes it a stretched flex item, the same way the split-pane host
                already stretches its own divider. Measured both ways in a browser: with
                either one wrong the strip is 8x0 and elementFromPoint never returns it. */}
            <div data-native-editor-chrome className="flex min-w-0">
              {!isFocusMode && hasOpenTarget && isFilesSidebarOpen && (
                <ResizeHandle
                  side="left"
                  showSeparator={false}
                  // Sat on the sidebar's own right edge, 8px left of the seam anyone can see:
                  // `main` carries `margin-left: 8px`, so its border and rounded corner are the
                  // line the eye reads as the divider. Hovering therefore lit a second 2px bar
                  // beside the real one instead of lighting the real one. The handle is a `w-0`
                  // box whose children are absolute, so translating it moves the hit strip and
                  // the highlight onto that border without moving anything in flow.
                  className="translate-x-2"
                  onResize={(delta) => setFilesSidebarWidth(filesSidebarWidth + delta)}
                  onDoubleClick={() => resetPanelWidths()}
                />
              )}
            </div>

            <main
              id="main-content"
              className={cn(
                "desktop-content-surface relative min-h-0 min-w-0 overflow-hidden bg-background",
                !isFocusMode &&
                  hasOpenTarget &&
                  isFilesSidebarOpen &&
                  "desktop-content-with-sidebar"
              )}
            >
              {/* Outline rail — collapsed by default, expands into a floating
                outline popover on hover. Keep it close to the scroll edge so
                the popover reads as part of the document navigation chrome. */}
              {!isFocusMode && hasLiveHeadings && (
                <div
                  data-native-editor-chrome
                  // right-4 is the one chrome inset: the same 16px the word
                  // count and the header's more-actions button use. The rail
                  // used to sit at 8px and the more-actions button at 24px,
                  // so three things hanging off the same edge stopped at
                  // three different x values.
                  className="pointer-events-none absolute bottom-[14vh] right-4 top-[18vh] z-30 overflow-visible transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
                  style={{ width: outlineRailWidth }}
                >
                  {/* `relative` so the OutlineCollapsed root, which is
                      `absolute right-0`, anchors to this 40px-wide column's
                      right edge and grows leftward when expanded. Without
                      relative positioning here, the absolute child would
                      anchor to the outer fixed-width column above and the
                      math would still work — but explicit relative keeps
                      the contract local. */}
                  {/* Stays pointer-transparent: OutlineCollapsed opts its own
                      hit surfaces back in (the mark-sized hover sensor and the
                      popover), so the empty rail column no longer intercepts
                      clicks meant for the Blocks behind it. */}
                  <div className="relative h-full w-full">
                    <OutlineCollapsed
                      headings={headings}
                      activeId={activeId}
                      onNavigate={navigateTo}
                    />
                  </div>
                </div>
              )}

              <EditorPane
                file={currentFile ?? null}
                isLoaded={isCurrentFileLoaded}
                isSynced={isSynced}
                pendingFileId={currentFileId}
                openTarget={openTarget}
                reservedRightInset={outlineContentGutterPx}
              />
            </main>
          </div>
        </div>

        {isFocusMode && (
          <div
            data-native-editor-chrome
            className="fixed left-1/2 top-0 z-50 -translate-x-1/2 opacity-0 transition-opacity duration-300 hover:opacity-100"
          >
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

/** The editor column: the Page, its loading skeleton, or the empty-workspace surface. */
function EditorPane({
  file,
  isLoaded,
  isSynced,
  pendingFileId,
  openTarget,
  reservedRightInset,
}: {
  file: FileItem | null;
  isLoaded: boolean;
  isSynced: boolean;
  pendingFileId: string | null;
  openTarget: string;
  reservedRightInset: number;
}) {
  return (
    <div className="relative flex h-full min-w-0 flex-col overflow-hidden">
      <ErrorBoundary>
        {file ? (
          // Crossfade between the loading skeleton and the editor so a first open / file switch
          // fades instead of snapping. `mode="wait"` keeps a single element in flow (no layout
          // doubling); `initial={false}` skips animating the very first mount.
          <AnimatePresence mode="wait" initial={false}>
            {isLoaded ? (
              <motion.div
                key="document"
                className="h-full"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <DocumentWorkspace file={file} reservedRightInset={reservedRightInset} />
              </motion.div>
            ) : (
              <motion.div
                key="skeleton"
                className="h-full"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <MarkdownSkeleton file={{ name: file.name, outline: file.outline }} />
              </motion.div>
            )}
          </AnimatePresence>
        ) : !isSynced && pendingFileId ? (
          <MarkdownSkeleton />
        ) : openTarget === "folder" ? (
          <WorkspaceHome />
        ) : (
          <WelcomeScreen />
        )}
      </ErrorBoundary>
    </div>
  );
}
