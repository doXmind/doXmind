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
  ListTree,
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
  const {
    isSidebarOpen,
    isChatOpen,
    toggleSidebar,
    toggleChat,
    setKeyboardShortcutsOpen,
    setMobileOutlineOpen,
  } = useLayoutStore();
  const { currentFileId, files } = useFileStore();
  const { isDirty, isSaving } = useEditorStore();
  const { theme, setTheme } = useTheme();

  const currentFile = files.find((f) => f.id === currentFileId);

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <header className="h-12 border-b border-border flex items-center justify-between px-3 md:px-4 bg-card">
      {/* Mobile Header - Left Section (Logo) */}
      <div className="flex md:hidden items-center">
        <Link href="/" className="flex items-center">
          <Logo variant="icon" size="sm" />
        </Link>
      </div>

      {/* Desktop Header - Left Section */}
      <div className="hidden md:flex items-center gap-2">
        <Tooltip content="Home" side="bottom">
          <Link href="/" className="flex items-center">
            <Logo variant="icon" size="sm" />
          </Link>
        </Tooltip>

        <div className="w-px h-5 bg-border mx-1" />

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

        <div className="flex items-center gap-2 ml-2">
          <span className="font-medium text-sm">
            {currentFile?.name || "Untitled"}
          </span>
          {isDirty && (
            <span className="text-xs text-muted-foreground">(unsaved)</span>
          )}
          {isSaving && (
            <span className="text-xs text-muted-foreground">Saving...</span>
          )}
        </div>
      </div>

      {/* Mobile Header - Center Section (Title) */}
      <div className="flex-1 md:hidden flex items-center justify-center min-w-0 px-2">
        <span className="font-medium text-sm truncate max-w-[180px]">
          {currentFile?.name || "Untitled"}
        </span>
        {isDirty && (
          <span className="text-xs text-muted-foreground ml-1 flex-shrink-0">(unsaved)</span>
        )}
      </div>

      {/* Mobile Header - Right Section (Outline button) */}
      <div className="flex md:hidden items-center">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileOutlineOpen(true)}
          aria-label="Document Outline"
          className="h-9 w-9"
        >
          <ListTree className="h-5 w-5" />
        </Button>
      </div>

      {/* Desktop Header - Right Section */}
      <div className="hidden md:flex items-center gap-2">
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
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label="Toggle Theme"
          >
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

        <div className="w-px h-5 bg-border mx-1" />

        <UserMenu />
      </div>
    </header>
  );
}
