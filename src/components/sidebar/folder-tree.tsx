"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Check,
  X,
  Trash2,
  Pencil,
  MoreHorizontal,
  Loader2,
  FileText,
  Star,
  Share2,
} from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { FileItem } from "./file-item";
import { ShareDialog } from "@/components/share/share-dialog";
import { useFileStore } from "@/stores/file-store";
import type { FileItem as FileItemType } from "@/types";
import { toast } from "sonner";
import { getErrorMessage, cn, formatDate } from "@/lib/utils";
import { storeLogger } from "@/lib/logger";

const log = storeLogger.child("FolderTree");

export function FolderTree() {
  const t = useTranslations("sidebar");

  // Fine-grained selectors — actions are stable refs, state values subscribed individually
  const files = useFileStore((s) => s.files);
  const currentFolderId = useFileStore((s) => s.currentFolderId);
  const getFolders = useFileStore((s) => s.getFolders);
  const getFilesInFolder = useFileStore((s) => s.getFilesInFolder);
  const getSubPages = useFileStore((s) => s.getSubPages);
  const getFavorites = useFileStore((s) => s.getFavorites);
  const getFolderAncestors = useFileStore((s) => s.getFolderAncestors);
  const setCurrentFolder = useFileStore((s) => s.setCurrentFolder);
  const moveFileToFolder = useFileStore((s) => s.moveFileToFolder);
  const renameFile = useFileStore((s) => s.renameFile);
  const deleteFile = useFileStore((s) => s.deleteFile);
  const restoreFile = useFileStore((s) => s.restoreFile);
  const importFile = useFileStore((s) => s.importFile);
  const justCreatedFileId = useFileStore((s) => s.justCreatedFileId);
  const clearJustCreatedFileId = useFileStore((s) => s.clearJustCreatedFileId);
  const [favoritesExpanded, setFavoritesExpanded] = useState(true);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [isDraggingOverEmptyFolder, setIsDraggingOverEmptyFolder] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renamingFolderName, setRenamingFolderName] = useState("");
  const [shareFolderId, setShareFolderId] = useState<string | null>(null);
  const [shareFolderName, setShareFolderName] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; folderId: string } | null>(
    null
  );
  const [contextMenuFocusIndex, setContextMenuFocusIndex] = useState(-1);
  const [contextMenuReady, setContextMenuReady] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Memoize derived data — recomputed only when files or currentFolderId change.
  // `files` is intentionally in deps as a change signal even though getFolders/etc.
  // read it internally (ESLint can't see through the store method indirection).
  const viewFolders = useMemo(
    () => (currentFolderId ? getFolders(currentFolderId) : getFolders(null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- files triggers recomputation
    [files, currentFolderId, getFolders]
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- files triggers recomputation
  const rootFiles = useMemo(() => getFilesInFolder(null), [files, getFilesInFolder]);
  const currentFolder = useMemo(
    () => (currentFolderId ? files.find((f) => f.id === currentFolderId) : null),
    [files, currentFolderId]
  );
  const breadcrumbAncestors = useMemo(
    () => (currentFolderId ? getFolderAncestors(currentFolderId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- files triggers recomputation
    [currentFolderId, getFolderAncestors, files]
  );
  const allFolders = useMemo(() => files.filter((f) => f.isFolder), [files]);

  // Drag and drop handlers for folders
  const handleDragOver = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDragOverFolderId(folderId);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolderId(null);
  };

  const handleDrop = async (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolderId(null);
    setIsDraggingOverEmptyFolder(false);

    // Check if dropping external files (from computer)
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles && droppedFiles.length > 0) {
      // Import external files
      const fileCount = droppedFiles.length;

      setIsImporting(true);
      setImportProgress({ current: 0, total: fileCount });

      let failCount = 0;

      for (let i = 0; i < fileCount; i++) {
        const file = droppedFiles[i];
        setImportProgress({ current: i + 1, total: fileCount });

        try {
          await importFile(file, folderId);
        } catch (error) {
          failCount++;
          log.error("Failed to import file", error);
        }
      }

      setIsImporting(false);
      setImportProgress({ current: 0, total: 0 });

      // Only show toast for errors
      if (failCount > 0) {
        toast.error(t("failedToImportCount", { count: failCount }));
      }

      return;
    }

    // Otherwise, handle internal file move
    const draggedFileId = e.dataTransfer.getData("text/plain");
    if (draggedFileId && draggedFileId !== folderId) {
      try {
        await moveFileToFolder(draggedFileId, folderId);
        toast.success(folderId ? t("movedToFolder") : t("movedToRoot"));
      } catch (error) {
        log.error("Failed to move file", error);
        toast.error(t("failedToMove"));
      }
    }
  };

  // Folder rename handlers
  const handleFolderRename = async () => {
    if (!renamingFolderId || !renamingFolderName.trim()) {
      setRenamingFolderId(null);
      setRenamingFolderName("");
      return;
    }

    try {
      await renameFile(renamingFolderId, renamingFolderName.trim());
      toast.success(t("folderRenamed"));
    } catch (error) {
      log.error("Failed to rename folder", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }

    setRenamingFolderId(null);
    setRenamingFolderName("");
  };

  const cancelFolderRename = () => {
    setRenamingFolderId(null);
    setRenamingFolderName("");
  };

  // Auto-enter rename mode for newly created folders
  useEffect(() => {
    const folder = allFolders.find((f) => f.id === justCreatedFileId);
    if (folder) {
      setRenamingFolderId(folder.id);
      setRenamingFolderName(folder.name);
      clearJustCreatedFileId();
    }
  }, [allFolders, justCreatedFileId, clearJustCreatedFileId]);

  // Context menu handlers
  const handleContextMenu = useCallback((e: React.MouseEvent, folderId: string) => {
    e.preventDefault();
    e.stopPropagation();

    // Calculate position with viewport boundary check
    const menuWidth = 180;
    const menuHeight = 120;
    let x = e.clientX;
    let y = e.clientY;

    if (x + menuWidth > window.innerWidth - 10) {
      x = window.innerWidth - menuWidth - 10;
    }
    if (y + menuHeight > window.innerHeight - 10) {
      y = window.innerHeight - menuHeight - 10;
    }

    setContextMenu({ x, y, folderId });
    setContextMenuFocusIndex(-1);
    setContextMenuReady(false);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setContextMenuReady(true);
      });
    });
  }, []);

  const handleContextMenuShare = () => {
    if (!contextMenu) return;
    const folder = allFolders.find((f) => f.id === contextMenu.folderId);
    if (folder) {
      setShareFolderId(folder.id);
      setShareFolderName(folder.name);
    }
    setContextMenu(null);
  };

  const handleContextMenuRename = () => {
    if (!contextMenu) return;
    const folder = allFolders.find((f) => f.id === contextMenu.folderId);
    if (folder) {
      setRenamingFolderId(folder.id);
      setRenamingFolderName(folder.name);
    }
    setContextMenu(null);
  };

  const handleContextMenuDelete = () => {
    if (!contextMenu) return;
    const folder = allFolders.find((f) => f.id === contextMenu.folderId);
    if (folder) {
      handleDeleteFolderDirect(folder);
    }
    setContextMenu(null);
  };

  const handleDeleteFolderDirect = async (folder: FileItemType) => {
    const folderName = folder.name;
    const folderId = folder.id;
    try {
      await deleteFile(folderId);
      toast(t("movedToTrash"), {
        action: {
          label: t("restore"),
          onClick: async () => {
            try {
              await restoreFile(folderId);
              toast.success(t("restoredName", { name: folderName }));
            } catch {
              toast.error(t("failedToRestoreFolder"));
            }
          },
        },
        duration: 6000,
      });
    } catch (error) {
      log.error("Failed to delete folder", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

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
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          setContextMenu(null);
          setContextMenuFocusIndex(-1);
          break;
        case "ArrowDown":
          e.preventDefault();
          setContextMenuFocusIndex((prev) => (prev + 1) % 3);
          break;
        case "ArrowUp":
          e.preventDefault();
          setContextMenuFocusIndex((prev) => (prev - 1 + 3) % 3);
          break;
        case "Enter":
          e.preventDefault();
          if (contextMenuFocusIndex === 0) {
            handleContextMenuShare();
          } else if (contextMenuFocusIndex === 1) {
            handleContextMenuRename();
          } else if (contextMenuFocusIndex === 2) {
            handleContextMenuDelete();
          }
          break;
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers read contextMenu which is already a dep
  }, [contextMenu, contextMenuFocusIndex]);

  // When inside a folder, show only files in that folder
  const currentFolderFiles = useMemo(
    () => (currentFolderId ? getFilesInFolder(currentFolderId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- files triggers recomputation
    [currentFolderId, files, getFilesInFolder]
  );

  // Recursive renderer for files and their sub-pages
  const renderFileWithSubPages = (file: FileItemType) => {
    const subPages = getSubPages(file.id);
    return (
      <div key={file.id}>
        <FileItem file={file} />
        {subPages.length > 0 && (
          <div className="ml-4 space-y-0.5 border-l border-border/50 pl-1">
            {subPages.map(renderFileWithSubPages)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {/* Breadcrumb - Multi-level navigation (hide on mobile to avoid redundancy with header back button) */}
      {currentFolderId && currentFolder && (
        <div className="mb-2 hidden items-center gap-1 border-b border-border px-3 py-2 md:flex">
          <button
            onClick={() => setCurrentFolder(null)}
            className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronRight className="h-3 w-3 rotate-180" />
            {t("allFiles")}
          </button>
          {breadcrumbAncestors.map((ancestor, index) => (
            <span key={ancestor.id} className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">/</span>
              {index === breadcrumbAncestors.length - 1 ? (
                <span className="truncate text-xs font-medium text-foreground">
                  {ancestor.name}
                </span>
              ) : (
                <button
                  onClick={() => setCurrentFolder(ancestor.id)}
                  className="truncate text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {ancestor.name}
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Favorites Section - only show at root when there are favorites */}
      {!currentFolderId && getFavorites().length > 0 && (
        <div className="mb-1">
          <button
            onClick={() => setFavoritesExpanded(!favoritesExpanded)}
            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground md:px-2"
          >
            {favoritesExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
            {t("favorites")}
            <span className="ml-auto text-[10px] font-normal text-muted-foreground/60">
              {getFavorites().length}
            </span>
          </button>
          {favoritesExpanded && (
            <div className="space-y-0.5">
              {getFavorites().map((file) => (
                <div key={`fav-${file.id}`}>{renderFileWithSubPages(file)}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Folders at current level (root or inside a folder) */}
      {viewFolders.map((folder) => {
        const folderFiles = getFilesInFolder(folder.id);
        const subFolders = getFolders(folder.id);
        const itemCount = folderFiles.length + subFolders.length;

        return (
          <div key={folder.id}>
            {/* Folder Item */}
            <div
              onDragOver={(e) => handleDragOver(e, folder.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, folder.id)}
              className={`group rounded-md transition-colors ${
                dragOverFolderId === folder.id
                  ? "bg-accent ring-2 ring-primary"
                  : "hover:bg-accent/50"
              }`}
            >
              {renamingFolderId === folder.id ? (
                <div className="flex w-full items-center gap-3 px-3 py-3 text-sm md:gap-2 md:px-2 md:py-1.5">
                  <Folder className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500" />
                  <Input
                    value={renamingFolderName}
                    onChange={(e) => setRenamingFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleFolderRename();
                      if (e.key === "Escape") cancelFolderRename();
                      e.stopPropagation();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-7 flex-1 text-sm"
                    autoFocus
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleFolderRename();
                    }}
                    className="flex-shrink-0 rounded p-0.5 hover:bg-accent"
                    aria-label={t("confirmRename")}
                  >
                    <Check className="h-4 w-4 text-green-600 dark:text-green-500" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      cancelFolderRename();
                    }}
                    className="flex-shrink-0 rounded p-0.5 hover:bg-accent"
                    aria-label={t("cancelRename")}
                  >
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => setCurrentFolder(folder.id)}
                  onContextMenu={(e) => handleContextMenu(e, folder.id)}
                  className="flex w-full cursor-pointer select-none items-center gap-3 px-3 py-3 text-sm transition-transform active:scale-[0.98] md:gap-2 md:px-2 md:py-1.5 md:active:scale-100"
                >
                  {/* Folder icon with count badge */}
                  <div className="relative shrink-0">
                    <Folder className="h-5 w-5 text-amber-600 dark:text-amber-500" />
                    {itemCount > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-600 text-[10px] font-semibold text-white dark:bg-amber-500">
                        {itemCount}
                      </span>
                    )}
                  </div>

                  {/* Folder name and metadata */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base transition-colors hover:text-primary md:text-sm">
                      {folder.name}
                    </p>
                    <p className="truncate text-sm text-muted-foreground md:text-xs">
                      {formatDate(folder.updatedAt)}
                    </p>
                  </div>

                  {/* Three-dot menu */}
                  <div
                    className="flex items-center transition-opacity md:opacity-0 md:group-hover:opacity-100"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <DropdownMenu>
                      <Tooltip content={t("folderOptions")} side="right">
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 md:h-8 md:w-8"
                            aria-label={t("folderOptions")}
                          >
                            <MoreHorizontal className="h-5 w-5 md:h-4 md:w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                      </Tooltip>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setShareFolderId(folder.id);
                            setShareFolderName(folder.name);
                          }}
                        >
                          <Share2 className="mr-2 h-4 w-4" />
                          {t("share")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamingFolderId(folder.id);
                            setRenamingFolderName(folder.name);
                          }}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          {t("rename")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteFolderDirect(folder);
                          }}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          {t("moveToTrash")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Root-level files - only show at root */}
      {!currentFolderId && rootFiles.map((file) => renderFileWithSubPages(file))}

      {/* Files in current folder - only show when inside a folder */}
      {currentFolderId && (
        <div
          className="space-y-1"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setIsDraggingOverEmptyFolder(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDraggingOverEmptyFolder(false);
          }}
          onDrop={(e) => {
            handleDrop(e, currentFolderId);
            setIsDraggingOverEmptyFolder(false);
          }}
        >
          {isImporting ? (
            <div className="flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed border-primary bg-accent/30 py-12 text-center">
              <div className="relative">
                <FolderOpen className="h-12 w-12 text-primary" />
                <Loader2 className="absolute -bottom-1 -right-1 h-5 w-5 animate-spin text-primary" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">{t("importingFiles")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("importProgress", {
                    current: importProgress.current,
                    total: importProgress.total,
                  })}
                </p>
              </div>
            </div>
          ) : currentFolderFiles.length === 0 && viewFolders.length === 0 ? (
            <div
              className={cn(
                "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed py-12 text-center transition-colors",
                isDraggingOverEmptyFolder ? "border-primary bg-accent/50" : "border-transparent"
              )}
            >
              <FolderOpen
                className={cn(
                  "h-12 w-12 transition-colors",
                  isDraggingOverEmptyFolder
                    ? "text-primary"
                    : "text-muted-foreground/30 dark:text-muted-foreground/50"
                )}
              />
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">{t("emptyFolder")}</p>
                <p className="text-xs text-muted-foreground/70">{t("dragFilesHere")}</p>
              </div>
            </div>
          ) : (
            <>
              {currentFolderFiles.map((file) => renderFileWithSubPages(file))}
              {isImporting && (
                <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-accent/50 px-3 py-2.5 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-foreground/80">
                    {t("importingInline", {
                      current: importProgress.current,
                      total: importProgress.total,
                    })}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Empty state */}
      {files.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <FileText className="h-12 w-12 text-muted-foreground/30 dark:text-muted-foreground/50" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{t("noFiles")}</p>
            <p className="text-xs text-muted-foreground/70">{t("createFirstFile")}</p>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu &&
        createPortal(
          <div
            ref={contextMenuRef}
            className="fixed z-[9999] min-w-[180px] rounded-md border border-border bg-popover p-1 shadow-lg"
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
            }}
          >
            {/* Share */}
            <button
              role="menuitem"
              onClick={handleContextMenuShare}
              onMouseEnter={() => contextMenuReady && setContextMenuFocusIndex(0)}
              className={cn(
                "relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none",
                contextMenuReady && "hover:bg-accent hover:text-accent-foreground",
                contextMenuFocusIndex === 0 && "bg-accent text-accent-foreground"
              )}
            >
              <Share2 className="mr-2 h-4 w-4" />
              {t("share")}
            </button>

            {/* Rename */}
            <button
              role="menuitem"
              onClick={handleContextMenuRename}
              onMouseEnter={() => contextMenuReady && setContextMenuFocusIndex(1)}
              className={cn(
                "relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none",
                contextMenuReady && "hover:bg-accent hover:text-accent-foreground",
                contextMenuFocusIndex === 1 && "bg-accent text-accent-foreground"
              )}
            >
              <Pencil className="mr-2 h-4 w-4" />
              {t("rename")}
            </button>

            <div className="my-1 h-px bg-border" />

            {/* Delete */}
            <button
              role="menuitem"
              onClick={handleContextMenuDelete}
              onMouseEnter={() => contextMenuReady && setContextMenuFocusIndex(2)}
              className={cn(
                "relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm text-destructive outline-none",
                contextMenuReady && "hover:bg-destructive/10",
                contextMenuFocusIndex === 2 && "bg-destructive/10"
              )}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t("moveToTrash")}
            </button>
          </div>,
          document.body
        )}

      {/* Share Dialog for folders */}
      {shareFolderId && (
        <ShareDialog
          open={!!shareFolderId}
          onClose={() => {
            setShareFolderId(null);
            setShareFolderName("");
          }}
          fileId={shareFolderId}
          fileName={shareFolderName}
          isFolder
        />
      )}
    </div>
  );
}
