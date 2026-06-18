"use client";

import { useCallback, useMemo, useState } from "react";

import {
  Search,
  MoreHorizontal,
  PanelLeft,
  Download,
  Keyboard,
  Palette,
  Check,
  Loader2,
  Save,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { notify } from "@/lib/notifications";
import { useLayoutStore } from "@/stores/layout-store";
import { useFileStore } from "@/stores/file-store";
import { useEditorStore } from "@/stores/editor-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { useIsTauri } from "@/hooks/use-is-tauri";
import { getDisplayName, isExcelFile, isPdfFile } from "@/lib/document-types";
import { exportMarkdownAsPdf } from "@/lib/markdown-pdf-export";
import { navigateToEditorFile } from "@/lib/editor-navigation";
import { shouldStartWindowDrag } from "@/lib/window-drag-region";
import {
  CsvGlyph,
  MarkdownGlyph,
  PdfGlyph,
  SpreadsheetGlyph,
} from "@/components/icons/document-glyphs";
import type { FileItem } from "@/types";

function TabDocumentIcon({ file }: { file: FileItem }) {
  if (isPdfFile(file)) return <PdfGlyph className="h-4 w-4" />;
  if (isExcelFile(file)) return <SpreadsheetGlyph className="h-4 w-4" />;
  if (/\.csv$/i.test(file.name)) return <CsvGlyph className="h-4 w-4" />;
  return <MarkdownGlyph className="h-4 w-4 text-[var(--sidebar-icon)]" />;
}

export function UnifiedHeader() {
  const isFilesSidebarOpen = useLayoutStore((s) => s.isFilesSidebarOpen);
  const toggleFilesSidebar = useLayoutStore((s) => s.toggleFilesSidebar);
  const toggleSearchBar = useLayoutStore((s) => s.toggleSearchBar);
  const openCommandPalette = useLayoutStore((s) => s.openCommandPalette);
  const setKeyboardShortcutsOpen = useLayoutStore((s) => s.setKeyboardShortcutsOpen);
  const autosaveEnabled = useLayoutStore((s) => s.autosaveEnabled);
  const toggleAutosave = useLayoutStore((s) => s.toggleAutosave);
  const currentFile = useFileStore((s) =>
    s.currentFileId ? s.files.find((file) => file.id === s.currentFileId) : undefined
  );
  const currentFileId = useFileStore((s) => s.currentFileId);
  const files = useFileStore((s) => s.files);
  const openTabIds = useFileStore((s) => s.openTabIds);
  const openTarget = useFileStore((s) => s.openTarget);
  const closeTab = useFileStore((s) => s.closeTab);
  // Hide the sidebar toggle on the welcome screen — there's nothing to show.
  const hasOpenTarget = openTarget !== "none";
  const currentFileName = currentFile?.name;
  const isDirty = useEditorStore((s) => s.isDirty);
  const isSaving = useEditorStore((s) => s.isSaving);
  const [closeRequestId, setCloseRequestId] = useState<string | null>(null);
  const tSettings = useTranslations("settings");
  const t = useTranslations("editor");

  // Only show a title when an actual document is loaded — on the
  // welcome screen there's no file to title, so showing "Untitled"
  // would just be noise.
  const isExcel = currentFile ? isExcelFile(currentFile) : false;
  const title = currentFileName ? getDisplayName(currentFileName) : "";
  const closeRequestFile = closeRequestId
    ? files.find((file) => file.id === closeRequestId)
    : undefined;
  const closeRequestTitle = closeRequestFile ? getDisplayName(closeRequestFile.name) : title;
  const saveLabel = isSaving ? t("saving") : isDirty ? t("unsavedChanges") : t("saved");
  const tabFiles = useMemo(() => {
    const byId = new Map(files.filter((file) => !file.isFolder).map((file) => [file.id, file]));
    return openTabIds.flatMap((id) => {
      const file = byId.get(id);
      return file ? [file] : [];
    });
  }, [files, openTabIds]);

  // In the Tauri macOS build the native title bar is hidden via
  // `titleBarStyle: Overlay`, so the real traffic-light buttons float over
  // the top-left of the WebView. Reserve ~78px of left padding for them and
  // make the header itself a drag region so the window can still be moved.
  const { isTauri, platform } = useIsTauri();
  const isMacTauri = isTauri && platform === "macos";

  const handleHeaderPointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!isMacTauri || !shouldStartWindowDrag(event)) return;
      event.preventDefault();
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
        .catch(() => {});
    },
    [isMacTauri]
  );

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

  // Perform the actual close. A never-saved buffer or a loose single file has
  // no workspace to fall back to, so closing returns to the welcome screen;
  // inside an open folder we close only that tab and keep the workspace open.
  const performClose = (fileId?: string | null) => {
    const store = useFileStore.getState();
    const targetId = fileId ?? store.currentFileId;
    if (!targetId) return;
    const wasActive = store.currentFileId === targetId;

    if (store.transientFile?.id === targetId) {
      store.discardTransient();
    } else if (store.openTarget === "file") {
      store.closeOpened();
    } else {
      closeTab(targetId);
    }

    if (wasActive) {
      navigateToEditorFile(useFileStore.getState().currentFileId, { replace: true });
    }
  };

  const handleActivateTab = (fileId: string) => {
    if (fileId === currentFileId) return;
    navigateToEditorFile(fileId);
  };

  const handleCloseTab = (fileId: string) => {
    if (fileId === currentFileId && useEditorStore.getState().isDirty) {
      setCloseRequestId(fileId);
      return;
    }
    performClose(fileId);
  };

  const handleCloseDocument = () => {
    const activeId = useFileStore.getState().currentFileId;
    if (!activeId) return;
    if (useEditorStore.getState().isDirty) {
      setCloseRequestId(activeId);
      return;
    }
    performClose(activeId);
  };

  const handleSaveAndClose = async () => {
    const requestSave = useEditorRefStore.getState().requestSave;
    const saved = requestSave ? await requestSave() : true;
    // Save cancelled (e.g. the location picker was dismissed) — keep the
    // document open so nothing is lost.
    if (!saved) return;
    setCloseRequestId(null);
    performClose();
  };

  const handleDiscardAndClose = () => {
    const targetId = closeRequestId;
    setCloseRequestId(null);
    performClose(targetId);
  };

  return (
    <>
      <header
        data-tauri-drag-region
        data-sidebar-open={hasOpenTarget && isFilesSidebarOpen ? "" : undefined}
        onPointerDownCapture={handleHeaderPointerDownCapture}
        className="desktop-chrome-header relative z-20 grid h-11 shrink-0 items-center text-foreground"
        style={{
          // Column 1 tracks the sidebar width exactly (0 when collapsed) so
          // column 2 is the SAME content region the editor surface uses below —
          // that's what lets the header title share the editor's centered
          // content frame and line up with the document text. The left controls
          // (sidebar toggle / search) and macOS traffic lights float over the
          // top-left as absolute siblings; the centered title clears them on
          // its own, so no width reserve is needed here.
          gridTemplateColumns: "var(--files-sidebar-width, 0px) minmax(0, 1fr)",
        }}
      >
        <div
          className={cn(
            "desktop-chrome-left-controls absolute left-0 top-0 z-10 flex h-full min-w-0 items-center gap-0.5",
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
            <>
              <Tooltip content={isFilesSidebarOpen ? t("hideFiles") : t("showFiles")} side="bottom">
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "desktop-header-button relative z-10 h-7 w-7 rounded-md",
                    // Push the buttons down to sit level with the macOS traffic
                    // lights, whose visual center lands a few px below the
                    // header's natural flex center (see trafficLightPosition).
                    isMacTauri && "top-[5px]"
                  )}
                  onClick={toggleFilesSidebar}
                  aria-label={isFilesSidebarOpen ? t("hideFiles") : t("showFiles")}
                >
                  <PanelLeft className="h-[13px] w-[13px]" />
                </Button>
              </Tooltip>

              {/* Global search — opens the command palette (file names +
                  cross-document content search), same as Cmd/Ctrl+K. */}
              <Tooltip
                content={t("searchTooltip", { shortcut: formatShortcut("Ctrl+K") })}
                side="bottom"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "desktop-header-button relative z-10 h-7 w-7 rounded-md",
                    isMacTauri && "top-[5px]"
                  )}
                  onClick={openCommandPalette}
                  aria-label={t("searchTooltip", { shortcut: formatShortcut("Ctrl+K") })}
                >
                  <Search className="h-[15px] w-[15px]" />
                </Button>
              </Tooltip>
            </>
          )}
        </div>

        <div
          // Intentionally NOT a drag region: when the sidebar is collapsed
          // this column's left edge sits at x=124px, just past the floating
          // sidebar toggle (which ends at ~120px). Tauri's drag.js only
          // inspects e.target, so a drag-region on this wrapper could swallow
          // clicks near that boundary. The inner children below still carry
          // data-tauri-drag-region, so the body of the header remains
          // draggable everywhere they cover.
          className={cn(
            "relative col-start-2 h-full min-w-0",
            hasOpenTarget && isFilesSidebarOpen && "desktop-chrome-content-panel"
          )}
        >
          {tabFiles.length > 0 && (
            <div
              className={cn(
                "absolute right-14 top-0 flex h-full min-w-0 items-end md:right-16",
                isMacTauri && !isFilesSidebarOpen ? "left-[148px]" : "left-2"
              )}
            >
              <div
                className={cn(
                  "flex h-10 min-w-0 items-end gap-1 overflow-x-auto overflow-y-hidden pr-2",
                  isMacTauri && "relative top-[5px]"
                )}
                role="tablist"
              >
                {tabFiles.map((file) => {
                  const isActive = file.id === currentFileId;
                  const displayName = getDisplayName(file.name);
                  return (
                    <div
                      key={file.id}
                      role="tab"
                      tabIndex={0}
                      aria-selected={isActive}
                      title={file.storageHandle?.relPath ?? file.name}
                      onClick={() => handleActivateTab(file.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleActivateTab(file.id);
                        }
                      }}
                      className={cn(
                        "group relative flex h-8 min-w-[132px] max-w-[224px] shrink-0 cursor-default items-center gap-2 rounded-t-md border px-2.5 text-left backdrop-blur-md transition-colors",
                        isActive
                          ? "border-border/80 border-b-background bg-background text-foreground shadow-[0_-1px_0_hsl(var(--foreground)/0.04)_inset]"
                          : "border-transparent bg-background/45 text-muted-foreground hover:bg-background/70 hover:text-foreground"
                      )}
                    >
                      <TabDocumentIcon file={file} />
                      <span className="text-ui-sm min-w-0 flex-1 truncate font-medium">
                        {displayName}
                      </span>
                      {isActive && isSaving ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                      ) : isActive && isDirty ? (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                      ) : null}
                      <span
                        aria-hidden
                        className={cn(
                          "absolute bottom-[-1px] left-0 right-0 h-px",
                          isActive ? "bg-background" : "bg-transparent"
                        )}
                      />
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleCloseTab(file.id);
                        }}
                        aria-label={t("closeDocument")}
                        title={t("closeDocument")}
                        className={cn(
                          "flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground",
                          !isActive && "opacity-0 group-hover:opacity-100"
                        )}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {title && tabFiles.length === 0 && (
            <div
              className={cn(
                "absolute top-0 flex h-full items-center",
                isMacTauri && !isFilesSidebarOpen ? "left-[148px]" : "left-4"
              )}
            >
              <div
                className={cn(
                  "flex h-8 min-w-0 max-w-[min(420px,100%)] cursor-default items-center gap-1.5 rounded-md bg-background/70 pl-2.5 pr-1.5 backdrop-blur-md transition-colors hover:bg-[var(--sidebar-hover)]",
                  isMacTauri && "relative top-[5px]"
                )}
                aria-label={title}
              >
                <span className="text-ui-base min-w-0 truncate font-semibold text-foreground">
                  {title}
                </span>
                {currentFileName && (
                  <button
                    type="button"
                    onClick={handleCloseDocument}
                    aria-label={t("closeDocument")}
                    title={t("closeDocument")}
                    className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Options menu — pinned to the header's far-right corner. */}
          <div className="absolute right-4 top-0 flex h-full items-center md:right-6">
            {currentFileName && (
              <DropdownMenu>
                <Tooltip content={t("moreTooltip")} side="bottom">
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="desktop-header-button h-7 w-7 rounded-md bg-background/70 backdrop-blur-md"
                      aria-label={t("moreActions")}
                    >
                      <MoreHorizontal className="h-[15px] w-[15px]" />
                    </Button>
                  </DropdownMenuTrigger>
                </Tooltip>
                <DropdownMenuContent align="end" className="w-56">
                  {/* Save state lives in the bottom status bar for Markdown;
                        mirrored here because PDF/Excel have no status bar. */}
                  <div className="text-ui-xs flex items-center gap-1.5 px-2 py-1.5 text-muted-foreground">
                    {isSaving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : isDirty ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    ) : (
                      <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-500" />
                    )}
                    <span>{saveLabel}</span>
                  </div>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem
                    onClick={() => window.dispatchEvent(new Event("doxmind:save-now"))}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {t("save")}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatShortcut("Ctrl+S")}
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => toggleAutosave()}>
                    <Check
                      className={cn("mr-2 h-4 w-4", autosaveEnabled ? "opacity-100" : "opacity-0")}
                    />
                    {t("autosave")}
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  {isExcel ? (
                    <DropdownMenuItem onClick={() => handleExport("xlsx")}>
                      <Download className="mr-2 h-4 w-4" />
                      Export as Excel
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Download className="mr-2 h-4 w-4" />
                        {t("export")}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem onClick={() => handleExport("markdown")}>
                          Markdown
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleExport("pdf")}>PDF</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleExport("docx")}>
                          Word
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}

                  <DropdownMenuItem onClick={handleFind}>
                    <Search className="mr-2 h-4 w-4" />
                    {t("find")}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatShortcut("Ctrl+F")}
                    </span>
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Palette className="mr-2 h-4 w-4" />
                      {tSettings("appearance")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-[280px] p-3">
                      <ThemePickerPanel />
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>

                  <DropdownMenuItem onClick={() => setKeyboardShortcutsOpen(true)}>
                    <Keyboard className="mr-2 h-4 w-4" />
                    {t("keyboardShortcuts")}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatShortcut("Ctrl+?")}
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </header>

      <Modal open={!!closeRequestId} onClose={() => setCloseRequestId(null)}>
        <ModalHeader onClose={() => setCloseRequestId(null)}>{t("closeUnsavedTitle")}</ModalHeader>
        <p className="text-sm text-muted-foreground">
          {t("closeUnsavedBody", { name: closeRequestTitle })}
        </p>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setCloseRequestId(null)}>
            {t("cancel")}
          </Button>
          <Button variant="outline" onClick={handleDiscardAndClose}>
            {t("dontSave")}
          </Button>
          <Button onClick={handleSaveAndClose}>{t("save")}</Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
