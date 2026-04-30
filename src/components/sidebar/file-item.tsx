"use client";

import {
  Archive,
  FileText,
  MoreHorizontal,
  Check,
  X,
  CheckSquare,
  Square,
  Pin,
  PinOff,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { useFileStore, type FileItem as FileItemType } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { api } from "@/lib/api";
import { storeLogger } from "@/lib/logger";
import { FileActionsMenuItems, getMenuItemCount } from "@/components/sidebar/file-actions-menu";

const log = storeLogger.child("FileItem");

interface FileItemProps {
  file: FileItemType;
  indent?: boolean;
}

// Store last clicked file ID for range selection (outside component to persist across renders)
let lastClickedFileId: string | null = null;

export function FileItem({ file, indent: _indent = false }: FileItemProps) {
  const router = useRouter();
  const t = useTranslations("sidebar");
  // Fine-grained selectors — each FileItem only re-renders when its relevant state changes
  const currentFileId = useFileStore((s) => s.currentFileId);
  const setCurrentFile = useFileStore((s) => s.setCurrentFile);
  const deleteFile = useFileStore((s) => s.deleteFile);
  const renameFile = useFileStore((s) => s.renameFile);
  const moveFileToFolder = useFileStore((s) => s.moveFileToFolder);
  const toggleFavorite = useFileStore((s) => s.toggleFavorite);
  const workspaceMode = useFileStore((s) => s.workspaceMode);
  const justCreatedFileId = useFileStore((s) => s.justCreatedFileId);
  const clearJustCreatedFileId = useFileStore((s) => s.clearJustCreatedFileId);
  const selectedFileIds = useFileStore((s) => s.selectedFileIds);
  const toggleFileSelection = useFileStore((s) => s.toggleFileSelection);
  const selectFileRange = useFileStore((s) => s.selectFileRange);
  const clearSelection = useFileStore((s) => s.clearSelection);
  const [isRenaming, setIsRenaming] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [contextMenuFocusIndex, setContextMenuFocusIndex] = useState(-1);
  const [contextMenuReady, setContextMenuReady] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  // Remove .md extension for editing
  const getNameWithoutExtension = (name: string) => name.replace(/\.md$/, "");
  const [newName, setNewName] = useState(getNameWithoutExtension(file.name));

  const isActive = currentFileId === file.id;
  const isSelected = selectedFileIds.has(file.id);
  const isSelectionMode = selectedFileIds.size > 0;

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
          // Indices: 0=Rename, 1=Favorite, [2=MoveToRoot], 2+offset..4+offset=Export, 5+offset=Delete
          if (contextMenuFocusIndex === 0) {
            setContextMenu(null);
            setContextMenuFocusIndex(-1);
            setNewName(getNameWithoutExtension(file.name));
            setIsRenaming(true);
          } else if (contextMenuFocusIndex === 1) {
            setContextMenu(null);
            setContextMenuFocusIndex(-1);
            toggleFavorite(file.id);
          } else if (contextMenuFocusIndex === 2 && file.parentId) {
            // Move to Root (only when file is in a folder)
            setContextMenu(null);
            setContextMenuFocusIndex(-1);
            moveFileToFolder(file.id, null)
              .then(() => {
                toast.success(t("movedToRoot"));
              })
              .catch((error) => {
                log.error("Failed to move file to root", error);
                toast.error(t("failedToMove"));
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
      if (selectedFileIds.size > 0) {
        clearSelection();
      }
      setCurrentFile(file.id);
      lastClickedFileId = file.id;

      // Auto-close mobile sidebar to prevent competing renders
      // between the overlay and the editor content updating underneath
      if (useLayoutStore.getState().isMobileSidebarOpen) {
        useLayoutStore.getState().setMobileSidebarOpen(false);
      }
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
    const fullName = trimmedName ? `${trimmedName}.md` : "";
    if (trimmedName && fullName !== file.name) {
      try {
        await renameFile(file.id, fullName);
      } catch (error) {
        log.error("Failed to rename file", error);
        toast.error(t("failedToRename"));
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

  const { restoreFile } = useFileStore();

  const handleDelete = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const fileName = getNameWithoutExtension(file.name);
    try {
      await deleteFile(file.id);
      // Navigate to the next file or welcome screen after deletion
      const nextId = useFileStore.getState().currentFileId;
      router.push(nextId ? `/editor/${nextId}` : "/editor");
      toast(`"${fileName}" moved to trash`, {
        action: {
          label: t("restore"),
          onClick: async () => {
            try {
              await restoreFile(file.id);
              toast.success(t("restoredName", { name: fileName }));
            } catch {
              toast.error(t("failedToRestore"));
            }
          },
        },
        duration: 6000,
      });
    } catch (error) {
      log.error("Failed to delete file", error);
      toast.error(t("failedToDelete"));
    }
  };

  const handleExport = (format: "markdown" | "pdf" | "docx") => {
    const formatLabel = format === "markdown" ? "Markdown" : format.toUpperCase();

    if (workspaceMode === "disk") {
      if (format !== "markdown") {
        toast.error(t("diskExportOnlyMarkdown"));
        return;
      }

      toast.promise(
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
      return;
    }

    toast.promise(
      api.exportFile(file.id, format).then((blob) => {
        const baseName = getNameWithoutExtension(file.name);
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

  const handleContextMenuToggleFavorite = () => {
    setContextMenu(null);
    toggleFavorite(file.id);
  };

  const handleContextMenuMoveToRoot = async () => {
    setContextMenu(null);
    try {
      await moveFileToFolder(file.id, null);
      toast.success(t("movedToRoot"));
    } catch (error) {
      log.error("Failed to move file to root", error);
      toast.error(t("failedToMove"));
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
          ? "bg-primary/10 ring-1 ring-primary/25 dark:bg-primary/20"
          : isActive
            ? "bg-[var(--sidebar-active)] text-foreground shadow-[var(--sidebar-active-shadow)] ring-1 ring-[var(--sidebar-active-border)]"
            : "text-foreground/90 hover:bg-[var(--sidebar-hover)]"
      )}
    >
      {!isRenaming && !isSelectionMode && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(file.id);
          }}
          className="sidebar-action-button absolute left-1.5 top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md opacity-0 transition-opacity focus-visible:opacity-100 md:flex md:group-hover/file:opacity-100"
          aria-label={file.isFavorite ? t("removeFromFavorites") : t("addToFavorites")}
          title={file.isFavorite ? t("removeFromFavorites") : t("addToFavorites")}
        >
          {file.isFavorite ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        </button>
      )}

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

      <div
        className={cn(
          "relative flex h-5 w-5 flex-shrink-0 items-center justify-center transition-opacity",
          !isRenaming && !isSelectionMode && "md:group-hover/file:opacity-0"
        )}
      >
        {file.icon ? (
          <span className="flex h-5 w-5 items-center justify-center text-sm md:text-xs">
            {file.icon}
          </span>
        ) : (
          <FileText className="h-5 w-5 text-muted-foreground/70 md:h-[18px] md:w-[18px]" />
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
          <div className="flex min-w-0 items-center gap-2">
            <p
              className={cn(
                "text-ui-base min-w-0 flex-1 truncate leading-5",
                isActive ? "font-semibold" : "font-medium"
              )}
            >
              {getNameWithoutExtension(file.name)}
            </p>
            {file.isFavorite && (
              <Pin className="h-3 w-3 flex-shrink-0 fill-muted-foreground/50 text-muted-foreground/50" />
            )}
          </div>
        )}
      </div>

      {!isRenaming && (
        <span
          aria-hidden
          className="text-ui-xs pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-semibold text-muted-foreground/75 transition-opacity md:group-hover/file:opacity-0"
        >
          {getRelativeTimeLabel(file.updatedAt)}
        </span>
      )}

      {!isRenaming && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleDelete(e);
          }}
          className="sidebar-action-button absolute right-1.5 top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md opacity-0 transition-opacity focus-visible:opacity-100 md:flex md:group-hover/file:opacity-100"
          aria-label={t("moveToTrash")}
          title={t("moveToTrash")}
        >
          <Archive className="h-3.5 w-3.5" />
        </button>
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
              isFavorite={!!file.isFavorite}
              hasParent={!!file.parentId}
              onRename={() => {
                setNewName(getNameWithoutExtension(file.name));
                setIsRenaming(true);
              }}
              onToggleFavorite={() => toggleFavorite(file.id)}
              onMoveToRoot={async () => {
                try {
                  await moveFileToFolder(file.id, null);
                  toast.success(t("movedToRoot"));
                } catch (error) {
                  log.error("Failed to move file to root", error);
                  toast.error(t("failedToMove"));
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
              isFavorite={!!file.isFavorite}
              hasParent={!!file.parentId}
              focusIndex={contextMenuFocusIndex}
              onFocusIndex={setContextMenuFocusIndex}
              contextMenuReady={contextMenuReady}
              onRename={handleContextMenuRename}
              onToggleFavorite={handleContextMenuToggleFavorite}
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
