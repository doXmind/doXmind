"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { FileText, Clock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";

const MAX_RECENT_FILES = 10;

export function QuickSwitcher() {
  const [mounted, setMounted] = React.useState(false);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);

  const router = useRouter();
  const { files, currentFileId, setCurrentFile } = useFileStore();
  const { isQuickSwitcherOpen, setQuickSwitcherOpen } = useLayoutStore();
  const t = useTranslations("quickSwitcher");

  // Get recent files sorted by updatedAt, excluding folders
  const recentFiles = React.useMemo(() => {
    return files
      .filter((f) => !f.isFolder)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, MAX_RECENT_FILES);
  }, [files]);

  // Put current file at top, then the rest
  const orderedFiles = React.useMemo(() => {
    const current = recentFiles.find((f) => f.id === currentFileId);
    const others = recentFiles.filter((f) => f.id !== currentFileId);
    return current ? [current, ...others] : recentFiles;
  }, [recentFiles, currentFileId]);

  // Start with second item selected (skip current file)
  React.useEffect(() => {
    if (isQuickSwitcherOpen) {
      setSelectedIndex(orderedFiles.length > 1 ? 1 : 0);
    }
  }, [isQuickSwitcherOpen, orderedFiles.length]);

  // Mount state
  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Navigate to selected file
  const navigateToFile = React.useCallback(
    (fileId: string) => {
      setCurrentFile(fileId);
      router.push(`/editor/${fileId}`);
      setQuickSwitcherOpen(false);
    },
    [setCurrentFile, router, setQuickSwitcherOpen]
  );

  // Handle keyboard events
  React.useEffect(() => {
    if (!isQuickSwitcherOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setQuickSwitcherOpen(false);
        return;
      }

      // Tab or ArrowDown to go next
      if (e.key === "Tab" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < orderedFiles.length - 1 ? prev + 1 : 0));
        return;
      }

      // ArrowUp to go prev
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : orderedFiles.length - 1));
        return;
      }

      // Enter to confirm
      if (e.key === "Enter") {
        e.preventDefault();
        if (orderedFiles[selectedIndex]) {
          navigateToFile(orderedFiles[selectedIndex].id);
        }
        return;
      }
    };

    // When Ctrl/Meta is released, confirm selection
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") {
        if (orderedFiles[selectedIndex]) {
          navigateToFile(orderedFiles[selectedIndex].id);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [isQuickSwitcherOpen, orderedFiles, selectedIndex, navigateToFile, setQuickSwitcherOpen]);

  // Scroll selected into view
  React.useEffect(() => {
    if (listRef.current && orderedFiles.length > 0) {
      const selectedItem = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      selectedItem?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, orderedFiles.length]);

  // Format relative time
  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t("justNow");
    if (diffMins < 60) return t("minutesAgo", { count: diffMins });
    if (diffHours < 24) return t("hoursAgo", { count: diffHours });
    if (diffDays < 7) return t("daysAgo", { count: diffDays });
    return date.toLocaleDateString();
  };

  if (!isQuickSwitcherOpen || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={() => setQuickSwitcherOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" aria-hidden="true" />

      {/* Switcher panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("quickFileSwitcher")}
        className={cn(
          "relative z-50 w-full max-w-md",
          "rounded-xl border border-border bg-popover shadow-2xl",
          "animate-in fade-in-0 zoom-in-95 slide-in-from-top-2",
          "overflow-hidden",
          "mx-4 md:mx-0"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t("recentFiles")}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {t("filesCount", { count: orderedFiles.length })}
          </span>
        </div>

        {/* File list */}
        <div
          ref={listRef}
          className="max-h-[320px] overflow-y-auto py-1"
          role="listbox"
          aria-label={t("recentFilesLabel")}
        >
          {orderedFiles.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t("noRecentFiles")}
            </div>
          ) : (
            orderedFiles.map((file, index) => {
              const isSelected = index === selectedIndex;
              const isCurrent = file.id === currentFileId;
              return (
                <button
                  key={file.id}
                  data-index={index}
                  role="option"
                  aria-selected={isSelected}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-2.5 text-sm",
                    "transition-colors duration-75",
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground hover:bg-accent/50"
                  )}
                  onClick={() => navigateToFile(file.id)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-left">{file.name}</span>
                  {isCurrent && (
                    <span className="text-ui-xs flex-shrink-0 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                      {t("current")}
                    </span>
                  )}
                  <span className="flex-shrink-0 text-xs text-muted-foreground">
                    {formatRelativeTime(file.updatedAt)}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2">
          <span className="text-xs text-muted-foreground">
            <kbd className="text-ui-xs mr-1 inline-flex h-4 items-center rounded border border-border bg-muted px-1 font-medium">
              Tab
            </kbd>
            or
            <kbd className="text-ui-xs mx-1 inline-flex h-4 items-center rounded border border-border bg-muted px-1 font-medium">
              ↑↓
            </kbd>
            {t("navigate")}
          </span>
          <span className="text-xs text-muted-foreground">
            Release
            <kbd className="text-ui-xs mx-1 inline-flex h-4 items-center rounded border border-border bg-muted px-1 font-medium">
              Ctrl
            </kbd>
            to open
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
