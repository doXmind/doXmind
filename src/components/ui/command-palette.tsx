"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  Search,
  FileText,
  FilePlus,
  Palette,
  Keyboard,
  ArrowRight,
  Contrast,
  Loader2,
  AlertTriangle,
  RefreshCw,
  X,
  CalendarDays,
} from "lucide-react";
import { cn, formatShortcut } from "@/lib/utils";
import { MENU_PANEL_CLASS, MENU_ROW_CLASS } from "@/components/ui/dropdown-menu";
import { navigateToEditorFile } from "@/lib/editor-navigation";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";

import { useThemeManager } from "@/hooks/use-theme-manager";
import { createStorageAdapter, searchMarkdown, type MarkdownSearchResult } from "@/lib/storage";
import { useDebouncedCallback } from "@/hooks/use-debounced-callback";
import { createPageForContext } from "@/lib/new-page";
import { openTodayDailyNote } from "@/lib/daily-notes";
import { notify } from "@/lib/notifications";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface CommandItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string[];
  category: "file" | "navigation" | "view" | "action" | "searchFiles";
  action: () => void;
  keywords?: string[];
  preview?: string;
  score?: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  searchFiles: "Files",
  file: "Files",
  navigation: "Navigation",
  view: "View",
  action: "Actions",
};
const MIN_CONTENT_SEARCH_CHARS = 2;

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  if (!open) return null;

  return <CommandPaletteContent onClose={onClose} />;
}

function CommandPaletteContent({ onClose }: { onClose: () => void }) {
  const [mounted, setMounted] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  // Search state
  const [fileSearchResults, setFileSearchResults] = React.useState<MarkdownSearchResult[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const abortControllerRef = React.useRef<AbortController | null>(null);

  const files = useFileStore((s) => s.files);
  const rootPath = useFileStore((s) => s.rootPath);
  const setKeyboardShortcutsOpen = useLayoutStore((s) => s.setKeyboardShortcutsOpen);
  const isHighContrast = useLayoutStore((s) => s.isHighContrast);
  const toggleHighContrast = useLayoutStore((s) => s.toggleHighContrast);
  const { currentTheme, toggleBaseMode } = useThemeManager();

  // Perform search with debounce
  const performSearch = useDebouncedCallback(async (searchQuery: string) => {
    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery.length < MIN_CONTENT_SEARCH_CHARS || !rootPath) {
      abortControllerRef.current?.abort();
      setFileSearchResults([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    // Cancel previous request
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsSearching(true);
    setSearchError(null);

    try {
      const adapter = createStorageAdapter({ disk: { root: rootPath } });
      const filesRes = await searchMarkdown(adapter, trimmedQuery, {
        limit: 10,
        signal: controller.signal,
      }).catch(() => null);

      if (!controller.signal.aborted && filesRes) setFileSearchResults(filesRes.results);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setSearchError("Search failed. Click to retry.");
    } finally {
      setIsSearching(false);
    }
  }, 300);

  // Trigger search when query changes
  React.useEffect(() => {
    performSearch(query);
  }, [query, performSearch]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Build commands list
  const commands = React.useMemo<CommandItem[]>(() => {
    const baseCommands: CommandItem[] = [
      // File commands
      {
        id: "new-file",
        label: "New Page",
        icon: <FilePlus className="h-4 w-4" />,
        shortcut: ["Ctrl", "N"],
        category: "file",
        action: async () => {
          const newId = await createPageForContext(useFileStore.getState());
          navigateToEditorFile(newId);
          onClose();
        },
        keywords: ["create", "new", "document", "file"],
      },
      ...(rootPath
        ? [
            {
              id: "daily-note",
              label: "Open today's Daily Note",
              icon: <CalendarDays className="h-4 w-4" />,
              category: "file" as const,
              action: async () => {
                try {
                  await openTodayDailyNote();
                  onClose();
                } catch (error) {
                  notify.error("Could not open today's Daily Note", {
                    description: error instanceof Error ? error.message : String(error),
                  });
                }
              },
              keywords: ["daily", "today", "journal", "日记", "今日日志"],
            },
          ]
        : []),
      {
        id: "toggle-theme",
        label: currentTheme.baseMode === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode",
        icon: <Palette className="h-4 w-4" />,
        category: "view",
        action: () => {
          toggleBaseMode();
          onClose();
        },
        keywords: ["theme", "dark", "light", "mode", "appearance"],
      },
      {
        id: "toggle-high-contrast",
        label: isHighContrast ? "Disable High Contrast" : "Enable High Contrast",
        icon: <Contrast className="h-4 w-4" />,
        category: "view",
        action: () => {
          toggleHighContrast();
          onClose();
        },
        keywords: ["contrast", "accessibility", "a11y", "vision"],
      },
      // Action commands
      {
        id: "keyboard-shortcuts",
        label: "Keyboard Shortcuts",
        icon: <Keyboard className="h-4 w-4" />,
        shortcut: ["Ctrl", "?"],
        category: "action",
        action: () => {
          onClose();
          setTimeout(() => setKeyboardShortcutsOpen(true), 100);
        },
        keywords: ["keyboard", "shortcuts", "help", "hotkeys"],
      },
    ];

    // Add file navigation commands
    const fileCommands: CommandItem[] = files.map((file) => ({
      id: `file-${file.id}`,
      label: file.name,
      icon: <FileText className="h-4 w-4" />,
      category: "navigation" as const,
      action: () => {
        navigateToEditorFile(file.id);
        onClose();
      },
      keywords: ["open", "go to", file.name.toLowerCase()],
    }));

    return [...baseCommands, ...fileCommands];
  }, [
    files,
    setKeyboardShortcutsOpen,
    isHighContrast,
    toggleHighContrast,
    currentTheme,
    toggleBaseMode,
    onClose,
    rootPath,
  ]);

  // Filter commands based on query
  const filteredCommands = React.useMemo(() => {
    if (!query.trim()) return commands;

    const lowerQuery = query.toLowerCase();
    return commands.filter((cmd) => {
      const matchLabel = cmd.label.toLowerCase().includes(lowerQuery);
      const matchKeywords = cmd.keywords?.some((kw) => kw.toLowerCase().includes(lowerQuery));
      return matchLabel || matchKeywords;
    });
  }, [commands, query]);

  // Convert search results to command items
  const searchFileCommands = React.useMemo<CommandItem[]>(() => {
    return fileSearchResults.map((result, index) => ({
      id: `search-file-${index}`,
      label: result.metadata?.name || "Unknown file",
      icon: <FileText className="h-4 w-4" />,
      category: "searchFiles" as const,
      action: () => {
        const fileId = result.metadata.fileId;
        navigateToEditorFile(fileId);
        onClose();
      },
      keywords: [],
      preview: result.content.slice(0, 100),
      score: result.score !== undefined ? Math.round(result.score * 100) : undefined,
    }));
  }, [fileSearchResults, onClose]);

  // Group filtered commands by category
  const groupedCommands = React.useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};

    // Add search results first (only when query exists)
    if (query.trim()) {
      if (searchFileCommands.length > 0) {
        groups["searchFiles"] = searchFileCommands;
      }
    }

    // Then add filtered commands
    for (const cmd of filteredCommands) {
      if (!groups[cmd.category]) {
        groups[cmd.category] = [];
      }
      groups[cmd.category].push(cmd);
    }

    return groups;
  }, [filteredCommands, searchFileCommands, query]);

  // Flatten for keyboard navigation
  const flattenedCommands = React.useMemo(() => {
    return Object.values(groupedCommands).flat();
  }, [groupedCommands]);

  // Reset selection when query changes
  React.useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Mount state
  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Focus input when opened, clear search state
  React.useEffect(() => {
    setQuery("");
    setSelectedIndex(0);
    setFileSearchResults([]);
    setSearchError(null);
    // Only auto-focus on desktop to avoid keyboard popup on mobile
    if (window.innerWidth >= 768) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, []);

  // Scroll selected item into view
  React.useEffect(() => {
    if (listRef.current && flattenedCommands.length > 0) {
      const selectedItem = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      selectedItem?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, flattenedCommands.length]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => (prev < flattenedCommands.length - 1 ? prev + 1 : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : flattenedCommands.length - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (flattenedCommands[selectedIndex]) {
          flattenedCommands[selectedIndex].action();
        }
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  };

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!mounted) return null;

  let globalIndex = 0;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={handleBackdropClick}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" aria-hidden="true" />

      {/* Command palette */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className={cn(
          "relative z-50 w-full max-w-lg",
          // Same surface as every other menu in the app: 10px radius, no
          // border, the hairline-ring shadow. This panel used to be a 12px
          // radius with a 1px border and shadow-2xl, which read as a different
          // kind of object from the menu it is a sibling of.
          MENU_PANEL_CLASS,
          // The menus' 6px lives on this dialog's list instead — the header and
          // footer are full-bleed rows with their own divider.
          "p-0",
          "animate-in fade-in-0 zoom-in-95 slide-in-from-top-2",
          "overflow-hidden",
          // Mobile: add horizontal margin
          "mx-4 md:mx-0"
        )}
        onKeyDown={handleKeyDown}
      >
        {/* Search input. px-3.5 puts the glyph on the same 14px as a row's
            icon (the list's own 6px padding plus the row's 8px). */}
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-3">
          <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search..."
            className={cn(
              "flex-1 bg-transparent text-base md:text-sm",
              "placeholder:text-muted-foreground",
              "focus:outline-none"
            )}
            aria-label="Search commands"
          />
          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[20ms] ease-in hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search status */}
        {isSearching && (
          <div className="flex items-center gap-2 border-b border-border px-3.5 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Searching...
          </div>
        )}

        {searchError && (
          <div className="flex items-center gap-2 border-b border-border bg-yellow-50 px-3.5 py-2 text-xs text-yellow-600 dark:bg-yellow-900/20">
            <AlertTriangle className="h-3 w-3" />
            <span className="flex-1">{searchError}</span>
            <button
              onClick={() => performSearch(query)}
              className="flex items-center gap-1 hover:underline"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          </div>
        )}

        {/* Command list */}
        <div
          ref={listRef}
          className="max-h-[300px] overflow-y-auto p-1.5"
          role="listbox"
          aria-label="Commands"
        >
          {flattenedCommands.length === 0 && !isSearching ? (
            <div className="px-2 py-8 text-center text-sm text-muted-foreground">
              {query.trim() ? "No results found." : "Type to search files and commands..."}
            </div>
          ) : (
            Object.entries(groupedCommands).map(([category, items]) => (
              <div key={category} className="mb-2 last:mb-0">
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                  {CATEGORY_LABELS[category] || category}
                </div>
                {items.map((cmd) => {
                  const currentIndex = globalIndex++;
                  const isSelected = currentIndex === selectedIndex;
                  return (
                    <button
                      key={cmd.id}
                      data-index={currentIndex}
                      role="option"
                      aria-selected={isSelected}
                      className={cn(
                        // One menu row: 28px tall on a 6px radius with the
                        // 20ms background. It used to be a full-bleed 33.4px
                        // square-cornered row, and 36px on the two rows that
                        // carried a bordered ⌘ chip.
                        MENU_ROW_CLASS,
                        "gap-2",
                        // `--sidebar-active` is #ffffff — an elevated pill against the sidebar's
                        // tinted ground, but invisible on this panel, which is bg-popover (also
                        // #ffffff). The keyboard-selected row painted nothing. Use the same
                        // `accent` fill every other menu row in the app uses.
                        isSelected
                          ? "bg-accent text-accent-foreground"
                          : "text-foreground hover:bg-accent"
                      )}
                      onClick={() => cmd.action()}
                      onMouseEnter={() => setSelectedIndex(currentIndex)}
                    >
                      <span className="flex-shrink-0 text-muted-foreground">{cmd.icon}</span>
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-left">{cmd.label}</span>
                        {cmd.preview && (
                          <span className="block truncate text-left text-xs text-muted-foreground">
                            {cmd.preview}
                          </span>
                        )}
                      </div>
                      {cmd.score !== undefined && (
                        <span className="flex-shrink-0 text-xs text-muted-foreground">
                          {cmd.score}%
                        </span>
                      )}
                      {cmd.shortcut && (
                        // The same right-aligned plain hint the more-actions
                        // menu uses. Bordered 20px chips were the only reason
                        // two rows in this list measured 36px instead of 28.
                        <span className="flex-shrink-0 text-xs text-muted-foreground">
                          {formatShortcut(cmd.shortcut.join("+"))}
                        </span>
                      )}
                      {isSelected && (
                        <ArrowRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-3.5 py-2">
          <span className="text-xs text-muted-foreground">
            <kbd className="text-ui-xs mr-1 inline-flex h-4 items-center rounded border border-border bg-muted px-1 font-medium">
              ↑↓
            </kbd>
            to navigate
          </span>
          <span className="text-xs text-muted-foreground">
            <kbd className="text-ui-xs mr-1 inline-flex h-4 items-center rounded border border-border bg-muted px-1 font-medium">
              ↵
            </kbd>
            to select
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
