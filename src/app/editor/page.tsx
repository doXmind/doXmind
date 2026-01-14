"use client";

import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Sidebar } from "@/components/sidebar/sidebar";
import { Editor } from "@/components/editor/editor";
import { ChatPanel } from "@/components/ai/chat-panel";
import { MobileNavBar } from "@/components/mobile/mobile-nav-bar";
import { MobileSidebar } from "@/components/mobile/mobile-sidebar";
import { MobileChatSheet } from "@/components/mobile/mobile-chat-sheet";
import { MobileOutlineSheet } from "@/components/mobile/mobile-outline-sheet";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useIsMobile } from "@/hooks/use-device-type";
import { cn } from "@/lib/utils";
import { WelcomeScreen } from "@/components/welcome-screen";
import { MOBILE_PANEL } from "@/lib/constants";

export default function EditorPage() {
  const { currentFileId, files, loadFiles } = useFileStore();
  const { isChatOpen, isSidebarOpen } = useLayoutStore();
  const currentFile = files.find((f) => f.id === currentFileId);
  const isMobile = useIsMobile();

  // Load files from server on mount
  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Mobile Layout: Editor always visible + overlay sheets/sidebar
  if (isMobile) {
    return (
      <AppShell>
        <div
          className="flex flex-col h-full"
          style={{ paddingBottom: MOBILE_PANEL.BOTTOM_NAV_HEIGHT }}
        >
          {/* Editor Content - Always Visible */}
          <main className="flex-1 overflow-hidden">
            {currentFile ? (
              <Editor file={currentFile} />
            ) : (
              <WelcomeScreen />
            )}
          </main>
        </div>

        {/* Mobile Bottom Navigation */}
        <MobileNavBar />

        {/* Mobile Sidebar Overlay (Files) */}
        <MobileSidebar />

        {/* Mobile Chat Bottom Sheet (AI) */}
        <MobileChatSheet />

        {/* Mobile Outline Sheet */}
        <MobileOutlineSheet />
      </AppShell>
    );
  }

  // Desktop Layout: Three-panel view
  return (
    <AppShell>
      <div className="flex h-full">
        {/* Sidebar */}
        <aside
          className={cn(
            "w-64 border-r border-border bg-card flex-shrink-0 transition-all duration-300",
            !isSidebarOpen && "w-0 opacity-0 overflow-hidden"
          )}
        >
          <Sidebar />
        </aside>

        {/* Main Editor Area */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {currentFile ? (
            <Editor file={currentFile} />
          ) : (
            <WelcomeScreen />
          )}
        </main>

        {/* AI Chat Panel */}
        <aside
          className={cn(
            "w-96 border-l border-border bg-card flex-shrink-0 transition-all duration-300",
            !isChatOpen && "w-0 opacity-0 overflow-hidden"
          )}
        >
          <ChatPanel />
        </aside>
      </div>
    </AppShell>
  );
}
