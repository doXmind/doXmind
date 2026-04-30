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
  FileText,
  Star,
  Share2,
  FolderPlus,
  Maximize2,
  MoreHorizontal,
  Minimize2,
  SquarePen,
  Upload,
} from "lucide-react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileItem } from "./file-item";
import { NewButton } from "@/components/home/new-button";
import { ShareDialog } from "@/components/share/share-dialog";
import { SortDropdown } from "./sort-dropdown";
import { useFileStore } from "@/stores/file-store";
import type { FileItem as FileItemType } from "@/types";
import { toast } from "sonner";
import { getErrorMessage, cn } from "@/lib/utils";
import { storeLogger } from "@/lib/logger";

const log = storeLogger.child("FolderTree");

interface FolderTreeProps {
  onCreateFile: (parentId?: string | null) => void;
  onCreateFolder: () => void;
  onOpenTemplatePicker: () => void;
  onImportFile: () => void;
  onImportFolder: () => void;
  isImporting: boolean;
}

function SidebarSection({
  title,
  children,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="space-y-1">
      <div className="flex h-7 items-center justify-between px-2.5">
        <h2 className="text-ui-xs font-semibold uppercase leading-none tracking-wide text-muted-foreground/70">
          {title}
        </h2>
        {actions ? <div className="flex items-center gap-0.5">{actions}</div> : null}
      </div>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function HeaderIconButton({
  label,
  children,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label} side="top">
      <button
        onClick={onClick}
        className="sidebar-action-button flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
        aria-label={label}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function FolderTree({
  onCreateFile,
  onCreateFolder,
  onOpenTemplatePicker,
  onImportFile,
  onImportFolder,
  isImporting: isFileImporting,
}: FolderTreeProps) {
  const t = useTranslations("sidebar");

  // Fine-grained selectors — actions are stable refs, state values subscribed individually
  const files = useFileStore((s) => s.files);
  const currentFileId = useFileStore((s) => s.currentFileId);
  const currentFolderId = useFileStore((s) => s.currentFolderId);
  const getFolders = useFileStore((s) => s.getFolders);
  const getFilesInFolder = useFileStore((s) => s.getFilesInFolder);
  const getSubPages = useFileStore((s) => s.getSubPages);
  const getFavorites = useFileStore((s) => s.getFavorites);
  const setCurrentFolder = useFileStore((s) => s.setCurrentFolder);
  const moveFileToFolder = useFileStore((s) => s.moveFileToFolder);
  const renameFile = useFileStore((s) => s.renameFile);
  const deleteFile = useFileStore((s) => s.deleteFile);
  const restoreFile = useFileStore((s) => s.restoreFile);
  const importFile = useFileStore((s) => s.importFile);
  const justCreatedFileId = useFileStore((s) => s.justCreatedFileId);
  const clearJustCreatedFileId = useFileStore((s) => s.clearJustCreatedFileId);
  const [favoritesExpanded, setFavoritesExpanded] = useState(true);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(new Set());
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [, setIsImporting] = useState(false);
  const [, setImportProgress] = useState({ current: 0, total: 0 });
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

  useEffect(() => {
    if (currentFolderId) {
      setCurrentFolder(null);
    }
  }, [currentFolderId, setCurrentFolder]);

  // Memoize derived data — recomputed only when files change.
  // `files` is intentionally in deps as a change signal even though getFolders/etc.
  // read it internally (ESLint can't see through the store method indirection).
  const viewFolders = useMemo(
    () => getFolders(null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- files triggers recomputation
    [files, getFolders]
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- files triggers recomputation
  const rootFiles = useMemo(() => getFilesInFolder(null), [files, getFilesInFolder]);
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

  const handleFolderActionsClick = useCallback((e: React.MouseEvent, folderId: string) => {
    e.preventDefault();
    e.stopPropagation();

    const menuWidth = 180;
    const menuHeight = 120;
    const rect = e.currentTarget.getBoundingClientRect();
    let x = rect.right - menuWidth;
    let y = rect.bottom + 6;

    if (x < 10) {
      x = 10;
    }
    if (x + menuWidth > window.innerWidth - 10) {
      x = window.innerWidth - menuWidth - 10;
    }
    if (y + menuHeight > window.innerHeight - 10) {
      y = rect.top - menuHeight - 6;
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

  const hasExpandedFolders = viewFolders.some((folder) => !collapsedFolderIds.has(folder.id));
  const collapseToggleLabel = hasExpandedFolders ? t("collapseAll") : t("expandAll");

  const folderActions = (
    <>
      <HeaderIconButton
        label={collapseToggleLabel}
        onClick={() =>
          setCollapsedFolderIds(
            hasExpandedFolders ? new Set(viewFolders.map((folder) => folder.id)) : new Set()
          )
        }
      >
        {hasExpandedFolders ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </HeaderIconButton>
      <Tooltip content={t("organizeFolders")} side="top">
        <SortDropdown iconOnly ariaLabel={t("organizeFolders")} />
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="sidebar-action-button flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
            aria-label={t("newFolder")}
            title={t("newFolder")}
          >
            <FolderPlus className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={onCreateFolder}>
            <FolderPlus className="mr-2 h-4 w-4" />
            {t("newFolder")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onImportFolder}>
            <Upload className="mr-2 h-4 w-4" />
            {t("importFolder")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  const fileActions = (
    <>
      <Tooltip content={t("organizeFiles")} side="top">
        <SortDropdown iconOnly ariaLabel={t("organizeFiles")} />
      </Tooltip>
      <NewButton
        onCreateFile={onCreateFile}
        onCreateFolder={onCreateFolder}
        onOpenTemplatePicker={onOpenTemplatePicker}
        onImportFile={onImportFile}
        isImporting={isFileImporting}
        hideFolder
      />
    </>
  );

  const folderRows = viewFolders.map((folder) => {
    const folderFiles = getFilesInFolder(folder.id);
    const isCollapsed = collapsedFolderIds.has(folder.id);
    const isActiveFolder = files.find((file) => file.id === currentFileId)?.parentId === folder.id;

    return (
      <div key={folder.id} className="space-y-0.5">
        <div
          onDragOver={(e) => handleDragOver(e, folder.id)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, folder.id)}
          className={cn(
            "group/folder rounded-lg transition-colors duration-150 ease-out",
            dragOverFolderId === folder.id
              ? "bg-[var(--sidebar-active)] ring-1 ring-primary/40"
              : isActiveFolder
                ? "bg-[var(--sidebar-active)] shadow-[var(--sidebar-active-shadow)] ring-1 ring-[var(--sidebar-active-border)]"
                : "hover:bg-[var(--sidebar-hover)]"
          )}
        >
          {renamingFolderId === folder.id ? (
            <div className="flex w-full items-center gap-3 px-3 py-3 text-sm md:gap-2 md:px-2.5 md:py-1.5">
              <Folder className="h-5 w-5 shrink-0 text-muted-foreground/80" />
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
              onClick={() => {
                setCollapsedFolderIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(folder.id)) {
                    next.delete(folder.id);
                  } else {
                    next.add(folder.id);
                  }
                  return next;
                });
              }}
              onContextMenu={(e) => handleContextMenu(e, folder.id)}
              className="flex h-7 w-full cursor-pointer select-none items-center gap-2 px-2.5 text-sm transition-transform active:scale-[0.98] md:active:scale-100"
            >
              {isCollapsed ? (
                <Folder className="h-[18px] w-[18px] shrink-0 text-muted-foreground/80 transition-colors group-hover/folder:text-foreground/70" />
              ) : (
                <FolderOpen className="h-[18px] w-[18px] shrink-0 text-muted-foreground/80 transition-colors group-hover/folder:text-foreground/70" />
              )}

              <span className="text-ui-base min-w-0 flex-1 truncate font-semibold leading-5 text-foreground/80 transition-colors group-hover/folder:text-foreground">
                {folder.name}
              </span>
              <div className="ml-1 hidden items-center gap-0.5 opacity-0 transition-opacity group-focus-within/folder:opacity-100 group-hover/folder:opacity-100 md:flex">
                <button
                  onClick={(e) => handleFolderActionsClick(e, folder.id)}
                  className="sidebar-action-button flex h-6 w-6 items-center justify-center rounded-md transition-colors"
                  aria-label={t("folderActions")}
                  title={t("folderActions")}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateFile(folder.id);
                  }}
                  className="sidebar-action-button flex h-6 w-6 items-center justify-center rounded-md transition-colors"
                  aria-label={t("newDocument")}
                  title={t("newDocument")}
                >
                  <SquarePen className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
        {!isCollapsed && folderFiles.length > 0 && (
          <div className="ml-6 space-y-0.5 pl-1.5">
            {folderFiles.map((file) => renderFileWithSubPages(file))}
          </div>
        )}
      </div>
    );
  });

  return (
    <div className="space-y-3">
      {/* Favorites Section - only show at root when there are favorites */}
      {getFavorites().length > 0 && (
        <div className="mb-1">
          <button
            onClick={() => setFavoritesExpanded(!favoritesExpanded)}
            className="text-ui-xs flex h-7 w-full items-center gap-1.5 rounded-lg px-2.5 font-semibold text-muted-foreground transition-colors hover:bg-[var(--sidebar-hover)] hover:text-foreground"
          >
            {favoritesExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
            {t("favorites")}
            <span className="text-ui-xs ml-auto font-normal text-muted-foreground/60">
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

      <SidebarSection title={t("folders")} actions={folderActions}>
        {folderRows}
      </SidebarSection>

      {rootFiles.length > 0 && (
        <SidebarSection title={t("files")} actions={fileActions}>
          {rootFiles.map((file) => renderFileWithSubPages(file))}
        </SidebarSection>
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
