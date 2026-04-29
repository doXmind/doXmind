"use client";

import {
  Search,
  MoreHorizontal,
  PanelLeft,
  ChevronLeft,
  ChevronRight,
  Check,
  Clock,
  Download,
  Keyboard,
  Palette,
  SpellCheck,
  Play,
  CloudUpload,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ThemePickerPanel } from "@/components/shared/shared-theme-toggle";
import { cn, formatShortcut } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useLayoutStore } from "@/stores/layout-store";
import { useFileStore } from "@/stores/file-store";
import { useEditorStore } from "@/stores/editor-store";
import { api } from "@/lib/api";
import { useIsTauri } from "@/hooks/use-is-tauri";

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
  const { spellcheckEnabled, setSpellcheckEnabled, isDirty, isSaving } = useEditorStore();
  const tSettings = useTranslations("settings");
  const t = useTranslations("editor");

  const currentFile = files.find((f) => f.id === currentFileId);
  const title = currentFile?.name?.replace(/\.md$/i, "") || t("untitled");
  const saveLabel = isSaving ? t("saving") : isDirty ? t("unsavedChanges") : t("saved");

  // In the Tauri macOS build the native title bar is hidden via
  // `titleBarStyle: Overlay`, so the real traffic-light buttons float over
  // the top-left of the WebView. Reserve ~78px of left padding for them and
  // make the header itself a drag region so the window can still be moved.
  const { isTauri, platform } = useIsTauri();
  const isMacTauri = isTauri && platform === "macos";

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

  return (
    <>
      <header
        data-tauri-drag-region
        className={cn(
          // 1fr_auto_1fr keeps the centered title pill in the visual middle
          // of the window regardless of how much the left/right action
          // groups change width (e.g. when no file is open).
          //
          // In dark mode the sidebar and main pane both use --background
          // (#1a1a1a). Match that here so the only visible horizontal seam
          // is the `border-b` line — picking a different shade (we used to
          // hard-code #161616) caused a second, parallel "phantom" line at
          // the header/content boundary from the colour transition.
          // Light mode keeps the original dark header strip because the
          // header's icon colours are hard-coded for a dark surface.
          "relative z-20 grid h-11 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-b border-border/50 bg-[#161616] pr-3 text-foreground dark:bg-background",
          // On macOS Tauri the real traffic lights live at ~12px from the
          // left, ~18px from the top — leave 78px so the green button has
          // breathing room before our first sidebar toggle.
          isMacTauri ? "pl-[78px]" : "pl-3"
        )}
      >
        <div data-tauri-drag-region className="flex min-w-0 items-center gap-2">
          <Tooltip content={isFilesSidebarOpen ? t("hideFiles") : t("showFiles")} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "hover:bg-white/8 h-7 w-7 rounded-md text-zinc-400 hover:text-zinc-100",
                isFilesSidebarOpen && "bg-white/8 text-zinc-100"
              )}
              onClick={toggleFilesSidebar}
              aria-label={isFilesSidebarOpen ? t("hideFiles") : t("showFiles")}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          </Tooltip>

          <Tooltip content={t("back")} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              className="hover:bg-white/8 h-7 w-7 rounded-md text-zinc-500 hover:text-zinc-200"
              onClick={() => window.history.back()}
              aria-label={t("back")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip content={t("forward")} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              className="hover:bg-white/8 h-7 w-7 rounded-md text-zinc-500 hover:text-zinc-200"
              onClick={() => window.history.forward()}
              aria-label={t("forward")}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>

        <div data-tauri-drag-region className="flex min-w-0 justify-center px-4">
          <div
            data-tauri-drag-region
            className="flex h-8 min-w-0 max-w-[min(680px,100%)] items-center gap-2 rounded-md border border-white/10 bg-[#1f1f1f] px-3 shadow-sm"
            aria-label={title}
          >
            <span
              data-tauri-drag-region
              className="min-w-0 truncate text-[13px] font-semibold text-zinc-100"
            >
              {title}
            </span>
          </div>
        </div>

        <div data-tauri-drag-region className="flex items-center justify-end gap-1.5">
          {currentFile && (
            <>
              <Tooltip content={t("present")} side="bottom">
                <Button
                  variant="ghost"
                  size="icon"
                  className="hover:bg-white/8 h-7 w-7 rounded-md text-zinc-400 hover:text-zinc-100"
                  onClick={() => setPresentationMode(true)}
                  aria-label={t("present")}
                >
                  <Play className="h-3.5 w-3.5" />
                </Button>
              </Tooltip>

              <div className="h-5 w-px bg-white/10" />

              <Tooltip content={saveLabel} side="bottom">
                <div className="flex h-7 items-center gap-1.5 rounded-md border border-white/10 bg-[#202020] px-2 text-[12px] font-semibold text-zinc-300">
                  {isSaving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
                  ) : (
                    <CloudUpload className="h-3.5 w-3.5 text-zinc-400" />
                  )}
                  <span>{isDirty ? t("unsavedChanges") : t("saved")}</span>
                </div>
              </Tooltip>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 rounded-md border border-white/10 bg-[#202020] px-2 text-[12px] font-semibold text-zinc-200 hover:bg-white/10 hover:text-white"
                    aria-label={t("export")}
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t("export")}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
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
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="h-5 w-px bg-white/10" />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hover:bg-white/8 h-7 w-7 rounded-md text-zinc-400 hover:text-zinc-100"
                    aria-label={tSettings("appearance")}
                  >
                    <Palette className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[280px] p-3">
                  <ThemePickerPanel />
                </DropdownMenuContent>
              </DropdownMenu>

              <Tooltip
                content={t("findTooltip", { shortcut: formatShortcut("Ctrl+F") })}
                side="bottom"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "hover:bg-white/8 h-7 w-7 rounded-md text-zinc-400 hover:text-zinc-100",
                    isSearchBarOpen && "bg-white/10 text-zinc-100"
                  )}
                  onClick={toggleSearchBar}
                  aria-label={t("findTooltip", { shortcut: formatShortcut("Ctrl+F") })}
                >
                  <Search className="h-3.5 w-3.5" />
                </Button>
              </Tooltip>

              <DropdownMenu>
                <Tooltip content={t("moreTooltip")} side="bottom">
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hover:bg-white/8 h-7 w-7 rounded-md text-zinc-400 hover:text-zinc-100"
                      aria-label={t("moreActions")}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </Tooltip>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={() => setSpellcheckEnabled(!spellcheckEnabled)}>
                    <SpellCheck className="mr-2 h-4 w-4" />
                    {t("spellCheck")}
                    {spellcheckEnabled && <Check className="ml-auto h-4 w-4" />}
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={toggleVersionHistory}>
                    <Clock className="mr-2 h-4 w-4" />
                    {t("versionHistory")}
                    {isVersionHistoryOpen && <Check className="ml-auto h-4 w-4" />}
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setKeyboardShortcutsOpen(true)}>
                    <Keyboard className="mr-2 h-4 w-4" />
                    {t("keyboardShortcuts")}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatShortcut("Ctrl+?")}
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </header>
    </>
  );
}
