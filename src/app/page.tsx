"use client";

import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Sidebar } from "@/components/sidebar/sidebar";
import { Editor } from "@/components/editor/editor";
import { ChatPanel } from "@/components/ai/chat-panel";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { cn } from "@/lib/utils";
import { WelcomeScreen } from "@/components/welcome-screen";

export default function Home() {
  const { currentFileId, files, loadFiles } = useFileStore();
  const { isChatOpen, isSidebarOpen } = useLayoutStore();
  const currentFile = files.find((f) => f.id === currentFileId);

  // Load files from server on mount
  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

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
