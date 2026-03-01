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
  FolderOpen,
  Star,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn, formatRelativeDate } from "@/lib/utils";
import { formatWordCount, getNameWithoutExtension } from "@/lib/file-utils";
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

interface FileCardProps {
  file: FileItem;
  index: number;
  searchMatch?: { snippet: string; score: number; query: string };
  onResultClick?: (fileId: string, position: number, score: number) => void;
}

function highlightQuery(text: string, query: string) {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark
        key={i}
        className="rounded-sm bg-amber-200/50 px-0.5 text-foreground/60 dark:bg-amber-500/20"
      >
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export function FileCard({ file, index, searchMatch, onResultClick }: FileCardProps) {
  const router = useRouter();
  const {
    setCurrentFile,
    deleteFile,
    renameFile,
    getFilesInFolder,
    setCurrentFolder,
    moveFileToFolder,
    toggleFavorite,
  } = useFileStore();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [isHovering, setIsHovering] = useState(false);
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
      // For folders, navigate to folder view or set current folder
      setCurrentFolder(file.id);
      return;
    }

    if (searchMatch && onResultClick) {
      onResultClick(file.id, index, searchMatch.score);
    }
    setCurrentFile(file.id);
    router.push(`/editor/${file.id}`);
  };

  const handleRenameOpen = () => {
    setRenameDraft(displayName);
    setShowRenameModal(true);
  };

  const handleRenameSubmit = () => {
    const trimmed = renameDraft.trim();
    if (trimmed && trimmed !== displayName) {
      // Folders don't have .md extension
      const newName = file.isFolder ? trimmed : `${trimmed}.md`;
      renameFile(file.id, newName);
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

  // Drag and drop handlers
  const handleDragStart = (e: MouseEvent | TouchEvent | PointerEvent) => {
    if (file.isFolder) return; // Folders can't be dragged
    const de = e as unknown as DragEvent;
    if (de.dataTransfer) {
      de.dataTransfer.effectAllowed = "move";
      de.dataTransfer.setData("text/plain", file.id);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!file.isFolder) return; // Only folders can receive drops
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

  // Render folder card differently from file card
  if (file.isFolder) {
    return (
      <>
        <motion.div
          className="group relative cursor-pointer"
          onClick={handleOpen}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenuPos({ x: e.clientX, y: e.clientY });
            setDropdownOpen(true);
          }}
          onHoverStart={() => setIsHovering(true)}
          onHoverEnd={() => setIsHovering(false)}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          whileHover={{ y: -4 }}
          whileTap={{ scale: 0.97 }}
        >
          <div
            className={cn(
              "relative flex min-h-[200px] flex-col rounded-2xl border bg-card p-5",
              "border-border/50 transition-all duration-300",
              "hover:border-border hover:shadow-lg hover:shadow-black/[0.04]",
              "dark:hover:shadow-black/[0.15]",
              isDragOver && "border-amber-400/50 ring-2 ring-amber-400/30 dark:ring-amber-500/25"
            )}
          >
            {/* Menu - top right */}
            <div
              className="absolute right-2 top-2 z-[2] flex-shrink-0 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
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
                    className="h-7 w-7 rounded-md"
                    aria-label="Folder options"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setShowShareDialog(true)}>
                    <Share2 className="mr-2 h-4 w-4" />
                    Share
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleRenameOpen}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Rename
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

            {/* Folder icon - large and centered */}
            <div className="flex flex-1 items-center justify-center pb-4 pt-6">
              {isHovering ? (
                <FolderOpen
                  className="h-16 w-16 text-amber-500/70 transition-all dark:text-amber-400/60"
                  strokeWidth={1.5}
                />
              ) : (
                <Folder
                  className="h-16 w-16 text-amber-500/70 transition-all dark:text-amber-400/60"
                  strokeWidth={1.5}
                />
              )}
            </div>

            {/* Content area */}
            <div className="flex flex-col">
              {/* Title */}
              <h3 className="line-clamp-2 text-sm font-semibold leading-snug tracking-tight text-foreground/90">
                {displayName}
              </h3>

              {/* Footer: file count + date */}
              <div className="mt-auto flex items-center justify-between pt-4">
                <span className="text-xs tracking-wide text-foreground/45 dark:text-foreground/55">
                  {folderFileCount === 0
                    ? "Empty"
                    : folderFileCount === 1
                      ? "1 file"
                      : `${folderFileCount} files`}
                </span>
                <span className="text-xs text-foreground/40 dark:text-foreground/50">
                  {formatRelativeDate(file.updatedAt)}
                </span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Rename modal */}
        <Modal open={showRenameModal} onClose={() => setShowRenameModal(false)}>
          <ModalHeader>Rename Folder</ModalHeader>
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
          <ModalHeader>Delete Folder</ModalHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete &quot;{displayName}&quot;? This will also delete all
            files inside. This action cannot be undone.
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
          fileName={file.name}
          isFolder
        />
      </>
    );
  }

  // Regular file card rendering
  return (
    <>
      <motion.div
        className="group relative cursor-pointer"
        data-onboarding="file-card"
        onClick={handleOpen}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenuPos({ x: e.clientX, y: e.clientY });
          setDropdownOpen(true);
        }}
        draggable={true}
        onDragStart={handleDragStart}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        whileHover={{ y: -4 }}
        whileTap={{ scale: 0.98 }}
      >
        <div
          className={cn(
            "relative flex h-full min-h-[200px] flex-col rounded-2xl border bg-card p-5",
            "border-border/50 transition-all duration-300",
            "hover:border-border hover:shadow-lg hover:shadow-black/[0.04]",
            "dark:hover:shadow-black/[0.15]"
          )}
        >
          {/* Relevance badge — search mode only */}
          {searchMatch && (
            <div className="absolute left-3 top-3 z-[2]">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide",
                  searchMatch.score >= 70
                    ? "bg-emerald-100/80 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                    : searchMatch.score >= 40
                      ? "bg-amber-100/80 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      : "bg-muted text-muted-foreground dark:bg-neutral-800/50 dark:text-neutral-400"
                )}
              >
                {searchMatch.score}%
              </span>
            </div>
          )}

          {/* Title + menu */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight text-foreground">
              {displayName}
            </h3>

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
                    className="h-7 w-7 rounded-md"
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

          {/* Preview text */}
          <p className="mt-2 line-clamp-4 flex-1 text-[13px] leading-relaxed text-muted-foreground">
            {searchMatch?.snippet ? (
              <span className="text-foreground/55 dark:text-foreground/65">
                {highlightQuery(searchMatch.snippet, searchMatch.query)}
              </span>
            ) : preview ? (
              preview
            ) : (
              <span className="italic text-muted-foreground/50">Empty document</span>
            )}
          </p>

          {/* Footer: date + word count */}
          <div className="mt-auto flex items-center justify-between border-t border-border/40 pt-4">
            <span className="text-xs text-muted-foreground/60">
              {formatRelativeDate(file.updatedAt)}
            </span>
            <span className="text-xs text-muted-foreground/60">{formatWordCount(wordCount)}</span>
          </div>
        </div>
      </motion.div>

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
      />
    </>
  );
}
