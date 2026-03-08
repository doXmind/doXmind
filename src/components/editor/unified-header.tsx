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
  Palette,
  SpellCheck,
  Play,
} from "lucide-react";
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
import { ThemePickerPanel } from "@/components/shared/shared-theme-toggle";
import { cn, formatShortcut } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useLayoutStore } from "@/stores/layout-store";
import { useFileStore } from "@/stores/file-store";
import { useEditorStore } from "@/stores/editor-store";
import { UserMenu } from "@/components/layout/user-menu";

import { CreditsExhaustedBanner } from "@/components/billing/credits-exhausted-banner";
import { PricingModal } from "@/components/billing/pricing-modal";
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
    autocompleteTriggerMode,
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
  const tSettings = useTranslations("settings");
  const t = useTranslations("editor");

  const currentFile = files.find((f) => f.id === currentFileId);

  const handleReviewClick = () => {
    if (isReviewActive) {
      setReviewPanelOpen(!isReviewPanelOpen);
    } else {
      requestReview();
    }
  };

  const handleExport = (format: "markdown" | "pdf" | "docx") => {
    if (!currentFile) return;
    const formatLabel = format === "markdown" ? "Markdown" : format.toUpperCase();

    toast.promise(
      api.exportFile(currentFile.id, format).then((blob) => {
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
      }),
      {
        loading: t("exportingAs", { format: formatLabel }),
        success: t("exportedAs", { format: formatLabel }),
        error: t("failedToExportAs", { format: formatLabel }),
      }
    );
  };

  const setAutocomplete = (mode: AutocompleteMode) => {
    setAutocompleteEnabled(true);
    setAutocompleteTriggerMode("auto");
    setAutocompleteMode(mode);
  };

  const setAutocompleteManual = () => {
    setAutocompleteEnabled(true);
    setAutocompleteTriggerMode("manual");
  };

  return (
    <>
      <header className="bg-sidebar relative z-20 flex h-12 shrink-0 items-center justify-between border-b border-border/40 px-6">
        {/* Left: Home + Sidebar toggle + Breadcrumb */}
        <div className="flex min-w-0 items-center gap-1">
          <Tooltip content={t("homeTooltip")} side="bottom">
            <Link
              href="/"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent"
            >
              <Logo variant="icon" size="sm" className="h-6 w-6" />
            </Link>
          </Tooltip>

          <div className="mx-1 h-5 w-px bg-border/40" />

          <Tooltip content={isFilesSidebarOpen ? t("hideFiles") : t("showFiles")} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8 text-foreground", isFilesSidebarOpen && "bg-accent")}
              onClick={toggleFilesSidebar}
              aria-label={isFilesSidebarOpen ? t("hideFiles") : t("showFiles")}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>

        {/* Right: Action buttons — only when a file is open */}
        <div className="flex items-center gap-1">
          {currentFile && (
            <>
              {/* Present */}
              <Tooltip content={t("present")} side="bottom">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setPresentationMode(true)}
                  aria-label={t("present")}
                >
                  <Play className="h-4 w-4" />
                </Button>
              </Tooltip>

              {/* Search */}
              <Tooltip
                content={t("findTooltip", { shortcut: formatShortcut("Ctrl+F") })}
                side="bottom"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-8 w-8 text-muted-foreground hover:text-foreground",
                    isSearchBarOpen && "bg-accent text-accent-foreground"
                  )}
                  onClick={toggleSearchBar}
                  aria-label={t("findTooltip", { shortcut: formatShortcut("Ctrl+F") })}
                >
                  <Search className="h-4 w-4" />
                </Button>
              </Tooltip>

              {/* More Menu */}
              <DropdownMenu>
                <Tooltip content={t("moreTooltip")} side="bottom">
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      aria-label={t("moreActions")}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </Tooltip>
                <DropdownMenuContent align="end" className="w-56">
                  {/* AI Writing Review */}
                  <DropdownMenuItem onClick={handleReviewClick} disabled={isReviewLoading}>
                    {isReviewLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <FileSearch className="mr-2 h-4 w-4" />
                    )}
                    {t("aiWritingReview")}
                    {isReviewActive && <Check className="ml-auto h-4 w-4" />}
                  </DropdownMenuItem>

                  {/* Autocomplete submenu */}
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Sparkles className="mr-2 h-4 w-4" />
                      {t("autocomplete")}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {!autocompleteEnabled
                          ? t("autocompleteOff")
                          : autocompleteTriggerMode === "manual"
                            ? t("autocompleteManual")
                            : autocompleteMode === "short"
                              ? t("autocompleteShort")
                              : autocompleteMode === "long"
                                ? t("autocompleteLong")
                                : t("autocompleteAdaptive")}
                      </span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent side="left" className="w-56">
                      <DropdownMenuItem
                        onClick={() => setAutocomplete("short")}
                        className={cn(
                          autocompleteEnabled &&
                            autocompleteTriggerMode !== "manual" &&
                            autocompleteMode === "short" &&
                            "bg-accent"
                        )}
                      >
                        <Zap className="mr-2 h-4 w-4" />
                        {t("autocompleteShort")}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {t("shortDesc")}
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setAutocomplete("long")}
                        className={cn(
                          autocompleteEnabled &&
                            autocompleteTriggerMode !== "manual" &&
                            autocompleteMode === "long" &&
                            "bg-accent"
                        )}
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        {t("autocompleteLong")}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {t("longDesc")}
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setAutocomplete("adaptive")}
                        className={cn(
                          autocompleteEnabled &&
                            autocompleteTriggerMode !== "manual" &&
                            autocompleteMode === "adaptive" &&
                            "bg-accent"
                        )}
                      >
                        <Target className="mr-2 h-4 w-4" />
                        {t("autocompleteAdaptive")}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {t("adaptiveDesc")}
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={setAutocompleteManual}
                        className={cn(
                          autocompleteEnabled && autocompleteTriggerMode === "manual" && "bg-accent"
                        )}
                      >
                        <Keyboard className="mr-2 h-4 w-4" />
                        {t("autocompleteManual")}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {t("manualTrigger")}
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setAutocompleteEnabled(false)}
                        className={cn(!autocompleteEnabled && "bg-accent")}
                      >
                        <Sparkles className="mr-2 h-4 w-4 opacity-50" />
                        {t("autocompleteOff")}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {t("disabledLabel")}
                        </span>
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>

                  {/* Spell Check */}
                  <DropdownMenuItem onClick={() => setSpellcheckEnabled(!spellcheckEnabled)}>
                    <SpellCheck className="mr-2 h-4 w-4" />
                    {t("spellCheck")}
                    {spellcheckEnabled && <Check className="ml-auto h-4 w-4" />}
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  {/* Theme */}
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Palette className="mr-2 h-4 w-4" />
                      {tSettings("appearance")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent side="left" className="w-[280px] p-3">
                      <ThemePickerPanel />
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>

                  <DropdownMenuSeparator />

                  {/* Version History */}
                  <DropdownMenuItem onClick={toggleVersionHistory}>
                    <Clock className="mr-2 h-4 w-4" />
                    {t("versionHistory")}
                    {isVersionHistoryOpen && <Check className="ml-auto h-4 w-4" />}
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  {/* Export */}
                  <DropdownMenuItem onClick={() => handleExport("markdown")}>
                    <Download className="mr-2 h-4 w-4" />
                    {t("exportAsMarkdown")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("pdf")}>
                    <Download className="mr-2 h-4 w-4" />
                    {t("exportAsPDF")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("docx")}>
                    <Download className="mr-2 h-4 w-4" />
                    {t("exportAsWord")}
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  {/* Keyboard Shortcuts */}
                  <DropdownMenuItem onClick={() => setKeyboardShortcutsOpen(true)}>
                    <Keyboard className="mr-2 h-4 w-4" />
                    {t("keyboardShortcuts")}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatShortcut("Ctrl+?")}
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="mx-1 h-5 w-px bg-border/30" />
            </>
          )}
          <UserMenu compact />
        </div>
      </header>
      <CreditsExhaustedBanner />
      <PricingModal />
    </>
  );
}
