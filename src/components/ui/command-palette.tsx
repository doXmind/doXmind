"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { WORKSPACE_COMMANDS, formatBinding } from "@/lib/commands";
import { bindingFor, useHotkeysStore } from "@/stores/hotkeys-store";
import { createPortal } from "react-dom";
import { ArrowRight, FilePlus, FileText, Keyboard, Palette, Search, X } from "lucide-react";
import { cn, formatShortcut } from "@/lib/utils";
import { MENU_PANEL_CLASS, MENU_ROW_CLASS } from "@/components/ui/dropdown-menu";
import { navigateToEditorFile } from "@/lib/editor-navigation";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { searchQuickSwitcherFiles } from "@/lib/quick-switcher-search";

import { useThemeManager } from "@/hooks/use-theme-manager";

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
  const t = useTranslations("commandPalette");
  const tCommands = useTranslations("commands");
  const openSidebarSearch = useLayoutStore((state) => state.openSidebarSearch);
  const overrides = useHotkeysStore((state) => state.overrides);
  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
  const [query, setQuery] = React.useState("");
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const files = useFileStore((s) => s.files);
  const { currentTheme, toggleBaseMode } = useThemeManager();

  // Build commands list
  const commands = React.useMemo<CommandItem[]>(() => {
    // Every registered command, not a hand-kept subset: the palette used to offer five of the
    // roughly forty actions the app could perform, and nothing said which five or why.
    const baseCommands: CommandItem[] = WORKSPACE_COMMANDS.map((command) => {
      const binding = bindingFor(command, overrides);
      return {
        id: command.id,
        label: tCommands(command.labelKey),
        icon: <CommandIcon category={command.category} />,
        shortcut: binding ? [formatBinding(binding, isMac)] : undefined,
        category: command.category === "editor" ? "action" : command.category,
        action: () => {
          void command.run();
          onClose();
        },
        keywords: command.keywords,
      };
    });

    // The theme toggle stays here rather than in the registry: `toggleBaseMode` comes from
    // `useThemeManager`, a hook, and the registry is a plain module of store-reachable actions.
    baseCommands.push({
      id: "toggle-theme",
      label: currentTheme.baseMode === "dark" ? t("switchToLight") : t("switchToDark"),
      icon: <Palette className="h-4 w-4" />,
      category: "view",
      action: () => {
        toggleBaseMode();
        onClose();
      },
      keywords: ["theme", "dark", "light", "mode", "appearance"],
    });

    // Add file navigation commands
    const fileCommands: CommandItem[] = files
      .filter((file) => !file.isAsset)
      .map((file) => ({
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
  }, [t, tCommands, overrides, isMac, files, onClose, currentTheme.baseMode, toggleBaseMode]);

  // Filter commands based on query
  const filteredCommands = React.useMemo(() => {
    if (!query.trim()) return commands;

    const lowerQuery = query.toLowerCase();
    // Files are ranked, not filtered. A plain `includes` puts "Meeting notes 2024" and "Notes" in
    // declaration order for `notes`, and cannot find `Road map` from `rdmp` at all; the quick
    // switcher already had the scorer for this, so the two file lists in the app now agree on what
    // a good match is.
    const rankedFileIds = new Map(
      searchQuickSwitcherFiles(files, query).map((file, index) => [`file-${file.id}`, index])
    );
    return commands
      .filter((cmd) => {
        if (cmd.category === "navigation" && cmd.id.startsWith("file-")) {
          return rankedFileIds.has(cmd.id);
        }
        const matchLabel = cmd.label.toLowerCase().includes(lowerQuery);
        const matchKeywords = cmd.keywords?.some((kw) => kw.toLowerCase().includes(lowerQuery));
        return matchLabel || matchKeywords;
      })
      .sort((a, b) => {
        const rankA = rankedFileIds.get(a.id);
        const rankB = rankedFileIds.get(b.id);
        if (rankA === undefined || rankB === undefined) return 0;
        return rankA - rankB;
      });
  }, [commands, query, files]);

  /**
   * One row that hands the query to the workspace search, rather than ten shallow answers here.
   *
   * This section used to run its own `searchMarkdown` over the whole workspace — the same adapter,
   * the same IPC, the same full read of every Page as the sidebar's search view, differing only in
   * a `limit` of 10 against 50 and in passing no structured criteria. It then threw away the
   * per-line matches the adapter had deliberately kept: one row per Page, opened at the top rather
   * than at the line that matched. The panel it now defers to groups every hit under its Page,
   * marks the matched run, jumps to the line, understands `file:`/`path:`/`-`/OR/regex, and stays
   * open while the reader walks the results. Two scans of the same files to show the worse half of
   * one answer is not a second feature.
   */
  const searchFileCommands = React.useMemo<CommandItem[]>(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_CONTENT_SEARCH_CHARS) return [];
    return [
      {
        id: "search-workspace-escalate",
        label: t("searchAllFiles", { query: trimmed }),
        icon: <FileText className="h-4 w-4" />,
        category: "searchFiles" as const,
        action: () => {
          openSidebarSearch(trimmed);
          onClose();
        },
        keywords: [],
      },
    ];
  }, [query, t, openSidebarSearch, onClose]);

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

  // Focus input when opened, clear search state.
  //
  // The portal below used to be gated behind a `mounted` flag flipped in an
  // effect — the usual client-only guard for `createPortal`. The palette does
  // not need it: it is `import()`ed from an effect and can only ever mount in a
  // browser. The gate cost a wasted render, and it made this focus a race. On
  // the commit where `mounted` was still false the component rendered null, so
  // `inputRef.current` was empty when this effect ran, and the
  // `requestAnimationFrame` it used to schedule could fire before the `mounted`
  // re-render had put the input in the DOM. Focus was then dropped silently and
  // never retried: the dialog sat open with the caret still in the Page behind
  // it, and everything the user typed went into their Markdown instead of the
  // search box. The 300ms Suspense throttle on the old `next/dynamic` mount hid
  // this, because a commit landing after 300ms of an idle main thread always won
  // the race. Once the palette opened promptly the input took focus 3 times in
  // 10 first-opens. Rendering the portal on the first commit means the ref is
  // live by the time this effect runs: 10/10, with no frame to lose.
  React.useEffect(() => {
    setQuery("");
    setSelectedIndex(0);
    // Only auto-focus on desktop to avoid keyboard popup on mobile
    if (window.innerWidth >= 768) {
      inputRef.current?.focus();
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
        aria-label={t("title")}
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
            placeholder={t("placeholder")}
            className={cn(
              "flex-1 bg-transparent text-base md:text-sm",
              "placeholder:text-muted-foreground",
              "focus:outline-none"
            )}
            aria-label={t("searchLabel")}
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

        {/* Command list */}
        <div
          ref={listRef}
          className="max-h-[300px] overflow-y-auto p-1.5"
          role="listbox"
          aria-label={t("commandsLabel")}
        >
          {flattenedCommands.length === 0 ? (
            <div className="px-2 py-8 text-center text-sm text-muted-foreground">
              {query.trim() ? t("noResults") : t("empty")}
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

/** One glyph per category, so the list reads as groups without a header per row. */
function CommandIcon({ category }: { category: string }) {
  if (category === "file") return <FilePlus className="h-4 w-4" />;
  if (category === "view") return <Palette className="h-4 w-4" />;
  if (category === "editor") return <Keyboard className="h-4 w-4" />;
  return <Search className="h-4 w-4" />;
}
