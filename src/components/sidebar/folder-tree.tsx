"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { Check, FilePlus2, Folder, FolderOpen, FolderPlus, Pencil, Trash2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { FileItem } from "./file-item";
import { useFileStore } from "@/stores/file-store";
import type { FileItem as FileItemType } from "@/types";
import { toast } from "sonner";
import { getErrorMessage, cn } from "@/lib/utils";
import { storeLogger } from "@/lib/logger";
import { revealFileInFinder } from "@/lib/storage/reveal";

const log = storeLogger.child("FolderTree");

type FolderMenuItem = {
  id: "new-file" | "new-folder" | "rename" | "reveal" | "delete";
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
};

type EmptyMenuItem = {
  id: "new-file" | "new-folder";
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
};

interface FolderTreeProps {
  onCreateFile: (parentId?: string | null) => void;
  onCreatePdf: (parentId?: string | null) => void;
  onCreateFolder: (parentId?: string | null) => void;
}

export interface FolderTreeHandle {
  collapseAll: () => void;
  hasExpandedFolders: () => boolean;
}

export const FolderTree = forwardRef<FolderTreeHandle, FolderTreeProps>(function FolderTree(
  { onCreateFile, onCreateFolder },
  ref
) {
  const t = useTranslations("sidebar");

  const files = useFileStore((s) => s.files);
  const activeParentId = useFileStore(
    (s) => s.files.find((file) => file.id === s.currentFileId)?.parentId ?? null
  );
  const currentFolderId = useFileStore((s) => s.currentFolderId);
  const getFolders = useFileStore((s) => s.getFolders);
  const getFilesInFolder = useFileStore((s) => s.getFilesInFolder);
  const getSubPages = useFileStore((s) => s.getSubPages);
  const setCurrentFolder = useFileStore((s) => s.setCurrentFolder);
  const moveFileToFolder = useFileStore((s) => s.moveFileToFolder);
  const renameFile = useFileStore((s) => s.renameFile);
  const deleteFile = useFileStore((s) => s.deleteFile);
  const restoreFile = useFileStore((s) => s.restoreFile);
  const justCreatedFileId = useFileStore((s) => s.justCreatedFileId);
  const clearJustCreatedFileId = useFileStore((s) => s.clearJustCreatedFileId);

  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(new Set());
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renamingFolderName, setRenamingFolderName] = useState("");

  // Folder context menu (right-click on a folder row)
  const [folderMenu, setFolderMenu] = useState<{
    x: number;
    y: number;
    items: FolderMenuItem[];
  } | null>(null);
  const [folderMenuFocus, setFolderMenuFocus] = useState(-1);
  const [folderMenuReady, setFolderMenuReady] = useState(false);
  const folderMenuRef = useRef<HTMLDivElement>(null);

  // Empty-area context menu (right-click on workspace root area)
  const [emptyMenu, setEmptyMenu] = useState<{
    x: number;
    y: number;
    items: EmptyMenuItem[];
  } | null>(null);
  const [emptyMenuFocus, setEmptyMenuFocus] = useState(-1);
  const emptyMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (currentFolderId) {
      setCurrentFolder(null);
    }
  }, [currentFolderId, setCurrentFolder]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- files triggers recomputation through store methods
  const viewFolders = useMemo(() => getFolders(null), [files, getFolders]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- same
  const rootFiles = useMemo(() => getFilesInFolder(null), [files, getFilesInFolder]);
  const allFolders = useMemo(() => files.filter((f) => f.isFolder), [files]);

  const hasExpandedFolders = viewFolders.some((f) => !collapsedFolderIds.has(f.id));

  useImperativeHandle(
    ref,
    () => ({
      collapseAll: () => setCollapsedFolderIds(new Set(allFolders.map((f) => f.id))),
      hasExpandedFolders: () => hasExpandedFolders,
    }),
    [allFolders, hasExpandedFolders]
  );

  // Drag & drop: move files between folders. External file drops are
  // intentionally ignored — the workspace folder is the source of truth.
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

  // Folder rename
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

  // Build the right-click menu for a folder. Encapsulating the items in
  // a single array makes keyboard navigation independent of which menu is
  // open and which entries are present.
  const buildFolderMenu = useCallback(
    (folder: FileItemType): FolderMenuItem[] => [
      {
        id: "new-file",
        label: t("newDocument"),
        icon: <FilePlus2 className="mr-2 h-4 w-4" />,
        onClick: () => onCreateFile(folder.id),
      },
      {
        id: "new-folder",
        label: t("newFolder"),
        icon: <FolderPlus className="mr-2 h-4 w-4" />,
        onClick: () => onCreateFolder(folder.id),
      },
      {
        id: "rename",
        label: t("rename"),
        icon: <Pencil className="mr-2 h-4 w-4" />,
        onClick: () => {
          setRenamingFolderId(folder.id);
          setRenamingFolderName(folder.name);
        },
      },
      {
        id: "reveal",
        label: t("revealInFinder"),
        icon: <FolderOpen className="mr-2 h-4 w-4" />,
        onClick: async () => {
          try {
            await revealFileInFinder(folder);
          } catch (error) {
            log.error("Failed to reveal folder in Finder", error);
            const { title, description } = getErrorMessage(error);
            toast.error(title, { description });
          }
        },
      },
      {
        id: "delete",
        label: t("moveToTrash"),
        icon: <Trash2 className="mr-2 h-4 w-4" />,
        onClick: () => handleDeleteFolderDirect(folder),
        destructive: true,
      },
    ],
    // handleDeleteFolderDirect is stable enough — it reads from the store
    // and from translations on each invocation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, onCreateFile, onCreateFolder]
  );

  const buildEmptyMenu = useCallback(
    (): EmptyMenuItem[] => [
      {
        id: "new-file",
        label: t("newDocument"),
        icon: <FilePlus2 className="mr-2 h-4 w-4" />,
        onClick: () => onCreateFile(null),
      },
      {
        id: "new-folder",
        label: t("newFolder"),
        icon: <FolderPlus className="mr-2 h-4 w-4" />,
        onClick: () => onCreateFolder(null),
      },
    ],
    [t, onCreateFile, onCreateFolder]
  );

  // Position helpers — clamp to viewport so menus don't overflow.
  const positionForMouse = (clientX: number, clientY: number, w: number, h: number) => {
    let x = clientX;
    let y = clientY;
    if (x + w > window.innerWidth - 10) x = window.innerWidth - w - 10;
    if (y + h > window.innerHeight - 10) y = window.innerHeight - h - 10;
    return { x, y };
  };

  const handleFolderContextMenu = useCallback(
    (e: React.MouseEvent, folder: FileItemType) => {
      e.preventDefault();
      e.stopPropagation();
      const items = buildFolderMenu(folder);
      const { x, y } = positionForMouse(e.clientX, e.clientY, 200, items.length * 32 + 8);
      setFolderMenu({ x, y, items });
      setFolderMenuFocus(-1);
      setFolderMenuReady(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setFolderMenuReady(true));
      });
    },
    [buildFolderMenu]
  );

  const handleEmptyAreaContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const items = buildEmptyMenu();
      const { x, y } = positionForMouse(e.clientX, e.clientY, 180, items.length * 32 + 8);
      setEmptyMenu({ x, y, items });
      setEmptyMenuFocus(-1);
    },
    [buildEmptyMenu]
  );

  // Close menus on outside click / Escape, support arrow-key nav.
  useEffect(() => {
    if (!folderMenu && !emptyMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (folderMenuRef.current && !folderMenuRef.current.contains(e.target as Node)) {
        setFolderMenu(null);
        setFolderMenuFocus(-1);
      }
      if (emptyMenuRef.current && !emptyMenuRef.current.contains(e.target as Node)) {
        setEmptyMenu(null);
        setEmptyMenuFocus(-1);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = folderMenu ?? emptyMenu;
      if (!active) return;
      const length = active.items.length;
      const focus = folderMenu ? folderMenuFocus : emptyMenuFocus;
      const setFocus = folderMenu ? setFolderMenuFocus : setEmptyMenuFocus;
      const closeAll = () => {
        setFolderMenu(null);
        setFolderMenuFocus(-1);
        setEmptyMenu(null);
        setEmptyMenuFocus(-1);
      };
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          closeAll();
          break;
        case "ArrowDown":
          e.preventDefault();
          setFocus((focus + 1) % length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocus((focus - 1 + length) % length);
          break;
        case "Enter":
          e.preventDefault();
          if (focus >= 0 && focus < length) {
            const item = active.items[focus];
            closeAll();
            item.onClick();
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
  }, [folderMenu, emptyMenu, folderMenuFocus, emptyMenuFocus]);

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

  const folderRows = viewFolders.map((folder) => {
    const folderFiles = getFilesInFolder(folder.id);
    const isCollapsed = collapsedFolderIds.has(folder.id);
    const isActiveFolder = activeParentId === folder.id;

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
            <div className="flex w-full items-center gap-2 px-2.5 py-1.5 text-sm">
              <Folder className="h-[18px] w-[18px] shrink-0 text-[var(--sidebar-icon)]" />
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
                  if (next.has(folder.id)) next.delete(folder.id);
                  else next.add(folder.id);
                  return next;
                });
              }}
              onContextMenu={(e) => handleFolderContextMenu(e, folder)}
              className="flex h-7 w-full cursor-pointer select-none items-center gap-2 px-2.5 text-sm"
            >
              {isCollapsed ? (
                <Folder className="h-[18px] w-[18px] shrink-0 text-[var(--sidebar-icon)] transition-colors group-hover/folder:text-[var(--sidebar-text)]" />
              ) : (
                <FolderOpen className="h-[18px] w-[18px] shrink-0 text-[var(--sidebar-icon)] transition-colors group-hover/folder:text-[var(--sidebar-text)]" />
              )}
              <span className="text-ui-base min-w-0 flex-1 truncate font-semibold leading-5 text-[var(--sidebar-text)] transition-colors group-hover/folder:text-foreground">
                {folder.name}
              </span>
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
    <div
      className="flex min-h-full flex-col"
      onContextMenu={handleEmptyAreaContextMenu}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => handleDrop(e, null)}
    >
      <div className="space-y-0.5">
        {folderRows}
        {rootFiles.map((file) => renderFileWithSubPages(file))}
      </div>

      {files.length === 0 && (
        <div className="px-1 pt-5">
          <div className="px-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
            {t("emptyEyebrow")}
          </div>

          <ol className="m-0 mt-3 flex list-none flex-col p-0">
            <li className="border-t border-border">
              <button
                type="button"
                onClick={() => onCreateFile(null)}
                className="group flex w-full items-baseline gap-3 px-2 py-2.5 text-left transition-colors duration-150 hover:bg-[var(--sidebar-hover)] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span className="w-5 shrink-0 font-mono text-[11px] tabular-nums tracking-[0.02em] text-muted-foreground transition-colors duration-150 group-hover:font-medium group-hover:text-foreground group-focus-visible:font-medium group-focus-visible:text-foreground">
                  01
                </span>
                <span className="font-brand-sans min-w-0 flex-1 truncate text-[13px] tracking-[-0.012em] text-foreground/90 transition-colors duration-150 group-hover:text-foreground group-focus-visible:text-foreground">
                  {t("newDocument")}
                </span>
              </button>
            </li>
            <li className="border-b border-t border-border">
              <button
                type="button"
                onClick={() => onCreateFolder(null)}
                className="group flex w-full items-baseline gap-3 px-2 py-2.5 text-left transition-colors duration-150 hover:bg-[var(--sidebar-hover)] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span className="w-5 shrink-0 font-mono text-[11px] tabular-nums tracking-[0.02em] text-muted-foreground transition-colors duration-150 group-hover:font-medium group-hover:text-foreground group-focus-visible:font-medium group-focus-visible:text-foreground">
                  02
                </span>
                <span className="font-brand-sans min-w-0 flex-1 truncate text-[13px] tracking-[-0.012em] text-foreground/90 transition-colors duration-150 group-hover:text-foreground group-focus-visible:text-foreground">
                  {t("newFolder")}
                </span>
              </button>
            </li>
          </ol>

          <p className="font-brand-sans mt-3 px-2 text-[11px] leading-snug text-muted-foreground/45">
            {t("emptyTailHint")}
          </p>
        </div>
      )}

      {/* Spacer captures right-clicks below the last item so users can
          create files anywhere in the empty area, not just on rows. */}
      <div className="flex-1" aria-hidden />

      {/* Folder context menu */}
      {folderMenu &&
        createPortal(
          <div
            ref={folderMenuRef}
            role="menu"
            className="fixed z-[9999] min-w-[200px] rounded-md border border-border bg-popover p-1 shadow-lg"
            style={{ left: folderMenu.x, top: folderMenu.y }}
          >
            {folderMenu.items.map((item, index) => (
              <button
                key={item.id}
                role="menuitem"
                onMouseEnter={() => folderMenuReady && setFolderMenuFocus(index)}
                onClick={() => {
                  setFolderMenu(null);
                  setFolderMenuFocus(-1);
                  item.onClick();
                }}
                className={cn(
                  "relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none",
                  item.destructive && "text-destructive",
                  folderMenuReady &&
                    (item.destructive
                      ? "hover:bg-destructive/10"
                      : "hover:bg-accent hover:text-accent-foreground"),
                  folderMenuFocus === index &&
                    (item.destructive ? "bg-destructive/10" : "bg-accent text-accent-foreground")
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>,
          document.body
        )}

      {/* Empty-area context menu */}
      {emptyMenu &&
        createPortal(
          <div
            ref={emptyMenuRef}
            role="menu"
            className="fixed z-[9999] min-w-[180px] rounded-md border border-border bg-popover p-1 shadow-lg"
            style={{ left: emptyMenu.x, top: emptyMenu.y }}
          >
            {emptyMenu.items.map((item, index) => (
              <button
                key={item.id}
                role="menuitem"
                onMouseEnter={() => setEmptyMenuFocus(index)}
                onClick={() => {
                  setEmptyMenu(null);
                  setEmptyMenuFocus(-1);
                  item.onClick();
                }}
                className={cn(
                  "relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none",
                  "hover:bg-accent hover:text-accent-foreground",
                  emptyMenuFocus === index && "bg-accent text-accent-foreground"
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
});

FolderTree.displayName = "FolderTree";
