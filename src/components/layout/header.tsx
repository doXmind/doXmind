"use client";

import Link from "next/link";
import {
  PanelLeftClose,
  PanelLeft,
  MessageSquare,
  MessageSquareOff,
  Moon,
  Sun,
  Keyboard,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { Tooltip } from "@/components/ui/tooltip";
import { useLayoutStore } from "@/stores/layout-store";
import { useFileStore } from "@/stores/file-store";
import { useEditorStore } from "@/stores/editor-store";
import { UserMenu } from "./user-menu";

export function Header() {
  const { isSidebarOpen, isChatOpen, toggleSidebar, toggleChat, setKeyboardShortcutsOpen } =
    useLayoutStore();
  const { currentFileId, files } = useFileStore();
  const { isDirty, isSaving } = useEditorStore();
  const { theme, setTheme } = useTheme();

  const currentFile = files.find((f) => f.id === currentFileId);

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <header className="flex h-12 items-center justify-between border-b border-border bg-card px-3 md:px-4">
      {/* Mobile Header - Left Section (Logo) */}
      <div className="flex items-center md:hidden">
        <Link href="/" className="flex items-center">
          <Logo variant="icon" size="sm" />
        </Link>
      </div>

      {/* Desktop Header - Left Section */}
      <div className="hidden items-center gap-2 md:flex">
        <Tooltip content="Home" side="bottom">
          <Link href="/" className="flex items-center">
            <Logo variant="icon" size="sm" />
          </Link>
        </Tooltip>

        <div className="mx-1 h-5 w-px bg-border" />

        <Tooltip content={isSidebarOpen ? "Hide Sidebar" : "Show Sidebar"} side="bottom">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            aria-label={isSidebarOpen ? "Hide Sidebar" : "Show Sidebar"}
          >
            {isSidebarOpen ? (
              <PanelLeftClose className="h-4 w-4" />
            ) : (
              <PanelLeft className="h-4 w-4" />
            )}
          </Button>
        </Tooltip>

        <div className="ml-2 flex items-center gap-2">
          <span className="text-sm font-medium">
            {currentFile?.name.replace(/\.md$/, "") || "Untitled"}
          </span>
          {isDirty && <span className="text-xs text-muted-foreground">(unsaved)</span>}
          {isSaving && <span className="text-xs text-muted-foreground">Saving...</span>}
        </div>
      </div>

      {/* Mobile Header - Center Section (Title) */}
      <div className="flex min-w-0 flex-1 items-center justify-center px-2 md:hidden">
        <span className="max-w-[180px] truncate text-sm font-medium">
          {currentFile?.name.replace(/\.md$/, "") || "Untitled"}
        </span>
        {isDirty && (
          <span className="ml-1 flex-shrink-0 text-xs text-muted-foreground">(unsaved)</span>
        )}
      </div>

      {/* Mobile Header - Right Section (empty, outline is now floating) */}
      <div className="flex items-center md:hidden" />

      {/* Desktop Header - Right Section */}
      <div className="hidden items-center gap-2 md:flex">
        <Tooltip content="Keyboard Shortcuts (Ctrl+?)" side="bottom">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setKeyboardShortcutsOpen(true)}
            aria-label="Keyboard Shortcuts"
          >
            <Keyboard className="h-4 w-4" />
          </Button>
        </Tooltip>

        <Tooltip content="Toggle Theme" side="bottom">
          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle Theme">
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          </Button>
        </Tooltip>

        <Tooltip content={isChatOpen ? "Hide AI Chat" : "Show AI Chat"} side="bottom">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleChat}
            aria-label={isChatOpen ? "Hide AI Chat" : "Show AI Chat"}
          >
            {isChatOpen ? (
              <MessageSquareOff className="h-4 w-4" />
            ) : (
              <MessageSquare className="h-4 w-4" />
            )}
          </Button>
        </Tooltip>

        <div className="mx-1 h-5 w-px bg-border" />

        <UserMenu />
      </div>
    </header>
  );
}
