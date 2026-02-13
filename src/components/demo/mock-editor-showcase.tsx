import { MockSidebar } from "./mock-sidebar";
import { MockEditorArea } from "./mock-editor-area";
import { MockChatPanel } from "./mock-chat-panel";
import { MockStatusBar } from "./mock-status-bar";

export function MockEditorShowcase() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
      {/* Title bar */}
      <div className="flex items-center gap-2 border-b border-border bg-muted px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <div className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <div className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <span className="ml-3 text-xs text-muted-foreground">Demo Document — doXmind</span>
      </div>

      {/* Three-panel layout */}
      <div className="flex h-[900px]">
        <MockSidebar />
        <MockEditorArea />
        <MockChatPanel />
      </div>

      {/* Status bar */}
      <MockStatusBar />
    </div>
  );
}
