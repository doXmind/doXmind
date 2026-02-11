"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  Search,
  FileText,
  FilePlus,
  Sun,
  Moon,
  Keyboard,
  PanelLeft,
  MessageSquare,
  ArrowRight,
  Contrast,
  HelpCircle,
  Loader2,
  AlertTriangle,
  Quote,
  RefreshCw,
  X,
  Columns,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { findTextInDoc } from "@/lib/position-mapper";
import { useTheme } from "next-themes";
import { api, SearchResultItem } from "@/lib/api";
import { useDebouncedCallback } from "@/hooks/use-debounced-callback";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface CommandItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string[];
  category: "file" | "navigation" | "view" | "action" | "searchFiles" | "searchDocument";
  action: () => void;
  keywords?: string[];
  preview?: string;
  score?: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  searchFiles: "Files",
  searchDocument: "In Document",
  file: "Files",
  navigation: "Navigation",
  view: "View",
  action: "Actions",
};

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [mounted, setMounted] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  // Search state
  const [fileSearchResults, setFileSearchResults] = React.useState<SearchResultItem[]>([]);
  const [docSearchResults, setDocSearchResults] = React.useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const abortControllerRef = React.useRef<AbortController | null>(null);

  const router = useRouter();
  const { files, createFile, setCurrentFile, currentFileId } = useFileStore();
  const {
    toggleSidebar,
    toggleChat,
    setKeyboardShortcutsOpen,
    isSidebarOpen,
    isChatOpen,
    isHighContrast,
    toggleHighContrast,
    editorWidth,
    cycleEditorWidth,
  } = useLayoutStore();
  const { theme, setTheme } = useTheme();
  const { editor } = useEditorRefStore();

  // Perform semantic search with debounce
  const performSearch = useDebouncedCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setFileSearchResults([]);
      setDocSearchResults([]);
      setSearchError(null);
      return;
    }

    // Cancel previous request
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsSearching(true);
    setSearchError(null);

    try {
      // Semantic search in all files and current document
      const [filesRes, docRes] = await Promise.all([
        api.searchFiles(searchQuery, undefined, 10, controller.signal).catch(() => null),
        currentFileId
          ? api
              .searchInDocument(searchQuery, currentFileId, 10, 0.4, controller.signal)
              .catch(() => null)
          : Promise.resolve(null),
      ]);

      if (filesRes) setFileSearchResults(filesRes.results);
      if (docRes) setDocSearchResults(docRes.results);
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
        label: "New Document",
        icon: <FilePlus className="h-4 w-4" />,
        shortcut: ["Ctrl", "N"],
        category: "file",
        action: async () => {
          const newId = await createFile("Untitled");
          router.push(`/editor/${newId}`);
          onClose();
        },
        keywords: ["create", "new", "document", "file"],
      },
      // View commands
      {
        id: "toggle-sidebar",
        label: isSidebarOpen ? "Hide Sidebar" : "Show Sidebar",
        icon: <PanelLeft className="h-4 w-4" />,
        category: "view",
        action: () => {
          toggleSidebar();
          onClose();
        },
        keywords: ["sidebar", "panel", "files", "toggle"],
      },
      {
        id: "toggle-chat",
        label: isChatOpen ? "Hide AI Chat" : "Show AI Chat",
        icon: <MessageSquare className="h-4 w-4" />,
        category: "view",
        action: () => {
          toggleChat();
          onClose();
        },
        keywords: ["chat", "ai", "assistant", "toggle"],
      },
      {
        id: "toggle-theme",
        label: theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode",
        icon: theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />,
        category: "view",
        action: () => {
          setTheme(theme === "dark" ? "light" : "dark");
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
      {
        id: "editor-width",
        label: `Editor Width: ${editorWidth.charAt(0).toUpperCase() + editorWidth.slice(1)}`,
        icon: <Columns className="h-4 w-4" />,
        category: "view",
        action: () => {
          cycleEditorWidth();
          onClose();
        },
        keywords: ["width", "narrow", "wide", "full", "page", "editor", "layout"],
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
      {
        id: "show-tour",
        label: "Show Welcome Tour",
        icon: <HelpCircle className="h-4 w-4" />,
        category: "action",
        action: () => {
          onClose();
          // Reset onboarding and reload
          localStorage.removeItem("doxmind-onboarding-completed");
          window.location.reload();
        },
        keywords: ["tour", "onboarding", "help", "guide", "tutorial"],
      },
    ];

    // Add file navigation commands
    const fileCommands: CommandItem[] = files.map((file) => ({
      id: `file-${file.id}`,
      label: file.name,
      icon: <FileText className="h-4 w-4" />,
      category: "navigation" as const,
      action: () => {
        setCurrentFile(file.id);
        router.push(`/editor/${file.id}`);
        onClose();
      },
      keywords: ["open", "go to", file.name.toLowerCase()],
    }));

    return [...baseCommands, ...fileCommands];
  }, [
    files,
    createFile,
    setCurrentFile,
    router,
    toggleSidebar,
    toggleChat,
    setKeyboardShortcutsOpen,
    isSidebarOpen,
    isChatOpen,
    isHighContrast,
    toggleHighContrast,
    editorWidth,
    cycleEditorWidth,
    theme,
    setTheme,
    onClose,
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
        const fileId = result.metadata.file_id;
        const start = result.metadata?.start as number | undefined;

        // Open the file first
        setCurrentFile(fileId);
        router.push(`/editor/${fileId}`);

        // If we have position info, navigate to it after file loads
        if (start !== undefined && editor) {
          // Use setTimeout to wait for file content to load into editor
          setTimeout(() => {
            const currentEditor = useEditorRefStore.getState().editor;
            if (currentEditor) {
              // Clamp position to document length
              const maxPos = currentEditor.state.doc.content.size;
              const safePos = Math.min(start, maxPos - 1);
              currentEditor.commands.setTextSelection(safePos);
              currentEditor.commands.scrollIntoView();
            }
          }, 100);
        }

        onClose();
      },
      keywords: [],
      preview: result.content.slice(0, 100),
      score: result.distance !== undefined ? Math.round((1 - result.distance) * 100) : undefined,
    }));
  }, [fileSearchResults, setCurrentFile, router, onClose, editor]);

  const searchDocCommands = React.useMemo<CommandItem[]>(() => {
    return docSearchResults.map((result, index) => ({
      id: `search-doc-${index}`,
      label: result.content.slice(0, 80) + (result.content.length > 80 ? "..." : ""),
      icon: <Quote className="h-4 w-4" />,
      category: "searchDocument" as const,
      action: () => {
        // Jump to position in document using metadata positions (more accurate)
        if (editor) {
          const start = result.metadata?.start as number | undefined;
          const end = result.metadata?.end as number | undefined;

          if (start !== undefined) {
            // Use positions from backend (already calculated during indexing)
            const maxPos = editor.state.doc.content.size;
            const safeStart = Math.min(start, maxPos - 1);
            const safeEnd = end !== undefined ? Math.min(end, maxPos) : safeStart;
            editor.commands.setTextSelection({ from: safeStart, to: safeEnd });
            editor.commands.scrollIntoView();
          } else if (result.content) {
            // Fallback: search for content if no position metadata
            const position = findTextInDoc(editor.state.doc, result.content);
            if (position) {
              editor.commands.setTextSelection({ from: position.from, to: position.to });
              editor.commands.scrollIntoView();
            }
          }
        }
        onClose();
      },
      keywords: [],
      score: result.distance !== undefined ? Math.round((1 - result.distance) * 100) : undefined,
    }));
  }, [docSearchResults, onClose, editor]);

  // Group filtered commands by category
  const groupedCommands = React.useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};

    // Add search results first (only when query exists)
    if (query.trim()) {
      if (searchFileCommands.length > 0) {
        groups["searchFiles"] = searchFileCommands;
      }
      if (searchDocCommands.length > 0) {
        groups["searchDocument"] = searchDocCommands;
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
  }, [filteredCommands, searchFileCommands, searchDocCommands, query]);

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
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setFileSearchResults([]);
      setDocSearchResults([]);
      setSearchError(null);
      // Only auto-focus on desktop to avoid keyboard popup on mobile
      if (window.innerWidth >= 768) {
        requestAnimationFrame(() => {
          inputRef.current?.focus();
        });
      }
    }
  }, [open]);

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

  // Detect macOS for shortcut display
  const [isMac, setIsMac] = React.useState(false);
  React.useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().indexOf("MAC") >= 0);
  }, []);

  const formatKey = (key: string) => {
    if (isMac && key === "Ctrl") return "⌘";
    if (isMac && key === "Alt") return "⌥";
    if (isMac && key === "Shift") return "⇧";
    return key;
  };

  if (!open || !mounted) return null;

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
          "rounded-xl border border-border bg-popover shadow-2xl",
          "animate-in fade-in-0 zoom-in-95 slide-in-from-top-2",
          "overflow-hidden",
          // Mobile: add horizontal margin
          "mx-4 md:mx-0"
        )}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
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
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search status */}
        {isSearching && (
          <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Searching...
          </div>
        )}

        {searchError && (
          <div className="flex items-center gap-2 border-b border-border bg-yellow-50 px-4 py-2 text-xs text-yellow-600 dark:bg-yellow-900/20">
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
          className="max-h-[300px] overflow-y-auto py-2"
          role="listbox"
          aria-label="Commands"
        >
          {flattenedCommands.length === 0 && !isSearching ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {query.trim() ? "No results found." : "Type to search files and commands..."}
            </div>
          ) : (
            Object.entries(groupedCommands).map(([category, items]) => (
              <div key={category} className="mb-2 last:mb-0">
                <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground">
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
                        "flex w-full items-center gap-3 px-4 py-2 text-sm",
                        "transition-colors duration-75",
                        isSelected
                          ? "bg-accent text-accent-foreground"
                          : "text-foreground hover:bg-accent/50"
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
                        <span className="flex flex-shrink-0 items-center gap-1">
                          {cmd.shortcut.map((key, i) => (
                            <React.Fragment key={i}>
                              <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border bg-muted px-1 text-[10px] font-medium text-muted-foreground">
                                {formatKey(key)}
                              </kbd>
                              {i < cmd.shortcut!.length - 1 && (
                                <span className="text-[10px] text-muted-foreground">+</span>
                              )}
                            </React.Fragment>
                          ))}
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
        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2">
          <span className="text-xs text-muted-foreground">
            <kbd className="mr-1 inline-flex h-4 items-center rounded border border-border bg-muted px-1 text-[10px] font-medium">
              ↑↓
            </kbd>
            to navigate
          </span>
          <span className="text-xs text-muted-foreground">
            <kbd className="mr-1 inline-flex h-4 items-center rounded border border-border bg-muted px-1 text-[10px] font-medium">
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
