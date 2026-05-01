"use client";

import {
  Search,
  MoreHorizontal,
  PanelLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Keyboard,
  Palette,
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
} from "@/components/ui/dropdown-menu";
import { ThemePickerPanel } from "@/components/shared/shared-theme-toggle";
import { cn, formatShortcut } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useLayoutStore } from "@/stores/layout-store";
import { useFileStore } from "@/stores/file-store";
import { useEditorStore } from "@/stores/editor-store";
import { useIsTauri } from "@/hooks/use-is-tauri";
import { getDisplayName, isPdfFile } from "@/lib/document-types";

export function UnifiedHeader() {
  const isFilesSidebarOpen = useLayoutStore((s) => s.isFilesSidebarOpen);
  const isSearchBarOpen = useLayoutStore((s) => s.isSearchBarOpen);
  const toggleFilesSidebar = useLayoutStore((s) => s.toggleFilesSidebar);
  const toggleSearchBar = useLayoutStore((s) => s.toggleSearchBar);
  const setKeyboardShortcutsOpen = useLayoutStore((s) => s.setKeyboardShortcutsOpen);
  const setPresentationMode = useLayoutStore((s) => s.setPresentationMode);
  const currentFile = useFileStore((s) =>
    s.currentFileId ? s.files.find((file) => file.id === s.currentFileId) : undefined
  );
  const currentFileName = currentFile?.name;
  const isDirty = useEditorStore((s) => s.isDirty);
  const isSaving = useEditorStore((s) => s.isSaving);
  const tSettings = useTranslations("settings");
  const t = useTranslations("editor");

  // Only show a title when an actual document is loaded — on the
  // welcome screen there's no file to title, so showing "Untitled"
  // would just be noise.
  const isPdf = currentFile ? isPdfFile(currentFile) : false;
  const title = currentFileName ? getDisplayName(currentFileName) : "";
  const saveLabel = isSaving ? t("saving") : isDirty ? t("unsavedChanges") : t("saved");

  // In the Tauri macOS build the native title bar is hidden via
  // `titleBarStyle: Overlay`, so the real traffic-light buttons float over
  // the top-left of the WebView. Reserve ~78px of left padding for them and
  // make the header itself a drag region so the window can still be moved.
  const { isTauri, platform } = useIsTauri();
  const isMacTauri = isTauri && platform === "macos";

  const handleExport = (format: "markdown" | "pdf" | "docx") => {
    const { currentFileId, files } = useFileStore.getState();
    const currentFile = currentFileId ? files.find((file) => file.id === currentFileId) : undefined;
    if (!currentFile) return;
    const formatLabel = format === "markdown" ? "Markdown" : format.toUpperCase();

    // PDF export when the active document is a PDF: hand off to the PDF
    // editor (PyMuPDF redact + insert_htmlbox pipeline). The editor owns
    // the raw bytes + edits, so it does the actual download.
    if (format === "pdf" && isPdfFile(currentFile)) {
      window.dispatchEvent(new CustomEvent("doxmind:export-pdf"));
      return;
    }

    if (format !== "markdown") {
      toast.error(t("diskExportOnlyMarkdown"));
      return;
    }
    const markdown = currentFile.contentMarkdown ?? currentFile.content ?? "";
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const baseName = currentFile.name.replace(/\.md$/, "");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(t("exportedAs", { format: formatLabel }));
  };

  return (
    <>
      <header
        data-tauri-drag-region
        data-borderless={!currentFileName ? "" : undefined}
        className="desktop-chrome-header relative z-20 grid h-11 shrink-0 items-center pr-3 text-foreground"
        style={{
          gridTemplateColumns: "max(var(--files-sidebar-width, 304px), 124px) minmax(0, 1fr) auto",
        }}
      >
        <div
          data-tauri-drag-region
          className={cn(
            "desktop-chrome-left-controls flex min-w-0 items-center gap-2",
            !isMacTauri && "pl-3"
          )}
        >
          <Tooltip content={isFilesSidebarOpen ? t("hideFiles") : t("showFiles")} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              className="desktop-header-button h-7 w-7 rounded-md"
              onClick={toggleFilesSidebar}
              aria-label={isFilesSidebarOpen ? t("hideFiles") : t("showFiles")}
            >
              <PanelLeft className="h-[13px] w-[13px]" />
            </Button>
          </Tooltip>

          <Tooltip content={t("back")} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              className="desktop-header-button h-7 w-7 rounded-md"
              onClick={() => window.history.back()}
              aria-label={t("back")}
            >
              <ChevronLeft className="h-[13px] w-[13px]" />
            </Button>
          </Tooltip>
          <Tooltip content={t("forward")} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              className="desktop-header-button h-7 w-7 rounded-md"
              onClick={() => window.history.forward()}
              aria-label={t("forward")}
            >
              <ChevronRight className="h-[13px] w-[13px]" />
            </Button>
          </Tooltip>
        </div>

        <div data-tauri-drag-region className="flex min-w-0 justify-start px-4">
          {title && (
            <div
              data-tauri-drag-region
              className="flex h-8 min-w-0 max-w-[min(520px,100%)] items-center gap-2 rounded-md px-1.5"
              aria-label={title}
            >
              <span
                data-tauri-drag-region
                className="text-ui-base min-w-0 truncate font-semibold text-foreground"
              >
                {title}
              </span>
            </div>
          )}
        </div>

        <div data-tauri-drag-region className="flex items-center justify-end gap-1.5">
          {currentFileName && (
            <>
              {!isPdf && (
                <Tooltip content={t("present")} side="bottom">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="desktop-header-button h-7 w-7 rounded-md"
                    onClick={() => setPresentationMode(true)}
                    aria-label={t("present")}
                  >
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                </Tooltip>
              )}

              <div className="h-5 w-px bg-[var(--chrome-border)]" />

              <Tooltip content={saveLabel} side="bottom">
                <div className="text-ui-xs flex h-7 items-center gap-1.5 rounded-md border border-[var(--chrome-border)] bg-[var(--chrome-pill-bg)] px-2 font-semibold text-muted-foreground">
                  {isSaving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  ) : (
                    <CloudUpload className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span>{isDirty ? t("unsavedChanges") : t("saved")}</span>
                </div>
              </Tooltip>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-ui-xs h-7 gap-1.5 rounded-md border border-[var(--chrome-border)] bg-[var(--chrome-pill-bg)] px-2 font-semibold text-foreground hover:bg-[var(--sidebar-hover)] hover:text-foreground"
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

              <div className="h-5 w-px bg-[var(--chrome-border)]" />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="desktop-header-button h-7 w-7 rounded-md"
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
                    "desktop-header-button h-7 w-7 rounded-md",
                    isSearchBarOpen && "bg-[var(--sidebar-active)] text-foreground"
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
                      className="desktop-header-button h-7 w-7 rounded-md"
                      aria-label={t("moreActions")}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </Tooltip>
                <DropdownMenuContent align="end" className="w-56">
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
