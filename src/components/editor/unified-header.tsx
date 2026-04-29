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
      <header className="relative z-20 grid h-11 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center border-b border-border/40 bg-[#161616]/95 px-3 text-foreground shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
        <div className="flex min-w-0 items-center gap-2">
          <div className="mr-1 flex items-center gap-2 pl-0.5" aria-hidden="true">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </div>
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

        <div className="flex min-w-0 justify-center px-4">
          <div
            className="flex h-8 min-w-0 max-w-[min(680px,100%)] items-center gap-2 rounded-md border border-white/10 bg-[#1f1f1f] px-3 shadow-sm"
            aria-label={title}
          >
            <span className="min-w-0 truncate text-[13px] font-semibold text-zinc-100">
              {title}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-1.5">
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
