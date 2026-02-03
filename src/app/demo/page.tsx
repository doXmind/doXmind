"use client";

import { useEffect, Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Editor } from "@/components/editor/editor";
import { DemoChatPanel } from "@/components/demo/demo-chat-panel";
import { DEMO_DOCUMENT_CONTENT } from "@/components/demo/demo-scenarios";
import { LoadingScreen } from "@/components/loading-screen";
import { KeyboardShortcutsModal } from "@/components/ui/keyboard-shortcuts-modal";
import { CommandPalette } from "@/components/ui/command-palette";
import { MobileEditorLayout } from "@/components/mobile/mobile-editor-layout";
import { MobileDemoChatPanel } from "@/components/demo/mobile-demo-chat-panel";
import { useDemoStore } from "@/stores/demo-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useIsMobile } from "@/hooks/use-device-type";
import { useHighContrast } from "@/hooks/use-high-contrast";
import { useEditorKeyboardShortcuts } from "@/hooks/use-editor-keyboard-shortcuts";
import { useBlockSelection } from "@/hooks/use-block-selection";
import { cn } from "@/lib/utils";

function DemoPageContent() {
  const { demoFile, initDemo, isDemoMode } = useDemoStore();
  const {
    isChatOpen,
    isKeyboardShortcutsOpen,
    setKeyboardShortcutsOpen,
    isCommandPaletteOpen,
    setCommandPaletteOpen,
  } = useLayoutStore();
  const { editor } = useEditorRefStore();
  const isMobile = useIsMobile();

  // Global keyboard shortcuts
  useEditorKeyboardShortcuts();

  // Mobile block selection
  useBlockSelection({
    editor,
    enabled: isMobile,
  });

  // Apply high contrast mode from persisted settings
  useHighContrast();

  // Initialize demo on mount with preset content
  useEffect(() => {
    if (!isDemoMode) {
      initDemo(DEMO_DOCUMENT_CONTENT);
    }
  }, [isDemoMode, initDemo]);

  // Update browser tab title
  useEffect(() => {
    document.title = "Demo - doXmind Editor";
  }, []);

  // Show loading while initializing
  if (!demoFile) {
    return (
      <LoadingScreen isLoading={true} isMobile={isMobile}>
        {null}
      </LoadingScreen>
    );
  }

  // Mobile Layout
  if (isMobile) {
    return (
      <AppShell hideHeader>
        <MobileEditorLayout>
          <div id="main-content">
            <Editor file={demoFile} isDemoMode={true} />
          </div>
        </MobileEditorLayout>

        {/* Mobile AI Chat - Bottom sheet style */}
        <MobileDemoChatPanel />

        <KeyboardShortcutsModal
          open={isKeyboardShortcutsOpen}
          onClose={() => setKeyboardShortcutsOpen(false)}
        />
        <CommandPalette open={isCommandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
      </AppShell>
    );
  }

  // Desktop Layout
  return (
    <AppShell hideHeader>
      <div className="flex h-full">
        {/* Main Editor Area */}
        <main id="main-content" className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Editor file={demoFile} isDemoMode={true} />
        </main>

        {/* AI Chat Panel - Mock version for demo */}
        <aside
          className={cn(
            "w-96 flex-shrink-0 border-l border-border bg-card transition-all duration-300",
            !isChatOpen && "w-0 overflow-hidden opacity-0"
          )}
        >
          <DemoChatPanel />
        </aside>
      </div>

      <KeyboardShortcutsModal
        open={isKeyboardShortcutsOpen}
        onClose={() => setKeyboardShortcutsOpen(false)}
      />
      <CommandPalette open={isCommandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
    </AppShell>
  );
}

export default function DemoPage() {
  return (
    <Suspense
      fallback={
        <LoadingScreen isLoading={true} isMobile={false}>
          {null}
        </LoadingScreen>
      }
    >
      <DemoPageContent />
    </Suspense>
  );
}
