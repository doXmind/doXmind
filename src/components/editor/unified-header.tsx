"use client";

import Link from "next/link";
import {
  Search,
  MoreHorizontal,
  FileSearch,
  Sparkles,
  Zap,
  FileText,
  PanelLeft,
  Target,
  Loader2,
  Check,
  Clock,
  Download,
  Keyboard,
  Sun,
  Moon,
  SpellCheck,
  Play,
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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { cn, formatShortcut } from "@/lib/utils";
import { toast } from "sonner";
import { useLayoutStore } from "@/stores/layout-store";
import { useFileStore } from "@/stores/file-store";
import { useEditorStore } from "@/stores/editor-store";
import { UserMenu } from "@/components/layout/user-menu";
import { api } from "@/lib/api";
import type { AutocompleteMode } from "@/types";

export function UnifiedHeader() {
  const {
    isFilesSidebarOpen,
    isVersionHistoryOpen,
    isSearchBarOpen,
    toggleFilesSidebar,
    toggleVersionHistory,
    toggleSearchBar,
    setKeyboardShortcutsOpen,
    setPresentationMode,
  } = useLayoutStore();
  const { currentFileId, files } = useFileStore();
  const {
    autocompleteEnabled,
    setAutocompleteEnabled,
    setAutocompleteTriggerMode,
    autocompleteMode,
    setAutocompleteMode,
    isReviewLoading,
    isReviewActive,
    requestReview,
    isReviewPanelOpen,
    setReviewPanelOpen,
    spellcheckEnabled,
    setSpellcheckEnabled,
  } = useEditorStore();
  const { theme, setTheme } = useTheme();

  const currentFile = files.find((f) => f.id === currentFileId);

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  const handleReviewClick = () => {
    if (isReviewActive) {
      setReviewPanelOpen(!isReviewPanelOpen);
    } else {
      requestReview();
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

      import("@/stores/onboarding-store")
        .then(({ useOnboardingStore }) => {
          useOnboardingStore.getState().completeStep("export");
        })
        .catch(() => {});
    } catch {
      toast.error(`Failed to export as ${format.toUpperCase()}`);
    }
  };

  const setAutocomplete = (mode: AutocompleteMode) => {
    setAutocompleteEnabled(true);
    setAutocompleteTriggerMode("auto");
    setAutocompleteMode(mode);
  };

  return (
    <header className="bg-sidebar relative z-20 flex h-11 shrink-0 items-center justify-between border-b border-border/40 px-2.5">
      {/* Left: Home + Sidebar toggle + Breadcrumb */}
      <div className="flex min-w-0 items-center gap-0.5">
        <Tooltip content="Home" side="bottom">
          <Link
            href="/"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent"
          >
            <Logo variant="icon" size="sm" className="h-4 w-4" />
          </Link>
        </Tooltip>

        <div className="mx-1 h-4 w-px bg-border/40" />

        <Tooltip content={isFilesSidebarOpen ? "Hide Files" : "Show Files"} side="bottom">
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-7 w-7 text-foreground", isFilesSidebarOpen && "bg-accent")}
            onClick={toggleFilesSidebar}
            aria-label={isFilesSidebarOpen ? "Hide Files" : "Show Files"}
          >
            <PanelLeft className="h-3.5 w-3.5" />
          </Button>
        </Tooltip>
      </div>

      {/* Right: Action buttons — only when a file is open */}
      <div className="flex items-center gap-0.5">
        {currentFile && (
          <>
            {/* Present */}
            <Tooltip content="Present" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => setPresentationMode(true)}
                aria-label="Present"
              >
                <Play className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>

            {/* Search */}
            <Tooltip content={`Find (${formatShortcut("Ctrl+F")})`} side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 text-muted-foreground hover:text-foreground",
                  isSearchBarOpen && "bg-accent text-accent-foreground"
                )}
                onClick={toggleSearchBar}
                aria-label="Search"
              >
                <Search className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>

            {/* More Menu */}
            <DropdownMenu>
              <Tooltip content="More" side="bottom">
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    aria-label="More actions"
                    data-onboarding="more-menu"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-56">
                {/* AI Writing Review */}
                <DropdownMenuItem
                  onClick={handleReviewClick}
                  disabled={isReviewLoading}
                  data-onboarding="review-button"
                >
                  {isReviewLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileSearch className="mr-2 h-4 w-4" />
                  )}
                  AI Writing Review
                  {isReviewActive && <Check className="ml-auto h-4 w-4" />}
                </DropdownMenuItem>

                {/* Autocomplete submenu */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Autocomplete
                    <span className="ml-auto text-xs text-muted-foreground">
                      {!autocompleteEnabled
                        ? "Off"
                        : autocompleteMode === "short"
                          ? "Short"
                          : autocompleteMode === "long"
                            ? "Long"
                            : "Adaptive"}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem
                      onClick={() => setAutocomplete("short")}
                      className={cn(
                        autocompleteEnabled && autocompleteMode === "short" && "bg-accent"
                      )}
                    >
                      <Zap className="mr-2 h-4 w-4" />
                      Short
                      <span className="ml-auto text-xs text-muted-foreground">1 line, fast</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setAutocomplete("long")}
                      className={cn(
                        autocompleteEnabled && autocompleteMode === "long" && "bg-accent"
                      )}
                    >
                      <FileText className="mr-2 h-4 w-4" />
                      Long
                      <span className="ml-auto text-xs text-muted-foreground">Multi-line</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setAutocomplete("adaptive")}
                      className={cn(
                        autocompleteEnabled && autocompleteMode === "adaptive" && "bg-accent"
                      )}
                    >
                      <Target className="mr-2 h-4 w-4" />
                      Adaptive
                      <span className="ml-auto text-xs text-muted-foreground">Auto-switch</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setAutocompleteEnabled(false)}
                      className={cn(!autocompleteEnabled && "bg-accent")}
                    >
                      <Sparkles className="mr-2 h-4 w-4 opacity-50" />
                      Off
                      <span className="ml-auto text-xs text-muted-foreground">Disabled</span>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                {/* Spell Check */}
                <DropdownMenuItem onClick={() => setSpellcheckEnabled(!spellcheckEnabled)}>
                  <SpellCheck className="mr-2 h-4 w-4" />
                  Spell Check
                  {spellcheckEnabled && <Check className="ml-auto h-4 w-4" />}
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* Theme */}
                <DropdownMenuItem onClick={toggleTheme}>
                  {theme === "dark" ? (
                    <Sun className="mr-2 h-4 w-4" />
                  ) : (
                    <Moon className="mr-2 h-4 w-4" />
                  )}
                  {theme === "dark" ? "Light Mode" : "Dark Mode"}
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* Version History */}
                <DropdownMenuItem onClick={toggleVersionHistory} data-onboarding="version-history">
                  <Clock className="mr-2 h-4 w-4" />
                  Version History
                  {isVersionHistoryOpen && <Check className="ml-auto h-4 w-4" />}
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* Export */}
                <DropdownMenuItem
                  onClick={() => handleExport("markdown")}
                  data-onboarding="export-button"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export as Markdown
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("pdf")}>
                  <Download className="mr-2 h-4 w-4" />
                  Export as PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("docx")}>
                  <Download className="mr-2 h-4 w-4" />
                  Export as Word
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* Keyboard Shortcuts */}
                <DropdownMenuItem onClick={() => setKeyboardShortcutsOpen(true)}>
                  <Keyboard className="mr-2 h-4 w-4" />
                  Keyboard Shortcuts
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatShortcut("Ctrl+?")}
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="mx-1 h-4 w-px bg-border/30" />
          </>
        )}
        <UserMenu compact />
      </div>
    </header>
  );
}
