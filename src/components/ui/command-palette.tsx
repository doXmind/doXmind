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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useTheme } from "next-themes";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface CommandItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string[];
  category: "file" | "navigation" | "view" | "action";
  action: () => void;
  keywords?: string[];
}

const CATEGORY_LABELS: Record<string, string> = {
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

  const { files, createFile, setCurrentFile } = useFileStore();
  const {
    toggleSidebar,
    toggleChat,
    setKeyboardShortcutsOpen,
    isSidebarOpen,
    isChatOpen,
    isHighContrast,
    toggleHighContrast,
  } = useLayoutStore();
  const { theme, setTheme } = useTheme();

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
        action: () => {
          createFile("Untitled");
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
        onClose();
      },
      keywords: ["open", "go to", file.name.toLowerCase()],
    }));

    return [...baseCommands, ...fileCommands];
  }, [
    files,
    createFile,
    setCurrentFile,
    toggleSidebar,
    toggleChat,
    setKeyboardShortcutsOpen,
    isSidebarOpen,
    isChatOpen,
    isHighContrast,
    toggleHighContrast,
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

  // Group filtered commands by category
  const groupedCommands = React.useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};
    for (const cmd of filteredCommands) {
      if (!groups[cmd.category]) {
        groups[cmd.category] = [];
      }
      groups[cmd.category].push(cmd);
    }
    return groups;
  }, [filteredCommands]);

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

  // Focus input when opened
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
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
          "overflow-hidden"
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
              "flex-1 bg-transparent text-sm",
              "placeholder:text-muted-foreground",
              "focus:outline-none"
            )}
            aria-label="Search commands"
          />
          <kbd className="hidden h-5 items-center gap-1 rounded border border-border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
            ESC
          </kbd>
        </div>

        {/* Command list */}
        <div
          ref={listRef}
          className="max-h-[300px] overflow-y-auto py-2"
          role="listbox"
          aria-label="Commands"
        >
          {flattenedCommands.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No commands found.
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
                      <span className="flex-1 truncate text-left">{cmd.label}</span>
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
