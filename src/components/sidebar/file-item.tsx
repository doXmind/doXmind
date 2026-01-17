"use client";

import { FileText, Trash2, MoreHorizontal, FileDown, Pencil } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { useFileStore, type FileItem as FileItemType } from "@/stores/file-store";
import { api } from "@/lib/api";

interface FileItemProps {
  file: FileItemType;
}

export function FileItem({ file }: FileItemProps) {
  const { currentFileId, setCurrentFile, deleteFile, renameFile } = useFileStore();
  const [isRenaming, setIsRenaming] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [contextMenuFocusIndex, setContextMenuFocusIndex] = useState(-1);
  const [contextMenuReady, setContextMenuReady] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  // Remove .md extension for editing
  const getNameWithoutExtension = (name: string) => name.replace(/\.md$/, "");
  const [newName, setNewName] = useState(getNameWithoutExtension(file.name));

  const isActive = currentFileId === file.id;

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
      const itemCount = 5; // rename, 3 exports, delete
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
          if (contextMenuFocusIndex === 0) {
            setContextMenu(null);
            setContextMenuFocusIndex(-1);
            setNewName(getNameWithoutExtension(file.name));
            setIsRenaming(true);
          } else if (contextMenuFocusIndex === 1) {
            setContextMenu(null);
            setContextMenuFocusIndex(-1);
            handleExport("markdown");
          } else if (contextMenuFocusIndex === 2) {
            setContextMenu(null);
            setContextMenuFocusIndex(-1);
            handleExport("pdf");
          } else if (contextMenuFocusIndex === 3) {
            setContextMenu(null);
            setContextMenuFocusIndex(-1);
            handleExport("docx");
          } else if (contextMenuFocusIndex === 4) {
            setContextMenu(null);
            setContextMenuFocusIndex(-1);
            setShowDeleteModal(true);
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

  const handleClick = () => {
    if (!isRenaming) {
      setCurrentFile(file.id);
    }
  };

  const handleRename = async () => {
    const trimmedName = newName.trim();
    const fullName = trimmedName ? `${trimmedName}.md` : "";
    if (trimmedName && fullName !== file.name) {
      try {
        await renameFile(file.id, fullName);
      } catch (error) {
        console.error("Failed to rename file:", error);
      }
    }
    setIsRenaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRename();
    } else if (e.key === "Escape") {
      setNewName(getNameWithoutExtension(file.name));
      setIsRenaming(false);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async () => {
    try {
      await deleteFile(file.id);
    } catch (error) {
      console.error("Failed to delete file:", error);
    }
    setShowDeleteModal(false);
  };

  const handleExport = async (format: "markdown" | "pdf" | "docx") => {
    try {
      const blob = await api.exportFile(file.id, format);
      const baseName = getNameWithoutExtension(file.name);
      const extension = format === "markdown" ? "md" : format;
      const filename = `${baseName}.${extension}`;

      // Create download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(`Failed to export as ${format}:`, error);
    }
  };

  // Context menu action handlers
  const handleContextMenuRename = () => {
    setContextMenu(null);
    setNewName(getNameWithoutExtension(file.name));
    setIsRenaming(true);
  };

  const handleContextMenuDelete = () => {
    setContextMenu(null);
    setShowDeleteModal(true);
  };

  const handleContextMenuExport = (format: "markdown" | "pdf" | "docx") => {
    setContextMenu(null);
    handleExport(format);
  };

  return (
    <div
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      className={cn(
        "group flex cursor-pointer items-center gap-3 rounded-md px-3 py-3 transition-colors md:gap-2 md:px-2 md:py-1.5",
        "active:scale-[0.98] md:active:scale-100", // Touch feedback on mobile
        isActive ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50"
      )}
    >
      <FileText className="h-5 w-5 flex-shrink-0 text-muted-foreground md:h-4 md:w-4" />

      <div className="min-w-0 flex-1">
        {isRenaming ? (
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="h-8 px-2 py-0 text-base md:h-6 md:px-1 md:text-sm"
            autoFocus={window.innerWidth >= 768}
          />
        ) : (
          <>
            <p className="truncate text-base md:text-sm">{getNameWithoutExtension(file.name)}</p>
            <p className="truncate text-sm text-muted-foreground md:text-xs">
              {formatDate(file.updatedAt)}
            </p>
          </>
        )}
      </div>

      {/* Actions - Always visible on mobile via menu button */}
      <div className="flex items-center transition-opacity md:opacity-0 md:group-hover:opacity-100">
        <DropdownMenu>
          <Tooltip content="File options" side="right">
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 md:h-8 md:w-8"
                onClick={(e) => e.stopPropagation()}
                aria-label="File options"
              >
                <MoreHorizontal className="h-5 w-5 md:h-4 md:w-4" />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                setNewName(getNameWithoutExtension(file.name));
                setIsRenaming(true);
              }}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Export as
            </DropdownMenuLabel>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                handleExport("markdown");
              }}
            >
              <FileDown className="mr-2 h-4 w-4" />
              Markdown
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                handleExport("pdf");
              }}
            >
              <FileDown className="mr-2 h-4 w-4" />
              PDF
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                handleExport("docx");
              }}
            >
              <FileDown className="mr-2 h-4 w-4" />
              Word
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleDeleteClick} className="text-destructive">
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Delete Confirmation Modal */}
      <Modal open={showDeleteModal} onClose={() => setShowDeleteModal(false)}>
        <ModalHeader>Delete File</ModalHeader>
        <p className="text-sm text-muted-foreground">
          Are you sure you want to delete &quot;{getNameWithoutExtension(file.name)}&quot;? This
          action cannot be undone.
        </p>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setShowDeleteModal(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDeleteConfirm}>
            Delete
          </Button>
        </ModalFooter>
      </Modal>

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
            {/* Rename */}
            <button
              role="menuitem"
              onClick={handleContextMenuRename}
              onMouseEnter={() => contextMenuReady && setContextMenuFocusIndex(0)}
              className={cn(
                "relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none",
                contextMenuReady && "hover:bg-accent hover:text-accent-foreground",
                contextMenuFocusIndex === 0 && "bg-accent text-accent-foreground"
              )}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Rename
            </button>

            <div className="my-1 h-px bg-border" />

            {/* Export submenu label */}
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Export as</div>

            {/* Export Markdown */}
            <button
              role="menuitem"
              onClick={() => handleContextMenuExport("markdown")}
              onMouseEnter={() => contextMenuReady && setContextMenuFocusIndex(1)}
              className={cn(
                "relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none",
                contextMenuReady && "hover:bg-accent hover:text-accent-foreground",
                contextMenuFocusIndex === 1 && "bg-accent text-accent-foreground"
              )}
            >
              <FileDown className="mr-2 h-4 w-4" />
              Markdown
            </button>

            {/* Export PDF */}
            <button
              role="menuitem"
              onClick={() => handleContextMenuExport("pdf")}
              onMouseEnter={() => contextMenuReady && setContextMenuFocusIndex(2)}
              className={cn(
                "relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none",
                contextMenuReady && "hover:bg-accent hover:text-accent-foreground",
                contextMenuFocusIndex === 2 && "bg-accent text-accent-foreground"
              )}
            >
              <FileDown className="mr-2 h-4 w-4" />
              PDF
            </button>

            {/* Export Word */}
            <button
              role="menuitem"
              onClick={() => handleContextMenuExport("docx")}
              onMouseEnter={() => contextMenuReady && setContextMenuFocusIndex(3)}
              className={cn(
                "relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none",
                contextMenuReady && "hover:bg-accent hover:text-accent-foreground",
                contextMenuFocusIndex === 3 && "bg-accent text-accent-foreground"
              )}
            >
              <FileDown className="mr-2 h-4 w-4" />
              Word
            </button>

            <div className="my-1 h-px bg-border" />

            {/* Delete */}
            <button
              role="menuitem"
              onClick={handleContextMenuDelete}
              onMouseEnter={() => contextMenuReady && setContextMenuFocusIndex(4)}
              className={cn(
                "relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm text-destructive outline-none",
                contextMenuReady && "hover:bg-destructive/10",
                contextMenuFocusIndex === 4 && "bg-destructive/10"
              )}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
