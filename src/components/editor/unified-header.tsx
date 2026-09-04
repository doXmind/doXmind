"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  Check,
  Copy,
  Download,
  Keyboard,
  Loader2,
  MoreHorizontal,
  Palette,
  PanelLeft,
  Save,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { MENU_PANEL_CLASS, MENU_ROW_CLASS } from "@/components/ui/dropdown-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
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
import { useDesktopShell } from "@/hooks/use-desktop-shell";
import { getDisplayName, isExcelFile, isMarkdownFile, isPdfFile } from "@/lib/document-types";
import { exportMarkdownAsPdf } from "@/lib/markdown-pdf-export";
import { copyPageMarkdownSource } from "@/lib/markdown-source-copy";
import { navigateToEditorFile } from "@/lib/editor-navigation";
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

/** Identifies a tab drag to the panes, which are outside this component. */

export function UnifiedHeader() {
  const isFilesSidebarOpen = useLayoutStore((s) => s.isFilesSidebarOpen);
  const toggleFilesSidebar = useLayoutStore((s) => s.toggleFilesSidebar);
  const toggleSearchBar = useLayoutStore((s) => s.toggleSearchBar);
  const setKeyboardShortcutsOpen = useLayoutStore((s) => s.setKeyboardShortcutsOpen);
  const autosaveEnabled = useLayoutStore((s) => s.autosaveEnabled);
  const toggleAutosave = useLayoutStore((s) => s.toggleAutosave);
  const currentFile = useFileStore((s) =>
    s.currentFileId ? s.files.find((file) => file.id === s.currentFileId) : undefined
  );
  const currentFileId = useFileStore((s) => s.currentFileId);
  const files = useFileStore((s) => s.files);
  const openTabIds = useFileStore((s) => s.openTabIds);
  const reorderTab = useFileStore((s) => s.reorderTab);
  const closeOtherTabs = useFileStore((s) => s.closeOtherTabs);
  const closeAllTabs = useFileStore((s) => s.closeAllTabs);
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
  const isCurrentPage = currentFile ? isMarkdownFile(currentFile) : false;
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

  // In the Electron macOS build the native title bar uses hiddenInset, so the
  // real traffic-light buttons float over
  // the top-left of the WebView. Reserve ~78px of left padding for them and
  // make the header itself a drag region so the window can still be moved.
  const { isDesktop, platform } = useDesktopShell();
  const isMacElectron = isDesktop && platform === "macos";

  const handleExportPdf = async () => {
    const { currentFileId, files } = useFileStore.getState();
    const currentFile = currentFileId ? files.find((file) => file.id === currentFileId) : undefined;
    if (!currentFile) return;

    // Electron renders the Page's live semantic block DOM to PDF locally and
    // writes it only after the user chooses a destination. No printer or server.
    const result = await exportMarkdownAsPdf({
      fileId: currentFile.id,
      fileName: currentFile.name,
    });
    if (result.ok) {
      return;
    }
    if (result.error && result.error !== "cancelled") notify.error(result.error);
  };

  const handleCopyMarkdownSource = async () => {
    const fileId = useFileStore.getState().currentFileId;
    if (!fileId) return;
    try {
      await copyPageMarkdownSource(fileId, t("copyMarkdownSource"));
    } catch (error) {
      notify.error(t("failedToCopyMarkdownSource"), {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const handleFind = () => {
    toggleSearchBar();
  };

  const handleSaveNow = () => {
    const requestSave = useEditorRefStore.getState().requestSave;
    if (!requestSave) return;
    void requestSave().catch(() => notify.error("Could not save Page"));
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

  const [tabMenu, setTabMenu] = useState<{ fileId: string; x: number; y: number } | null>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);

  useEffect(() => {
    if (!tabMenu) return;
    const close = () => setTabMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", close);
    };
  }, [tabMenu]);

  const handleActivateTab = (fileId: string) => {
    if (fileId === currentFileId) return;
    navigateToEditorFile(fileId);
  };

  const handleCloseTab = (fileId: string) => {
    const file = useFileStore.getState().files.find((candidate) => candidate.id === fileId);
    if (
      fileId === currentFileId &&
      file &&
      isMarkdownFile(file) &&
      useEditorStore.getState().isDirty
    ) {
      setCloseRequestId(fileId);
      return;
    }
    performClose(fileId);
  };

  const handleCloseDocument = () => {
    const store = useFileStore.getState();
    const activeId = store.currentFileId;
    if (!activeId) return;
    const activeFile = store.files.find((file) => file.id === activeId);
    if (activeFile && isMarkdownFile(activeFile) && useEditorStore.getState().isDirty) {
      setCloseRequestId(activeId);
      return;
    }
    performClose(activeId);
  };

  const handleSaveAndClose = async () => {
    const targetId = closeRequestId;
    if (!targetId) return;
    // By Page, not by pane: the tab being closed may be the other pane's, and the mirrored
    // handle would save the Page the user is looking at instead.
    const requestSaveFor = useEditorRefStore.getState().requestSaveFor;
    let saved = false;
    try {
      saved = await requestSaveFor(targetId);
    } catch {
      notify.error("Could not save Page");
      return;
    }
    // Save cancelled (e.g. the location picker was dismissed) — keep the
    // document open so nothing is lost.
    if (!saved) return;
    setCloseRequestId(null);
    performClose(targetId);
  };

  const handleDiscardAndClose = () => {
    const targetId = closeRequestId;
    if (!targetId) return;
    useEditorRefStore.getState().discardPendingChangesFor(targetId);
    setCloseRequestId(null);
    performClose(targetId);
  };

  return (
    <>
      <header
        data-window-drag-region
        data-sidebar-open={hasOpenTarget && isFilesSidebarOpen ? "" : undefined}
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
            !isMacElectron && "pl-3"
          )}
        >
          {isMacElectron && (
            <>
              {/* Two drag strips that physically avoid the macOS traffic-light
                  cluster (12px dots centred at y=22 with the header's own
                  buttons, so y=16..28). These siblings restore window-drag
                  for the empty space around the buttons without ever sitting
                  on top of the close/min/max controls. */}
              <span
                data-window-drag-region
                aria-hidden
                className="pointer-events-auto absolute inset-x-0 top-0 h-4"
              />
              <span
                data-window-drag-region
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
                  // No top offset: `trafficLightPosition` (electron/main.js) is
                  // already set from the assumption that these buttons sit on
                  // the header's own centre line. Nudging them down 5px put
                  // every control in the bar 5px below that centre instead.
                  className="desktop-header-button relative z-10 h-7 w-7 rounded-md"
                  onClick={toggleFilesSidebar}
                  aria-label={isFilesSidebarOpen ? t("hideFiles") : t("showFiles")}
                >
                  <PanelLeft className="h-4 w-4" />
                </Button>
              </Tooltip>
            </>
          )}
        </div>

        <div
          // Intentionally NOT a drag region: when the sidebar is collapsed
          // this column's left edge sits at x=124px, just past the floating
          // sidebar toggle (which ends at ~120px). Interactive descendants
          // explicitly opt out of Electron's CSS drag region.
          className={cn(
            "relative col-start-2 h-full min-w-0",
            hasOpenTarget && isFilesSidebarOpen && "desktop-chrome-content-panel"
          )}
        >
          {tabFiles.length > 0 && (
            <div
              className={cn(
                "absolute right-14 top-0 flex h-full min-w-0 items-end md:right-16",
                isMacElectron && !isFilesSidebarOpen ? "left-[148px]" : "left-2"
              )}
            >
              <div
                className={cn(
                  "flex h-10 min-w-0 items-end gap-1 overflow-x-auto overflow-y-hidden pr-2",
                  // 4px, not 5: the tabs hang below the 44px header on purpose
                  // so the active one merges into the page, but at 5px their
                  // bottom edge landed at y=49 and covered the first pixel of
                  // the Page-properties row, whose top is y=48.
                  isMacElectron && "relative top-1"
                )}
                role="tablist"
                data-no-drag
              >
                {tabFiles.map((file) => {
                  const isActive = file.id === currentFileId;
                  const isPage = isMarkdownFile(file);
                  const displayName = getDisplayName(file.name);
                  return (
                    <div
                      key={file.id}
                      role="tab"
                      tabIndex={0}
                      aria-selected={isActive}
                      data-no-drag
                      title={file.storageHandle?.relPath ?? file.name}
                      // Dragging within the bar reorders. Dropped anywhere else the drag is
                      // simply abandoned.
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        setDraggingTabId(file.id);
                      }}
                      onDragEnd={() => setDraggingTabId(null)}
                      onDragOver={(event) => {
                        if (!draggingTabId || draggingTabId === file.id) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(event) => {
                        if (!draggingTabId || draggingTabId === file.id) return;
                        event.preventDefault();
                        reorderTab(
                          draggingTabId,
                          tabFiles.findIndex((t) => t.id === file.id)
                        );
                        setDraggingTabId(null);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setTabMenu({ fileId: file.id, x: event.clientX, y: event.clientY });
                      }}
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
                      {isActive && isPage && isSaving ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                      ) : isActive && isPage && isDirty ? (
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
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tabMenu &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                role="menu"
                aria-label={t("tabActions")}
                style={{ position: "fixed", top: tabMenu.y, left: tabMenu.x }}
                className={`z-50 min-w-[180px] ${MENU_PANEL_CLASS}`}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  role="menuitem"
                  className={MENU_ROW_CLASS}
                  onClick={() => {
                    handleCloseTab(tabMenu.fileId);
                    setTabMenu(null);
                  }}
                >
                  {t("closeTab")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={MENU_ROW_CLASS}
                  onClick={() => {
                    closeOtherTabs(tabMenu.fileId);
                    setTabMenu(null);
                  }}
                >
                  {t("closeOtherTabs")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={MENU_ROW_CLASS}
                  onClick={() => {
                    closeAllTabs();
                    setTabMenu(null);
                  }}
                >
                  {t("closeAllTabs")}
                </button>
              </div>,
              document.body
            )}
          {title && tabFiles.length === 0 && (
            <div
              className={cn(
                "absolute top-0 flex h-full items-center",
                isMacElectron && !isFilesSidebarOpen ? "left-[148px]" : "left-4"
              )}
            >
              <div
                className={cn(
                  "flex h-8 min-w-0 max-w-[min(420px,100%)] cursor-default items-center gap-1.5 rounded-md bg-background/70 pl-2.5 pr-1.5 backdrop-blur-md transition-colors hover:bg-[var(--sidebar-hover)]",
                  // Same 4px as the tab strip this slot alternates with.
                  isMacElectron && "relative top-1"
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
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Options menu — pinned to the header's far-right corner, on the
              one 16px chrome inset the outline rail and the word count use. */}
          <div className="absolute right-4 top-0 flex h-full items-center">
            {currentFileName && isCurrentPage && (
              <DropdownMenu>
                <Tooltip content={t("moreTooltip")} side="bottom">
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="desktop-header-button relative h-7 w-7 rounded-md bg-background/70 backdrop-blur-md"
                      aria-label={t("moreActions")}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </Tooltip>
                <DropdownMenuContent align="end" className="w-56">
                  {/* Save state lives in the bottom status bar for Markdown;
                        mirrored here because PDF/Excel have no status bar. */}
                  <div className="text-ui-xs flex items-center gap-1.5 px-2 py-1.5 text-muted-foreground">
                    {isSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isDirty ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    ) : (
                      <Check className="h-4 w-4 text-green-600 dark:text-green-500" />
                    )}
                    <span>{saveLabel}</span>
                  </div>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem onClick={handleSaveNow}>
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

                  {isDesktop && (
                    <DropdownMenuItem onClick={() => void handleCopyMarkdownSource()}>
                      <Copy className="mr-2 h-4 w-4" />
                      {t("copyMarkdownSource")}
                    </DropdownMenuItem>
                  )}

                  <DropdownMenuItem onClick={() => void handleExportPdf()}>
                    <Download className="mr-2 h-4 w-4" />
                    {t("exportAsPDF")}
                  </DropdownMenuItem>

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
