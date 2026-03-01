"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal,
  Pencil,
  Share2,
  FileDown,
  Trash2,
  Folder,
  Star,
  FileText,
} from "lucide-react";
import { cn, formatRelativeDate } from "@/lib/utils";
import { getNameWithoutExtension } from "@/lib/file-utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { ShareDialog } from "@/components/share/share-dialog";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface FileRowProps {
  file: FileItem;
  index: number;
}

export function FileRow({ file }: FileRowProps) {
  const router = useRouter();
  const {
    setCurrentFile,
    deleteFile,
    renameFile,
    moveFileToFolder,
    setCurrentFolder,
    getFilesInFolder,
    toggleFavorite,
  } = useFileStore();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const displayName = file.isFolder ? file.name : getNameWithoutExtension(file.name);
  const preview = file.preview;
  const wordCount = file.wordCount;
  const folderFileCount = file.isFolder ? getFilesInFolder(file.id).length : 0;

  const handleOpen = () => {
    if (file.isFolder) {
      setCurrentFolder(file.id);
      return;
    }
    setCurrentFile(file.id);
    router.push(`/editor/${file.id}`);
  };

  // Drag-and-drop handlers
  const handleDragStart = (e: React.DragEvent) => {
    if (file.isFolder) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", file.id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!file.isFolder) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    if (!file.isFolder) return;
    e.preventDefault();
    setIsDragOver(false);
    const draggedFileId = e.dataTransfer.getData("text/plain");
    if (draggedFileId && draggedFileId !== file.id) {
      try {
        await moveFileToFolder(draggedFileId, file.id);
        toast.success("File moved to folder");
      } catch {
        toast.error("Failed to move file");
      }
    }
  };

  const handleRenameOpen = () => {
    setRenameDraft(displayName);
    setShowRenameModal(true);
  };

  const handleRenameSubmit = () => {
    const trimmed = renameDraft.trim();
    if (trimmed && trimmed !== displayName) {
      renameFile(file.id, `${trimmed}.md`);
    }
    setShowRenameModal(false);
  };

  const handleDelete = async () => {
    try {
      await deleteFile(file.id);
    } catch {
      toast.error("Failed to delete file");
    }
    setShowDeleteModal(false);
  };

  const handleExport = async (format: "markdown" | "pdf" | "docx") => {
    try {
      const blob = await api.exportFile(file.id, format);
      const extension = format === "markdown" ? "md" : format;
      const filename = `${displayName}.${extension}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error(`Failed to export as ${format.toUpperCase()}`);
    }
  };

  return (
    <>
      <div
        className={cn(
          "group flex cursor-pointer items-center gap-4 px-5 py-4 transition-colors duration-150",
          "hover:bg-accent/50",
          "active:scale-[0.998]",
          isDragOver &&
            "bg-amber-50/80 ring-1 ring-amber-300/50 dark:bg-amber-900/20 dark:ring-amber-500/30"
        )}
        onClick={handleOpen}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenuPos({ x: e.clientX, y: e.clientY });
          setDropdownOpen(true);
        }}
        draggable={!file.isFolder}
        onDragStart={!file.isFolder ? handleDragStart : undefined}
        onDragOver={file.isFolder ? handleDragOver : undefined}
        onDragLeave={file.isFolder ? handleDragLeave : undefined}
        onDrop={file.isFolder ? handleDrop : undefined}
      >
        {/* Icon — folder or paper page */}
        {file.isFolder ? (
          <Folder
            className="h-5 w-5 flex-shrink-0 text-amber-500/70 dark:text-amber-400/60"
            strokeWidth={1.5}
          />
        ) : (
          <FileText className="h-5 w-5 flex-shrink-0 text-muted-foreground/50" />
        )}

        {/* File name */}
        {/* Favorite indicator */}
        {file.isFavorite && !file.isFolder && (
          <Star className="h-3 w-3 flex-shrink-0 fill-amber-400 text-amber-400" />
        )}

        <span className="min-w-0 flex-shrink-0 text-sm font-semibold text-foreground/85">
          {displayName}
        </span>

        {/* Preview text or folder file count */}
        {file.isFolder ? (
          <span className="hidden min-w-0 flex-1 truncate text-[13px] text-foreground/45 dark:text-foreground/55 md:block">
            {folderFileCount === 0
              ? "Empty"
              : folderFileCount === 1
                ? "1 file"
                : `${folderFileCount} files`}
          </span>
        ) : preview ? (
          <span className="hidden min-w-0 flex-1 truncate text-[13px] text-foreground/45 dark:text-foreground/55 md:block">
            {preview}
          </span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}

        {/* Word count (files only) */}
        <span className="hidden flex-shrink-0 text-xs text-foreground/40 dark:text-foreground/50 md:block">
          {!file.isFolder && wordCount > 0
            ? wordCount < 1000
              ? `${wordCount}w`
              : `${(wordCount / 1000).toFixed(1)}kw`
            : ""}
        </span>

        {/* Date */}
        <span className="flex-shrink-0 text-xs tracking-wide text-foreground/45 dark:text-foreground/55">
          {formatRelativeDate(file.updatedAt)}
        </span>

        {/* Actions */}
        <div
          className="flex-shrink-0 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu
            open={dropdownOpen}
            onOpenChange={(v) => {
              setDropdownOpen(v);
              if (!v) setContextMenuPos(null);
            }}
            anchorPoint={contextMenuPos}
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-md"
                aria-label="File options"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleRenameOpen}>
                <Pencil className="mr-2 h-4 w-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowShareDialog(true)}>
                <Share2 className="mr-2 h-4 w-4" />
                Share
              </DropdownMenuItem>
              {!file.isFolder && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavorite(file.id);
                  }}
                >
                  <Star
                    className={cn(
                      "mr-2 h-4 w-4",
                      file.isFavorite && "fill-amber-500 text-amber-500"
                    )}
                  />
                  {file.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Export as
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => handleExport("markdown")}>
                <FileDown className="mr-2 h-4 w-4" />
                Markdown
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("pdf")}>
                <FileDown className="mr-2 h-4 w-4" />
                PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("docx")}>
                <FileDown className="mr-2 h-4 w-4" />
                Word
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setShowDeleteModal(true)}
                className="text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Rename modal */}
      <Modal open={showRenameModal} onClose={() => setShowRenameModal(false)}>
        <ModalHeader>Rename Document</ModalHeader>
        <input
          ref={renameInputRef}
          type="text"
          value={renameDraft}
          onChange={(e) => setRenameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleRenameSubmit();
            }
          }}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          autoFocus
        />
        <ModalFooter>
          <Button variant="ghost" onClick={() => setShowRenameModal(false)}>
            Cancel
          </Button>
          <Button onClick={handleRenameSubmit} disabled={!renameDraft.trim()}>
            Rename
          </Button>
        </ModalFooter>
      </Modal>

      {/* Delete confirmation */}
      <Modal open={showDeleteModal} onClose={() => setShowDeleteModal(false)}>
        <ModalHeader>Delete File</ModalHeader>
        <p className="text-sm text-muted-foreground">
          Are you sure you want to delete &quot;{displayName}&quot;? This action cannot be undone.
        </p>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setShowDeleteModal(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete}>
            Delete
          </Button>
        </ModalFooter>
      </Modal>

      {/* Share dialog */}
      <ShareDialog
        open={showShareDialog}
        onClose={() => setShowShareDialog(false)}
        fileId={file.id}
        fileName={displayName}
        isFolder={file.isFolder}
      />
    </>
  );
}
