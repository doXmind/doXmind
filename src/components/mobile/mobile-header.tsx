"use client";

/**
 * Mobile Header Component
 *
 * Minimal header with file access and menu.
 * Replaces the bottom navigation bar for the new mobile design.
 */

import { useState } from "react";
import { FolderOpen, MoreHorizontal, Moon, Sun, ListTree } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { useLayoutStore } from "@/stores/layout-store";
import { useFileStore } from "@/stores/file-store";
import { haptics } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { Z_INDEX } from "@/lib/constants";

interface MoreMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

function MoreMenu({ isOpen, onClose }: MoreMenuProps) {
  const { theme, setTheme } = useTheme();
  const { toggleMobileOutline } = useLayoutStore();

  if (!isOpen) return null;

  const handleThemeToggle = () => {
    haptics.light();
    setTheme(theme === "dark" ? "light" : "dark");
    onClose();
  };

  const handleOutlineToggle = () => {
    haptics.light();
    toggleMobileOutline();
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 dark:bg-black/40"
        style={{ zIndex: Z_INDEX.MOBILE_OVERLAY }}
        onClick={onClose}
      />

      {/* Menu */}
      <div
        className={cn(
          "fixed right-4 top-14 min-w-[180px] overflow-hidden",
          "rounded-xl border border-border bg-card shadow-lg"
        )}
        style={{ zIndex: Z_INDEX.MOBILE_PANEL }}
      >
        <button
          type="button"
          onClick={handleThemeToggle}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
        >
          {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          <span className="text-sm font-medium">
            {theme === "dark" ? "Light Mode" : "Dark Mode"}
          </span>
        </button>

        <div className="h-px bg-border" />

        <button
          type="button"
          onClick={handleOutlineToggle}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
        >
          <ListTree className="h-5 w-5" />
          <span className="text-sm font-medium">Document Outline</span>
        </button>
      </div>
    </>
  );
}

export function MobileHeader() {
  const { setMobileSidebarOpen } = useLayoutStore();
  const { currentFileId } = useFileStore();
  const { getFile } = useFileStore();
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);

  // Get current file name
  const currentFile = currentFileId ? getFile(currentFileId) : null;
  const fileName = currentFile?.name || "Untitled";

  const handleFilesClick = () => {
    haptics.light();
    setIsMoreMenuOpen(false);
    setMobileSidebarOpen(true);
  };

  const handleMoreClick = () => {
    haptics.light();
    setIsMoreMenuOpen(!isMoreMenuOpen);
  };

  return (
    <>
      {/* More Menu */}
      <MoreMenu isOpen={isMoreMenuOpen} onClose={() => setIsMoreMenuOpen(false)} />

      {/* Header Bar */}
      <header
        className={cn(
          "w-full md:hidden",
          "bg-background border-b border-border",
          "px-2"
        )}
      >
        <div className="flex h-12 items-center justify-between">
          {/* Files button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleFilesClick}
            className="h-10 w-10 rounded-full"
            aria-label="Open files"
          >
            <FolderOpen className="h-5 w-5" />
          </Button>

          {/* Document title */}
          <div className="flex-1 px-2 text-center">
            <h1 className="truncate text-sm font-semibold">{fileName}</h1>
          </div>

          {/* More menu button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleMoreClick}
            className={cn("h-10 w-10 rounded-full", isMoreMenuOpen && "bg-accent")}
            aria-label="More options"
          >
            <MoreHorizontal className="h-5 w-5" />
          </Button>
        </div>
      </header>
    </>
  );
}
