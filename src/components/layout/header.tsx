"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import {
  PanelLeftClose,
  PanelLeft,
  MessageSquare,
  MessageSquareOff,
  Moon,
  Sun,
  Keyboard,
  Check,
  X,
  FileText,
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
  const { currentFileId, files, renameFile } = useFileStore();
  const { isDirty, isSaving } = useEditorStore();
  const { theme, setTheme } = useTheme();

  const currentFile = files.find((f) => f.id === currentFileId);

  // Editable filename state
  const [isEditing, setIsEditing] = useState(false);
  const [editingName, setEditingName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  const startEditing = () => {
    if (!currentFile) return;
    setEditingName(currentFile.name.replace(/\.md$/, ""));
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditingName("");
  };

  const confirmEditing = async () => {
    if (!currentFile || !editingName.trim()) {
      cancelEditing();
      return;
    }

    const newName = editingName.trim().endsWith(".md")
      ? editingName.trim()
      : `${editingName.trim()}.md`;

    if (newName !== currentFile.name) {
      try {
        await renameFile(currentFile.id, newName);
      } catch (error) {
        console.error("Failed to rename file:", error);
      }
    }

    setIsEditing(false);
    setEditingName("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      confirmEditing();
    } else if (e.key === "Escape") {
      cancelEditing();
    }
  };

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

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
          {isEditing ? (
            <>
              <div className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <input
                  ref={inputRef}
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-40 border-none bg-transparent text-sm font-medium outline-none focus:ring-0"
                  placeholder="Untitled"
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={confirmEditing}
                aria-label="Confirm rename"
              >
                <Check className="h-4 w-4 text-green-600 dark:text-green-500" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={cancelEditing}
                aria-label="Cancel rename"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </Button>
            </>
          ) : (
            <>
              <button
                onClick={startEditing}
                className="rounded px-1 text-sm font-medium transition-colors hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                disabled={!currentFile}
              >
                {currentFile?.name.replace(/\.md$/, "") || "Untitled"}
              </button>
              {isDirty && <span className="text-xs text-muted-foreground">(unsaved)</span>}
              {isSaving && <span className="text-xs text-muted-foreground">Saving...</span>}
            </>
          )}
        </div>
      </div>

      {/* Mobile Header - Center Section (Title) */}
      <div className="flex min-w-0 flex-1 items-center justify-center gap-1 px-2 md:hidden">
        {isEditing ? (
          <>
            <input
              ref={inputRef}
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onKeyDown={handleKeyDown}
              className="max-w-[120px] truncate rounded border border-border bg-background px-2 py-0.5 text-sm font-medium outline-none focus:ring-1 focus:ring-primary"
              placeholder="Untitled"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={confirmEditing}
              aria-label="Confirm rename"
            >
              <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-500" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={cancelEditing}
              aria-label="Cancel rename"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </>
        ) : (
          <>
            <button
              onClick={startEditing}
              className="max-w-[180px] truncate rounded px-1 text-sm font-medium transition-colors hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={!currentFile}
            >
              {currentFile?.name.replace(/\.md$/, "") || "Untitled"}
            </button>
            {isDirty && (
              <span className="ml-1 flex-shrink-0 text-xs text-muted-foreground">(unsaved)</span>
            )}
          </>
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
