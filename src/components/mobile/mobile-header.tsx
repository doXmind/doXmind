"use client";

/**
 * Mobile Header Component
 *
 * Minimal header with file access and menu.
 * Replaces the bottom navigation bar for the new mobile design.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { FolderOpen, MoreHorizontal, Moon, Sun, ListTree } from "lucide-react";
import { useThemeManager } from "@/hooks/use-theme-manager";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
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
  const t = useTranslations("mobile");
  const { currentTheme, toggleBaseMode } = useThemeManager();
  const { toggleMobileOutline, setSearchBarOpen } = useLayoutStore();

  if (!isOpen) return null;

  const handleThemeToggle = () => {
    haptics.light();
    toggleBaseMode();
    onClose();
  };

  const handleOutlineToggle = () => {
    haptics.light();
    toggleMobileOutline();
    onClose();
  };

  const handleFindReplace = () => {
    haptics.light();
    setSearchBarOpen(true);
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
          {currentTheme.baseMode === "dark" ? (
            <Sun className="h-5 w-5" />
          ) : (
            <Moon className="h-5 w-5" />
          )}
          <span className="text-sm font-medium">
            {currentTheme.baseMode === "dark" ? t("lightMode") : t("darkMode")}
          </span>
        </button>

        <div className="h-px bg-border" />

        <button
          type="button"
          onClick={handleOutlineToggle}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
        >
          <ListTree className="h-5 w-5" />
          <span className="text-sm font-medium">{t("documentOutline")}</span>
        </button>

        <div className="h-px bg-border" />

        <button
          type="button"
          onClick={handleFindReplace}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
        >
          <svg
            className="h-5 w-5"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <span className="text-sm font-medium">{t("findReplace")}</span>
        </button>
      </div>
    </>
  );
}

export function MobileHeader() {
  const t = useTranslations("mobile");
  const router = useRouter();
  const { setMobileSidebarOpen } = useLayoutStore();
  const { currentFileId } = useFileStore();
  const { getFile } = useFileStore();
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);

  // Get current file name
  const currentFile = currentFileId ? getFile(currentFileId) : null;
  const fileName = currentFile?.name || "Untitled";

  const handleBackClick = () => {
    haptics.light();
    setIsMoreMenuOpen(false);
    router.push("/");
  };

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
      <header className={cn("w-full md:hidden", "border-b border-border bg-background", "px-2")}>
        <div className="flex h-12 items-center justify-between">
          {/* Left: Home logo + divider + Files */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={handleBackClick}
              className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-accent active:scale-95"
              aria-label={t("backToHome")}
            >
              <Logo variant="icon" size="sm" animated={false} />
            </button>
            <div className="mx-0.5 h-5 w-px bg-border" />
            <Button
              variant="ghost"
              size="icon"
              onClick={handleFilesClick}
              className="h-10 w-10 rounded-full"
              aria-label={t("openFiles")}
            >
              <FolderOpen className="h-5 w-5" />
            </Button>
          </div>

          {/* Document title */}
          <div className="flex-1 px-2 text-center">
            <h1 className="truncate text-sm font-semibold">{fileName}</h1>
          </div>

          {/* Right: More menu (with spacer to balance left side) */}
          <div className="flex items-center">
            <div className="w-10" /> {/* Spacer to balance the two left buttons */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleMoreClick}
              className={cn("h-10 w-10 rounded-full", isMoreMenuOpen && "bg-accent")}
              aria-label={t("moreOptions")}
            >
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>
    </>
  );
}
