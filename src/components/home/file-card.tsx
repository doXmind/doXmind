"use client";

import { useRef, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  MoreHorizontal,
  Pencil,
  Share2,
  FileDown,
  Trash2,
  Folder,
  FolderOpen,
  FolderInput,
  Home,
  Star,
  Check,
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
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { ShareDialog } from "@/components/share/share-dialog";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { api } from "@/lib/api";
import { markdownToPlainText } from "@/lib/markdown";
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
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const {
    files,
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
  const preview = useMemo(
    () => (file.preview ? markdownToPlainText(file.preview) : ""),
    [file.preview]
  );
  const wordCount = file.wordCount;
  const folderFileCount = file.isFolder ? getFilesInFolder(file.id).length : 0;
  const folders = files.filter((f) => f.isFolder && f.id !== file.id);

  const handleMoveTo = async (folderId: string | null) => {
    if (folderId === file.parentId) return;
    try {
      await moveFileToFolder(file.id, folderId);
      toast.success(folderId ? t("fileMovedToFolder") : t("fileMovedToRoot"));
    } catch {
      toast.error(t("failedToMoveFile"));
    }
  };

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
      toast.error(t("failedToDeleteFile"));
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
        toast.success(t("fileMovedToFolder"));
      } catch {
        toast.error(t("failedToMoveFile"));
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
              "relative flex min-h-[200px] flex-col overflow-hidden rounded-2xl border bg-card",
              "border-border/50 transition-all duration-300",
              "hover:border-border hover:shadow-lg hover:shadow-black/[0.04]",
              "dark:hover:shadow-black/[0.15]",
              isDragOver &&
                "border-amber-400/50 bg-amber-50/30 ring-2 ring-amber-400/30 dark:bg-amber-900/10 dark:ring-amber-500/25"
            )}
          >
            {/* Menu - top right */}
            <div
              className="absolute right-2 top-3 z-[2] flex-shrink-0 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
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
                    aria-label={t("folderOptions")}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setShowShareDialog(true)}>
                    <Share2 className="mr-2 h-4 w-4" />
                    {t("share")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleRenameOpen}>
                    <Pencil className="mr-2 h-4 w-4" />
                    {t("rename")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setShowDeleteModal(true)}
                    className="text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {tc("delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Folder icon - large and centered */}
            <div className="flex flex-1 items-center justify-center pb-4 pt-4">
              <div className="relative">
                {isHovering ? (
                  <FolderOpen
                    className="h-14 w-14 text-amber-500/70 transition-all dark:text-amber-400/60"
                    strokeWidth={1.5}
                  />
                ) : (
                  <Folder
                    className="h-14 w-14 text-amber-500/70 transition-all dark:text-amber-400/60"
                    strokeWidth={1.5}
                  />
                )}
                {folderFileCount > 0 && (
                  <span className="absolute -right-1 -top-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-400">
                    {folderFileCount}
                  </span>
                )}
              </div>
            </div>

            {/* Content area */}
            <div className="flex flex-col px-5 pb-4">
              {/* Title */}
              <h3 className="line-clamp-2 text-sm font-semibold leading-snug tracking-tight text-foreground/90">
                {displayName}
              </h3>

              {/* Footer: file count + date */}
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs tracking-wide text-foreground/45 dark:text-foreground/55">
                  {folderFileCount === 0
                    ? t("empty")
                    : folderFileCount === 1
                      ? t("oneFile")
                      : t("nFiles", { count: folderFileCount })}
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
          <ModalHeader>{t("renameFolder")}</ModalHeader>
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
              {tc("cancel")}
            </Button>
            <Button onClick={handleRenameSubmit} disabled={!renameDraft.trim()}>
              {t("rename")}
            </Button>
          </ModalFooter>
        </Modal>

        {/* Delete confirmation */}
        <Modal open={showDeleteModal} onClose={() => setShowDeleteModal(false)}>
          <ModalHeader>{t("deleteFolder")}</ModalHeader>
          <p className="text-sm text-muted-foreground">
            {t("deleteFolderConfirm", { name: displayName })}
          </p>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setShowDeleteModal(false)}>
              {tc("cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {tc("delete")}
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
            "relative flex h-full min-h-[200px] flex-col overflow-hidden rounded-2xl border bg-card",
            "border-border/50 transition-all duration-300",
            "hover:border-border hover:shadow-lg hover:shadow-black/[0.04]",
            "dark:hover:shadow-black/[0.15]"
          )}
        >
          {/* Accent bar — amber for favorites, subtle for regular */}
          <div
            className={cn(
              "h-[1px] w-full",
              file.isFavorite ? "bg-amber-400/60 dark:bg-amber-500/40" : "bg-border/30"
            )}
          />

          {/* Favorite star badge */}
          {file.isFavorite && !searchMatch && (
            <div className="absolute right-2.5 top-2.5 z-[1]">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            </div>
          )}

          {/* Inner content with padding */}
          <div className="flex flex-1 flex-col p-5 pt-4">
            {/* Relevance badge — search mode only */}
            {searchMatch && (
              <div className="mb-1.5">
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
                      aria-label={t("fileOptions")}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleRenameOpen}>
                      <Pencil className="mr-2 h-4 w-4" />
                      {t("rename")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setShowShareDialog(true)}>
                      <Share2 className="mr-2 h-4 w-4" />
                      {t("share")}
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
                      {file.isFavorite ? t("removeFromFavorites") : t("addToFavorites")}
                    </DropdownMenuItem>
                    {!file.isFolder && (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <FolderInput className="mr-2 h-4 w-4" />
                          {t("moveTo")}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem onClick={() => handleMoveTo(null)}>
                            <Home className="mr-2 h-4 w-4" />
                            {t("root")}
                            {file.parentId === null && (
                              <Check className="ml-auto h-3.5 w-3.5 text-primary" />
                            )}
                          </DropdownMenuItem>
                          {folders.length > 0 && <DropdownMenuSeparator />}
                          {folders.map((folder) => (
                            <DropdownMenuItem
                              key={folder.id}
                              onClick={() => handleMoveTo(folder.id)}
                            >
                              <Folder className="mr-2 h-4 w-4 text-amber-500/70" />
                              {folder.name}
                              {file.parentId === folder.id && (
                                <Check className="ml-auto h-3.5 w-3.5 text-primary" />
                              )}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-muted-foreground">
                      {t("exportAs")}
                    </DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => handleExport("markdown")}>
                      <FileDown className="mr-2 h-4 w-4" />
                      {t("markdownFormat")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExport("pdf")}>
                      <FileDown className="mr-2 h-4 w-4" />
                      {t("pdfFormat")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExport("docx")}>
                      <FileDown className="mr-2 h-4 w-4" />
                      {t("wordFormat")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setShowDeleteModal(true)}
                      className="text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {tc("delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Preview text */}
            <p className="mt-2 line-clamp-5 flex-1 text-[13px] leading-relaxed text-muted-foreground">
              {searchMatch?.snippet ? (
                <span className="text-foreground/55 dark:text-foreground/65">
                  {highlightQuery(searchMatch.snippet, searchMatch.query)}
                </span>
              ) : preview ? (
                preview
              ) : (
                <span className="italic text-muted-foreground/50">{t("emptyDocument")}</span>
              )}
            </p>

            {/* Footer: date + word count */}
            <div className="mt-auto flex items-center justify-between border-t border-border/30 pt-3">
              <span className="text-[11px] text-muted-foreground/55">
                {formatRelativeDate(file.updatedAt)}
              </span>
              <span className="text-[11px] text-muted-foreground/55">
                {formatWordCount(wordCount)}
              </span>
            </div>
          </div>
          {/* end inner padding */}
        </div>
      </motion.div>

      {/* Rename modal */}
      <Modal open={showRenameModal} onClose={() => setShowRenameModal(false)}>
        <ModalHeader>{t("renameDocument")}</ModalHeader>
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
            {tc("cancel")}
          </Button>
          <Button onClick={handleRenameSubmit} disabled={!renameDraft.trim()}>
            {t("rename")}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Delete confirmation */}
      <Modal open={showDeleteModal} onClose={() => setShowDeleteModal(false)}>
        <ModalHeader>{t("deleteFile")}</ModalHeader>
        <p className="text-sm text-muted-foreground">
          {t("deleteFileConfirm", { name: displayName })}
        </p>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setShowDeleteModal(false)}>
            {tc("cancel")}
          </Button>
          <Button variant="destructive" onClick={handleDelete}>
            {tc("delete")}
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
