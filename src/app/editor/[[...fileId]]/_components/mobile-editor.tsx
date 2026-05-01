"use client";

import { useCallback } from "react";
import dynamic from "next/dynamic";
import { AppShell } from "@/components/layout/app-shell";
import { DocumentWorkspace } from "@/components/workspace/document-workspace";
import { ErrorBoundary } from "@/components/error-boundary";
import { WelcomeScreen } from "@/components/welcome-screen";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useBlockSelection } from "@/hooks/use-block-selection";
import { useMobileGestures } from "@/hooks/use-mobile-gestures";

const MobileEditorLayout = dynamic(
  () =>
    import("@/components/mobile/mobile-editor-layout").then((m) => ({
      default: m.MobileEditorLayout,
    })),
  { ssr: false }
);

export function MobileEditor() {
  const currentFileId = useFileStore((s) => s.currentFileId);
  const files = useFileStore((s) => s.files);
  const isSynced = useFileStore((s) => s.isSynced);
  const loadedContentIds = useFileStore((s) => s.loadedContentIds);
  const setMobileSidebarOpen = useLayoutStore((s) => s.setMobileSidebarOpen);
  const setMobileOutlineOpen = useLayoutStore((s) => s.setMobileOutlineOpen);
  const editor = useEditorRefStore((s) => s.editor);
  const currentFile = files.find((f) => f.id === currentFileId);

  useBlockSelection({ editor, enabled: true });

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

  useMobileGestures({ onEdgeSwipe: handleEdgeSwipe, enabled: true });

  return (
    <AppShell hideHeader>
      <MobileEditorLayout>
        <div id="main-content">
          <ErrorBoundary>
            {currentFile ? (
              loadedContentIds.has(currentFile.id) ? (
                <DocumentWorkspace file={currentFile} />
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
      </MobileEditorLayout>
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
