"use client";

import {
  Search,
  MoreHorizontal,
  PanelLeft,
  Download,
  Keyboard,
  Palette,
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
import { notify } from "@/lib/notifications";
import { useLayoutStore } from "@/stores/layout-store";
import { useFileStore } from "@/stores/file-store";
import { useEditorStore } from "@/stores/editor-store";
import { useIsTauri } from "@/hooks/use-is-tauri";
import { getDisplayName, isExcelFile, isPdfFile } from "@/lib/document-types";
import { exportMarkdownAsPdf } from "@/lib/markdown-pdf-export";

export function UnifiedHeader() {
  const isFilesSidebarOpen = useLayoutStore((s) => s.isFilesSidebarOpen);
  const isSearchBarOpen = useLayoutStore((s) => s.isSearchBarOpen);
  const toggleFilesSidebar = useLayoutStore((s) => s.toggleFilesSidebar);
  const toggleSearchBar = useLayoutStore((s) => s.toggleSearchBar);
  const setKeyboardShortcutsOpen = useLayoutStore((s) => s.setKeyboardShortcutsOpen);
  const currentFile = useFileStore((s) =>
    s.currentFileId ? s.files.find((file) => file.id === s.currentFileId) : undefined
  );
  const openTarget = useFileStore((s) => s.openTarget);
  // Hide the sidebar toggle on the welcome screen — there's nothing to show.
  const hasOpenTarget = openTarget !== "none";
  const currentFileName = currentFile?.name;
  const isDirty = useEditorStore((s) => s.isDirty);
  const isSaving = useEditorStore((s) => s.isSaving);
  const tSettings = useTranslations("settings");
  const t = useTranslations("editor");

  // Only show a title when an actual document is loaded — on the
  // welcome screen there's no file to title, so showing "Untitled"
  // would just be noise.
  const isExcel = currentFile ? isExcelFile(currentFile) : false;
  const title = currentFileName ? getDisplayName(currentFileName) : "";
  const saveLabel = isSaving ? t("saving") : isDirty ? t("unsavedChanges") : t("saved");

  // In the Tauri macOS build the native title bar is hidden via
  // `titleBarStyle: Overlay`, so the real traffic-light buttons float over
  // the top-left of the WebView. Reserve ~78px of left padding for them and
  // make the header itself a drag region so the window can still be moved.
  const { isTauri, platform } = useIsTauri();
  const isMacTauri = isTauri && platform === "macos";

  const handleExport = async (format: "markdown" | "pdf" | "docx" | "xlsx") => {
    const { currentFileId, files } = useFileStore.getState();
    const currentFile = currentFileId ? files.find((file) => file.id === currentFileId) : undefined;
    if (!currentFile) return;

    // PDF export when the active document is a PDF: hand off to the PDF
    // editor (PyMuPDF redact + insert_htmlbox pipeline). The editor owns
    // the raw bytes + edits, so it does the actual download.
    if (format === "pdf" && isPdfFile(currentFile)) {
      window.dispatchEvent(new CustomEvent("doxmind:export-pdf"));
      return;
    }

    // Excel export — same pattern. The Excel editor holds the original
    // bytes plus the sidecar edit payload and round-trips them through
    // /api/excel/export-edited.
    if (format === "xlsx" && isExcelFile(currentFile)) {
      window.dispatchEvent(new CustomEvent("doxmind:export-xlsx"));
      return;
    }

    // Markdown -> PDF: render with the local Python/PyMuPDF sidecar, then let
    // the desktop shell write the returned PDF bytes to the selected file.
    if (format === "pdf") {
      const result = await exportMarkdownAsPdf({ fileName: currentFile.name });
      if (result.ok) {
        return;
      }
      if (result.error && result.error !== "cancelled") {
        notify.error(result.error);
      }
      return;
    }

    if (format !== "markdown") {
      notify.error(t("diskExportOnlyMarkdown"));
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
  };

  const handleFind = () => {
    if (currentFile && isExcelFile(currentFile)) {
      window.dispatchEvent(new CustomEvent("doxmind:excel-find"));
      return;
    }
    toggleSearchBar();
  };

  return (
    <>
      <header
        data-tauri-drag-region
        data-borderless={!currentFileName ? "" : undefined}
        data-sidebar-open={hasOpenTarget && isFilesSidebarOpen ? "" : undefined}
        className="desktop-chrome-header relative z-20 grid h-14 shrink-0 items-center text-foreground"
        style={{
          // On macOS Tauri the native traffic-light cluster floats over the
          // top-left ~78px of the WebView. The first column must never shrink
          // below that, or the title in col-start-2 slides under the buttons
          // when the sidebar is collapsed.
          gridTemplateColumns: isMacTauri
            ? "max(var(--files-sidebar-width, 0px), 78px) minmax(0, 1fr)"
            : "var(--files-sidebar-width, 0px) minmax(0, 1fr)",
        }}
      >
        <div
          className={cn(
            "desktop-chrome-left-controls absolute left-0 top-0 z-10 flex h-full min-w-0 items-center gap-2",
            !isMacTauri && "pl-3"
          )}
        >
          {isMacTauri && (
            <>
              {/* Two drag strips that physically avoid the macOS traffic-light
                  cluster (centered at y=30, ~14px tall). Tauri's drag.js only
                  checks e.target, so the bare container above must NOT carry
                  data-tauri-drag-region — these siblings restore window-drag
                  for the empty space around the buttons without ever sitting
                  on top of the close/min/max controls. */}
              <span
                data-tauri-drag-region
                aria-hidden
                className="pointer-events-auto absolute inset-x-0 top-0 h-5"
              />
              <span
                data-tauri-drag-region
                aria-hidden
                className="pointer-events-auto absolute inset-x-0 bottom-0 top-10"
              />
            </>
          )}
          {hasOpenTarget && (
            <Tooltip content={isFilesSidebarOpen ? t("hideFiles") : t("showFiles")} side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="desktop-header-button relative z-10 h-7 w-7 rounded-md"
                onClick={toggleFilesSidebar}
                aria-label={isFilesSidebarOpen ? t("hideFiles") : t("showFiles")}
              >
                <PanelLeft className="h-[13px] w-[13px]" />
              </Button>
            </Tooltip>
          )}
        </div>

        <div
          // Intentionally NOT a drag region: when the sidebar is collapsed
          // this column's left edge sits at x=78px, overlapping the right
          // 14px of the macOS traffic-light cluster. Tauri's drag.js only
          // inspects e.target, so a drag-region here would swallow clicks
          // landing on that overlap. The inner children below still carry
          // data-tauri-drag-region, so the body of the header remains
          // draggable everywhere they cover.
          className={cn(
            "col-start-2 flex h-full min-w-0 items-center px-4 md:px-6",
            hasOpenTarget && isFilesSidebarOpen && "desktop-chrome-content-panel"
          )}
        >
          <div
            data-tauri-drag-region
            className="flex h-full w-full min-w-0 max-w-none items-center justify-between gap-4"
          >
            <div data-tauri-drag-region className="flex min-w-0 justify-start">
              {title && (
                <div
                  data-tauri-drag-region
                  className="flex h-8 min-w-0 max-w-[min(520px,100%)] items-center gap-2 rounded-md"
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

            <div data-tauri-drag-region className="flex shrink-0 items-center justify-end gap-1.5">
              {currentFileName && (
                <>
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
                      {isExcel ? (
                        <DropdownMenuItem onClick={() => handleExport("xlsx")}>
                          <Download className="mr-2 h-4 w-4" />
                          Export as Excel
                        </DropdownMenuItem>
                      ) : (
                        <>
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
                        </>
                      )}
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
                      onClick={handleFind}
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
          </div>
        </div>
      </header>
    </>
  );
}
