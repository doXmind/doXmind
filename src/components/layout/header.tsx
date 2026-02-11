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
  Download,
  Loader2,
  Clock,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useLayoutStore } from "@/stores/layout-store";
import { useFileStore } from "@/stores/file-store";
import { useEditorStore } from "@/stores/editor-store";
import { UserMenu } from "./user-menu";
import { formatShortcut } from "@/lib/utils";
import { api } from "@/lib/api";

export function Header() {
  const {
    isSidebarOpen,
    isChatOpen,
    isVersionHistoryOpen,
    toggleSidebar,
    toggleChat,
    toggleVersionHistory,
    setKeyboardShortcutsOpen,
  } = useLayoutStore();
  const { currentFileId, files, renameFile } = useFileStore();
  const { isDirty, isSaving, lastSavedAt } = useEditorStore();
  const { theme, setTheme } = useTheme();

  const currentFile = files.find((f) => f.id === currentFileId);

  // Editable filename state
  const [isEditing, setIsEditing] = useState(false);
  const [editingName, setEditingName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Show "Saved" briefly after saving
  const [showSaved, setShowSaved] = useState(false);
  const prevSavingRef = useRef(false);
  useEffect(() => {
    // When isSaving transitions from true to false, show "Saved" temporarily
    if (prevSavingRef.current && !isSaving && lastSavedAt) {
      setShowSaved(true);
      const timer = setTimeout(() => setShowSaved(false), 2000);
      return () => clearTimeout(timer);
    }
    prevSavingRef.current = isSaving;
  }, [isSaving, lastSavedAt]);

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
      } catch {
        toast.error("Failed to rename file");
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

  const handleExport = async (format: "markdown" | "pdf" | "docx") => {
    if (!currentFile) return;
    try {
      const blob = await api.exportFile(currentFile.id, format);
      const baseName = currentFile.name.replace(/\.md$/, "");
      const extension = format === "markdown" ? "md" : format;
      const filename = `${baseName}.${extension}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Track onboarding checklist
      import("@/stores/onboarding-store")
        .then(({ useOnboardingStore }) => {
          useOnboardingStore.getState().completeChecklistItem("triedExport");
        })
        .catch(() => {});
    } catch {
      toast.error(`Failed to export as ${format.toUpperCase()}`);
    }
  };

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Save status indicator
  const renderSaveStatus = () => {
    if (isSaving) {
      return (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving...
        </span>
      );
    }
    if (showSaved) {
      return (
        <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-500">
          <Check className="h-3 w-3" />
          Saved
        </span>
      );
    }
    if (isDirty) {
      return (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Unsaved
        </span>
      );
    }
    return null;
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
              {renderSaveStatus()}
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
        {/* Version History */}
        {currentFile && (
          <Tooltip content="Version History" side="bottom">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleVersionHistory}
              aria-label="Version History"
              className={isVersionHistoryOpen ? "bg-accent text-accent-foreground" : ""}
            >
              <Clock className="h-4 w-4" />
            </Button>
          </Tooltip>
        )}

        {/* Export Dropdown */}
        {currentFile && (
          <DropdownMenu>
            <Tooltip content="Export" side="bottom">
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Export document">
                  <Download className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport("markdown")}>
                Export as Markdown
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("pdf")}>Export as PDF</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("docx")}>
                Export as Word
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Tooltip content={`Keyboard Shortcuts (${formatShortcut("Ctrl+?")})`} side="bottom">
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
