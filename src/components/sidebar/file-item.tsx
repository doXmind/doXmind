"use client";

import { MoreHorizontal, Check, X, CheckSquare, Square } from "lucide-react";
import {
  CsvGlyph,
  MarkdownGlyph,
  PdfGlyph,
  SpreadsheetGlyph,
} from "@/components/icons/document-glyphs";
import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { notify } from "@/lib/notifications";
import { cn, getErrorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { useFileStore, type FileItem as FileItemType } from "@/stores/file-store";
import { storeLogger } from "@/lib/logger";
import { navigateToEditorFile } from "@/lib/editor-navigation";
import { FileActionsMenuItems, getMenuItemCount } from "@/components/sidebar/file-actions-menu";
import {
  getDisplayName,
  isExcelFile,
  isPdfFile,
  withOriginalExtension,
} from "@/lib/document-types";
import { revealFileInFinder } from "@/lib/storage/reveal";
import { exportMarkdownAsPdf } from "@/lib/markdown-pdf-export";

const log = storeLogger.child("FileItem");
const getNameWithoutExtension = getDisplayName;

interface FileItemProps {
  file: FileItemType;
  indent?: boolean;
}

// Store last clicked file ID for range selection (outside component to persist across renders)
let lastClickedFileId: string | null = null;

export function FileItem({ file, indent: _indent = false }: FileItemProps) {
  const t = useTranslations("sidebar");
  // Fine-grained selectors — each FileItem only re-renders when its relevant state changes
  const isActive = useFileStore((s) => s.currentFileId === file.id);
  const setCurrentFile = useFileStore((s) => s.setCurrentFile);
  const deleteFile = useFileStore((s) => s.deleteFile);
  const renameFile = useFileStore((s) => s.renameFile);
  const moveFileToFolder = useFileStore((s) => s.moveFileToFolder);
  const justCreatedFileId = useFileStore((s) => s.justCreatedFileId);
  const clearJustCreatedFileId = useFileStore((s) => s.clearJustCreatedFileId);
  const isSelected = useFileStore((s) => s.selectedFileIds.has(file.id));
  const isSelectionMode = useFileStore((s) => s.selectedFileIds.size > 0);
  const toggleFileSelection = useFileStore((s) => s.toggleFileSelection);
  const selectFileRange = useFileStore((s) => s.selectFileRange);
  const clearSelection = useFileStore((s) => s.clearSelection);
  const [isRenaming, setIsRenaming] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [contextMenuFocusIndex, setContextMenuFocusIndex] = useState(-1);
  const [contextMenuReady, setContextMenuReady] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [newName, setNewName] = useState(getNameWithoutExtension(file.name));

  // Close context menu when clicking outside
  useEffect(() => {
    if (!contextMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
        setContextMenuFocusIndex(-1);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const itemCount = getMenuItemCount(!!file.parentId);
      const exportOffset = file.parentId ? 1 : 0; // Shift export items if "Move to Root" is present
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          setContextMenu(null);
          setContextMenuFocusIndex(-1);
          break;
        case "ArrowDown":
          e.preventDefault();
          setContextMenuFocusIndex((prev) => (prev < itemCount - 1 ? prev + 1 : 0));
          break;
        case "ArrowUp":
          e.preventDefault();
          setContextMenuFocusIndex((prev) => (prev > 0 ? prev - 1 : itemCount - 1));
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          // Execute the action based on focused index
          // Indices: 0=Rename, 1=Reveal, [2=MoveToRoot], 2+offset..4+offset=Export, 5+offset=Delete
          if (contextMenuFocusIndex === 0) {
            setContextMenu(null);
            setContextMenuFocusIndex(-1);
            setNewName(getNameWithoutExtension(file.name));
            setIsRenaming(true);
          } else if (contextMenuFocusIndex === 1) {
            setContextMenu(null);
            setContextMenuFocusIndex(-1);
            revealFileInFinder(file).catch((error) => {
              log.error("Failed to reveal file in Finder", error);
              const { title, description } = getErrorMessage(error);
              notify.error(title, { description });
            });
          } else if (contextMenuFocusIndex === 2 && file.parentId) {
            // Move to Root (only when file is in a folder)
            setContextMenu(null);
            setContextMenuFocusIndex(-1);
            moveFileToFolder(file.id, null).catch((error) => {
              log.error("Failed to move file to root", error);
              notify.error(t("failedToMove"));
            });
          } else if (contextMenuFocusIndex === 2 + exportOffset) {
            setContextMenu(null);
            setContextMenuFocusIndex(-1);
            handleExport("markdown");
          } else if (contextMenuFocusIndex === 3 + exportOffset) {
            setContextMenu(null);
            setContextMenuFocusIndex(-1);
            handleExport("pdf");
          } else if (contextMenuFocusIndex === 4 + exportOffset) {
            setContextMenu(null);
            setContextMenuFocusIndex(-1);
            handleExport("docx");
          } else if (contextMenuFocusIndex === 5 + exportOffset) {
            setContextMenu(null);
            setContextMenuFocusIndex(-1);
            handleDelete();
          }
          break;
        case "Home":
          e.preventDefault();
          setContextMenuFocusIndex(0);
          break;
        case "End":
          e.preventDefault();
          setContextMenuFocusIndex(itemCount - 1);
          break;
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- file.name and handleExport are stable within render
  }, [contextMenu, contextMenuFocusIndex]);

  // Handle right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Calculate position with viewport boundary check
    const menuWidth = 180;
    const menuHeight = 220;
    let x = e.clientX;
    let y = e.clientY;

    if (x + menuWidth > window.innerWidth - 10) {
      x = window.innerWidth - menuWidth - 10;
    }
    if (y + menuHeight > window.innerHeight - 10) {
      y = window.innerHeight - menuHeight - 10;
    }

    setContextMenu({ x, y });
    setContextMenuFocusIndex(-1); // Reset focus when opening
    setContextMenuReady(false); // Disable hover effects initially
    // Enable hover effects after a short delay to prevent auto-highlight
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setContextMenuReady(true);
      });
    });
  }, []);

  const handleClick = (e?: React.MouseEvent) => {
    if (isRenaming) return;

    // Multi-select: Ctrl+click toggles selection, Shift+click selects range
    if (e?.ctrlKey || e?.metaKey) {
      toggleFileSelection(file.id);
      lastClickedFileId = file.id;
    } else if (e?.shiftKey && lastClickedFileId) {
      selectFileRange(lastClickedFileId, file.id);
    } else {
      // Normal click: clear selection if any, then set as current file.
      // Only call setCurrentFile — useFileUrlSync's Store→URL effect handles
      // the URL update. Calling both setCurrentFile + router.push caused
      // duplicate navigations and page remounts.
      if (isSelectionMode) {
        clearSelection();
      }
      setCurrentFile(file.id);
      lastClickedFileId = file.id;
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNewName(getNameWithoutExtension(file.name));
    setIsRenaming(true);
  };

  // Auto-enter rename mode for newly created files
  useEffect(() => {
    if (file.id === justCreatedFileId) {
      setNewName(getNameWithoutExtension(file.name));
      setIsRenaming(true);
      clearJustCreatedFileId();
    }
  }, [file.id, justCreatedFileId, file.name, clearJustCreatedFileId]);

  // Drag handler for moving files to folders
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", file.id);
  };

  const handleRename = async () => {
    const trimmedName = newName.trim();
    const fullName = trimmedName ? withOriginalExtension(file.name, trimmedName) : "";
    if (trimmedName && fullName !== file.name) {
      try {
        await renameFile(file.id, fullName);
      } catch (error) {
        log.error("Failed to rename file", error);
        notify.error(t("failedToRename"));
      }
    }
    setIsRenaming(false);
  };

  const cancelRename = () => {
    setNewName(getNameWithoutExtension(file.name));
    setIsRenaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRename();
    } else if (e.key === "Escape") {
      cancelRename();
    }
  };

  const handleDelete = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await deleteFile(file.id);
      // Navigate to the next file or welcome screen after deletion
      const nextId = useFileStore.getState().currentFileId;
      navigateToEditorFile(nextId);
      // Recovery path: Settings → Trash. Notion-style: silence on the happy
      // path; the file vanishing from the sidebar is itself the feedback.
    } catch (error) {
      log.error("Failed to delete file", error);
      notify.error(t("failedToDelete"));
    }
  };

  const handleExport = (format: "markdown" | "pdf" | "docx") => {
    const formatLabel = format === "markdown" ? "Markdown" : format.toUpperCase();

    // PDF: route through the print pipeline. The orchestrator handles
    // navigating to this file (if it isn't already active), waiting for
    // the editor to mount + render, mermaid light re-render, and
    // restoring the user's previous navigation when done.
    if (format === "pdf") {
      const progressId = notify.startProgress(t("exportingAs", { format: formatLabel }));
      void (async () => {
        try {
          const result = await exportMarkdownAsPdf({
            fileId: file.id,
            fileName: file.name,
          });
          notify.resolveProgress(progressId);
          if (!result.ok && result.error && result.error !== "cancelled") {
            notify.error(t("failedToExport", { format: formatLabel }));
          }
        } catch (err) {
          notify.failProgress(progressId);
          log.error("Failed to export PDF", err);
          notify.error(t("failedToExport", { format: formatLabel }));
        }
      })();
      return;
    }

    if (format !== "markdown") {
      notify.error(t("diskExportOnlyMarkdown"));
      return;
    }

    void notify.promise(
      (async () => {
        const store = useFileStore.getState();
        await store.loadFileContent(file.id, { force: true });
        const latest = useFileStore.getState().getFile(file.id) ?? file;
        const markdown = latest.contentMarkdown ?? latest.content ?? "";
        const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
        const filename = `${getNameWithoutExtension(latest.name)}.md`;

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })(),
      {
        loading: t("exportingAs", { format: formatLabel }),
        success: t("exportedAs", { format: formatLabel }),
        error: t("failedToExport", { format: formatLabel }),
      }
    );
  };

  // Context menu action handlers (close menu, then execute)
  const handleContextMenuRename = () => {
    setContextMenu(null);
    setNewName(getNameWithoutExtension(file.name));
    setIsRenaming(true);
  };

  const handleContextMenuRevealInFinder = async () => {
    setContextMenu(null);
    try {
      await revealFileInFinder(file);
    } catch (error) {
      log.error("Failed to reveal file in Finder", error);
      const { title, description } = getErrorMessage(error);
      notify.error(title, { description });
    }
  };

  const handleContextMenuMoveToRoot = async () => {
    setContextMenu(null);
    try {
      await moveFileToFolder(file.id, null);
    } catch (error) {
      log.error("Failed to move file to root", error);
      notify.error(t("failedToMove"));
    }
  };

  const handleContextMenuDelete = () => {
    setContextMenu(null);
    handleDelete();
  };

  const handleContextMenuExport = (format: "markdown" | "pdf" | "docx") => {
    setContextMenu(null);
    handleExport(format);
  };

  return (
    <div
      draggable={!isRenaming && !isSelectionMode}
      onDragStart={handleDragStart}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      className={cn(
        "group/file relative flex cursor-pointer items-center gap-2 overflow-hidden rounded-lg px-3 py-2.5 transition-colors duration-150 ease-out md:h-7 md:px-2.5 md:py-1",
        "select-none active:scale-[0.98] md:active:scale-100", // Touch feedback on mobile, prevent text selection
        isSelected
          ? "bg-primary/10 dark:bg-primary/20"
          : isActive
            ? "bg-[var(--sidebar-active)] text-foreground"
            : "text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover)]"
      )}
    >
      {/* Checkbox for multi-select */}
      {(isSelectionMode || isSelected) && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleFileSelection(file.id);
          }}
          className="flex-shrink-0"
          aria-label={isSelected ? t("deselectFile") : t("selectFile")}
        >
          {isSelected ? (
            <CheckSquare className="h-5 w-5 text-primary md:h-4 md:w-4" />
          ) : (
            <Square className="h-5 w-5 text-muted-foreground md:h-4 md:w-4" />
          )}
        </button>
      )}

      <div className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center">
        {file.icon ? (
          <span className="flex h-5 w-5 items-center justify-center text-sm md:text-xs">
            {file.icon}
          </span>
        ) : isPdfFile(file) ? (
          <PdfGlyph className="h-5 w-5 md:h-[18px] md:w-[18px]" />
        ) : isExcelFile(file) ? (
          <SpreadsheetGlyph className="h-5 w-5 md:h-[18px] md:w-[18px]" />
        ) : /\.csv$/i.test(file.name) ? (
          <CsvGlyph className="h-5 w-5 md:h-[18px] md:w-[18px]" />
        ) : (
          <MarkdownGlyph className="h-5 w-5 text-[var(--sidebar-icon)] md:h-[18px] md:w-[18px]" />
        )}
      </div>

      <div className={cn("min-w-0 flex-1", !isRenaming && "pr-12")}>
        {isRenaming ? (
          <div className="flex items-center gap-1">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={handleRename}
              onKeyDown={handleKeyDown}
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.stopPropagation()}
              className="h-8 flex-1 px-2 py-0 text-base md:h-6 md:px-1 md:text-sm"
              autoFocus
            />
            <button
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent blur before click fires
                handleRename();
              }}
              className="flex-shrink-0 rounded p-0.5 hover:bg-accent"
              aria-label={t("confirmRename")}
            >
              <Check className="h-4 w-4 text-primary" />
            </button>
            <button
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent blur before click fires
                cancelRename();
              }}
              className="flex-shrink-0 rounded p-0.5 hover:bg-accent"
              aria-label={t("cancelRename")}
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        ) : (
          <p
            className={cn(
              "text-ui-base min-w-0 truncate leading-5",
              isActive ? "font-semibold" : "font-medium"
            )}
          >
            {getNameWithoutExtension(file.name)}
          </p>
        )}
      </div>

      {!isRenaming && (
        <span
          aria-hidden
          className="text-ui-xs pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-semibold text-[var(--sidebar-muted)]"
        >
          {getRelativeTimeLabel(file.updatedAt)}
        </span>
      )}

      {/* Actions - Always visible on mobile via menu button */}
      <div
        className="flex items-center transition-opacity md:hidden"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <Tooltip content={t("fileOptions")} side="right">
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 md:h-8 md:w-8"
                aria-label={t("fileOptions")}
              >
                <MoreHorizontal className="h-5 w-5 md:h-4 md:w-4" />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="end">
            <FileActionsMenuItems
              variant="dropdown"
              hasParent={!!file.parentId}
              onRename={() => {
                setNewName(getNameWithoutExtension(file.name));
                setIsRenaming(true);
              }}
              onRevealInFinder={async () => {
                try {
                  await revealFileInFinder(file);
                } catch (error) {
                  log.error("Failed to reveal file in Finder", error);
                  const { title, description } = getErrorMessage(error);
                  notify.error(title, { description });
                }
              }}
              onMoveToRoot={async () => {
                try {
                  await moveFileToFolder(file.id, null);
                } catch (error) {
                  log.error("Failed to move file to root", error);
                  notify.error(t("failedToMove"));
                }
              }}
              onExport={handleExport}
              onDelete={handleDelete}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Right-click Context Menu */}
      {contextMenu &&
        createPortal(
          <div
            ref={contextMenuRef}
            role="menu"
            aria-label="File actions"
            style={{
              position: "fixed",
              top: contextMenu.y,
              left: contextMenu.x,
            }}
            className="animate-in fade-in-0 zoom-in-95 z-50 min-w-[180px] overflow-hidden rounded-md border border-border bg-popover p-1 shadow-lg"
          >
            <FileActionsMenuItems
              variant="context"
              hasParent={!!file.parentId}
              focusIndex={contextMenuFocusIndex}
              onFocusIndex={setContextMenuFocusIndex}
              contextMenuReady={contextMenuReady}
              onRename={handleContextMenuRename}
              onRevealInFinder={handleContextMenuRevealInFinder}
              onMoveToRoot={handleContextMenuMoveToRoot}
              onExport={handleContextMenuExport}
              onDelete={handleContextMenuDelete}
            />
          </div>,
          document.body
        )}
    </div>
  );
}

function getRelativeTimeLabel(date: string) {
  const now = new Date();
  const d = new Date(date);
  const diff = Math.max(0, now.getTime() - d.getTime());
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;

  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}
