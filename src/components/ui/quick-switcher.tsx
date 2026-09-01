"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { FileText, FilePlus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { MENU_PANEL_CLASS, MENU_ROW_CLASS } from "@/components/ui/dropdown-menu";
import { navigateToEditorFile } from "@/lib/editor-navigation";
import { createPageForContext } from "@/lib/new-page";
import {
  duplicateNames,
  quickSwitcherFolder,
  searchQuickSwitcherFiles,
} from "@/lib/quick-switcher-search";
import { notify } from "@/lib/notifications";
import { storeLogger } from "@/lib/logger";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";

const MAX_RESULTS = 20;

export function QuickSwitcher() {
  const isQuickSwitcherOpen = useLayoutStore((s) => s.isQuickSwitcherOpen);

  if (!isQuickSwitcherOpen) return null;

  return <QuickSwitcherContent />;
}

function QuickSwitcherContent() {
  const [query, setQuery] = React.useState("");
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const files = useFileStore((s) => s.files);
  const currentFileId = useFileStore((s) => s.currentFileId);
  const setQuickSwitcherOpen = useLayoutStore((s) => s.setQuickSwitcherOpen);
  const t = useTranslations("quickSwitcher");

  // Most-recently-used order is what the list falls back to before a query narrows it.
  const recentFiles = React.useMemo(() => {
    const ordered = files
      .filter((f) => !f.isFolder && !f.isAsset)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const current = ordered.find((f) => f.id === currentFileId);
    const others = ordered.filter((f) => f.id !== currentFileId);
    return current ? [current, ...others] : ordered;
  }, [files, currentFileId]);

  const results = React.useMemo(
    () => searchQuickSwitcherFiles(recentFiles, query).slice(0, MAX_RESULTS),
    [recentFiles, query]
  );

  const repeated = React.useMemo(() => duplicateNames(results), [results]);

  const trimmedQuery = query.trim();
  // Offer creation only when nothing matched: a query that found its Page should not push a
  // Create row in front of the answer the user was looking for.
  const canCreate = trimmedQuery.length > 0 && results.length === 0;
  const rowCount = results.length + (canCreate ? 1 : 0);

  // With no query the previous Page is preselected, so ⌘O ↵ is a back-and-forth between two
  // Pages. Once the user types, the best match leads.
  React.useEffect(() => {
    setSelectedIndex(trimmedQuery ? 0 : results.length > 1 ? 1 : 0);
    // `results.length` rather than `results`: a scan that returns the same list must not move
    // the caret out from under the user mid-keystroke.
  }, [trimmedQuery, results.length]);

  // No `mounted` gate: this component is `import()`ed from an effect and can only mount in a
  // browser. Gating the portal made this focus a race the user lost silently — the dialog opened
  // with the caret still in the Page, and their typing went into the Markdown.
  React.useEffect(() => {
    if (window.innerWidth >= 768) inputRef.current?.focus();
  }, []);

  const openFile = React.useCallback(
    (fileId: string) => {
      navigateToEditorFile(fileId);
      setQuickSwitcherOpen(false);
    },
    [setQuickSwitcherOpen]
  );

  const createAndOpen = React.useCallback(
    async (name: string) => {
      setQuickSwitcherOpen(false);
      try {
        const newId = await createPageForContext(useFileStore.getState(), name);
        navigateToEditorFile(newId);
      } catch (error) {
        storeLogger.error("Failed to create Page from the quick switcher", error);
        notify.error(t("createFailed"));
      }
    },
    [setQuickSwitcherOpen, t]
  );

  const commit = React.useCallback(
    (index: number) => {
      if (canCreate && index === results.length) {
        void createAndOpen(trimmedQuery);
        return;
      }
      const file = results[index];
      if (file) openFile(file.id);
    },
    [canCreate, results, trimmedQuery, createAndOpen, openFile]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setQuickSwitcherOpen(false);
      return;
    }
    if (event.key === "Tab" || event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((prev) => (rowCount ? (prev + 1) % rowCount : 0));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((prev) => (rowCount ? (prev - 1 + rowCount) % rowCount : 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commit(selectedIndex);
    }
  };

  React.useEffect(() => {
    listRef.current?.querySelector(`[data-index="${selectedIndex}"]`)?.scrollIntoView({
      block: "nearest",
    });
  }, [selectedIndex, rowCount]);

  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t("justNow");
    if (diffMins < 60) return t("minutesAgo", { count: diffMins });
    if (diffHours < 24) return t("hoursAgo", { count: diffHours });
    if (diffDays < 7) return t("daysAgo", { count: diffDays });
    return date.toLocaleDateString();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={() => setQuickSwitcherOpen(false)}
    >
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("quickFileSwitcher")}
        className={cn(
          // Same width and same surface as the command palette: two centred
          // keyboard-opened file lists reading as two different objects (448px
          // / 512px, 12px radius with a border) was the whole complaint.
          "relative z-50 w-full max-w-lg",
          MENU_PANEL_CLASS,
          "p-0",
          "animate-in fade-in-0 zoom-in-95 slide-in-from-top-2",
          "overflow-hidden",
          "mx-4 md:mx-0"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search row — px-3.5 lands the glyph on a row icon's 14px. */}
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div
          ref={listRef}
          className="max-h-[320px] overflow-y-auto p-1.5"
          role="listbox"
          aria-label={t("recentFilesLabel")}
        >
          {rowCount === 0 ? (
            <div className="px-2 py-8 text-center text-sm text-muted-foreground">
              {t("noRecentFiles")}
            </div>
          ) : (
            <>
              {results.map((file, index) => {
                const isSelected = index === selectedIndex;
                const folder = repeated.has(file.name.toLocaleLowerCase())
                  ? quickSwitcherFolder(file)
                  : "";
                return (
                  <button
                    key={file.id}
                    data-index={index}
                    role="option"
                    aria-selected={isSelected}
                    className={cn(
                      // One menu row — 28px on a 6px radius.
                      MENU_ROW_CLASS,
                      "gap-2",
                      isSelected
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground hover:bg-accent"
                    )}
                    onClick={() => openFile(file.id)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-left">{file.name}</span>
                    {/* Only when the name alone is ambiguous — an always-on path turns the list
                        into a wall of directories. */}
                    {folder && (
                      <span className="min-w-0 max-w-[45%] flex-shrink truncate text-xs text-muted-foreground">
                        {folder}
                      </span>
                    )}
                    {file.id === currentFileId && (
                      <span className="text-ui-xs flex-shrink-0 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                        {t("current")}
                      </span>
                    )}
                    <span className="flex-shrink-0 text-xs text-muted-foreground">
                      {formatRelativeTime(file.updatedAt)}
                    </span>
                  </button>
                );
              })}
              {canCreate && (
                <button
                  data-index={results.length}
                  role="option"
                  aria-selected={selectedIndex === results.length}
                  className={cn(
                    MENU_ROW_CLASS,
                    "gap-2",
                    selectedIndex === results.length
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground hover:bg-accent"
                  )}
                  onClick={() => void createAndOpen(trimmedQuery)}
                  onMouseEnter={() => setSelectedIndex(results.length)}
                >
                  <FilePlus className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {t("createNote", { name: trimmedQuery })}
                  </span>
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-3.5 py-2">
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
            <kbd className="text-ui-xs mr-1 inline-flex h-4 items-center rounded border border-border bg-muted px-1 font-medium">
              ↵
            </kbd>
            {t("open")}
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
