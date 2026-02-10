"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Share2, FileDown, Trash2, Folder, FolderOpen } from "lucide-react";
import { motion } from "framer-motion";
import { cn, formatDate } from "@/lib/utils";
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

// SVG fractal noise for paper grain texture
const PAPER_GRAIN = `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

// Layered shadow for resting paper
const PAPER_SHADOW = [
  "0 1px 1px rgba(0,0,0,0.04)",
  "0 2px 2px rgba(0,0,0,0.03)",
  "0 4px 4px rgba(0,0,0,0.025)",
  "0 8px 8px rgba(0,0,0,0.02)",
  "inset 0 0 0 0.5px rgba(0,0,0,0.04)",
].join(",");

// Predefined scatter transforms — like papers casually dropped on a desk
const SCATTER = [
  { rotate: -1.8, y: 0 },
  { rotate: 1.2, y: 2 },
  { rotate: -0.6, y: -1 },
  { rotate: 2.0, y: 1 },
  { rotate: -1.2, y: -2 },
  { rotate: 0.5, y: 3 },
  { rotate: -2.2, y: 0 },
  { rotate: 1.5, y: -1 },
  { rotate: -0.3, y: 2 },
  { rotate: 1.8, y: -3 },
];

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getNameWithoutExtension(name: string) {
  return name.replace(/\.md$/, "");
}

function getWordCount(content: string): number {
  const text = stripHtml(content);
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function formatWordCount(count: number): string {
  if (count === 0) return "Empty";
  if (count < 1000) return `${count} words`;
  return `${(count / 1000).toFixed(1)}k words`;
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
  } = useFileStore();
  const scatter = SCATTER[index % SCATTER.length];
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [isHovering, setIsHovering] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const displayName = file.isFolder ? file.name : getNameWithoutExtension(file.name);
  const preview = stripHtml(file.content).slice(0, 200);
  const wordCount = getWordCount(file.content);
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
    router.push("/editor");
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
      // handled by store
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
      // handled silently
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
      } catch (error) {
        toast.error("Failed to move file");
      }
    }
  };

  // Render folder card differently from file card
  if (file.isFolder) {
    return (
      <>
        <motion.div
          className="group relative cursor-pointer pb-1.5"
          onClick={handleOpen}
          onHoverStart={() => setIsHovering(true)}
          onHoverEnd={() => setIsHovering(false)}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{ rotate: scatter.rotate, y: scatter.y }}
          whileHover={{
            rotate: 0,
            y: -6,
            scale: 1.02,
            transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
          }}
          whileTap={{ scale: 0.97 }}
        >
          {/* Stacked page (folders have only 1 back page - thinner than files) */}
          <div
            className={cn(
              "absolute inset-x-[2.5px] bottom-[2px] top-[4px] rounded-[2px]",
              "dark:bg-neutral-700/12 bg-stone-100/50",
              "border border-stone-200/20 dark:border-neutral-700/10"
            )}
          />

          {/* Soft ambient glow on hover */}
          <div className="pointer-events-none absolute -inset-4 rounded-3xl bg-foreground/[0.015] opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100 dark:bg-foreground/[0.04]" />

          {/* Folder Card - Paper aesthetic with folder tab accent */}
          <div
            className={cn(
              "relative flex min-h-[230px] flex-col rounded-[3px]",
              "bg-[#fdfcfa] dark:bg-[#1e1e20]",
              "border border-stone-200/50 dark:border-neutral-700/30",
              isDragOver && "border-amber-400/50 ring-2 ring-amber-400/30 dark:ring-amber-500/25"
            )}
            style={{ boxShadow: PAPER_SHADOW }}
          >
            {/* Folder tab - primary distinguishing feature */}
            <div
              className={cn(
                "absolute left-[20px] top-0 h-[6px] w-[80px] rounded-t-[2px]",
                "bg-gradient-to-r from-amber-100/60 via-amber-50/40 to-transparent",
                "dark:from-amber-900/30 dark:via-amber-950/20 dark:to-transparent",
                "border-l border-r border-t border-stone-200/40 dark:border-neutral-700/25",
                "shadow-[0_-1px_3px_rgba(0,0,0,0.03)]"
              )}
            />

            {/* Paper grain texture */}
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.035] dark:opacity-[0.06]"
              style={{
                backgroundImage: PAPER_GRAIN,
                backgroundSize: "200px",
                backgroundRepeat: "repeat",
                mixBlendMode: "multiply",
              }}
            />

            {/* Faint ruled lines */}
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.025] dark:opacity-[0.035]"
              style={{
                backgroundImage: "linear-gradient(to bottom, transparent 95%, currentColor 95%)",
                backgroundSize: "100% 26px",
                backgroundPosition: "0 14px",
              }}
            />

            {/* Folder icon - large and centered */}
            <div className="flex flex-1 items-center justify-center pb-4 pt-10">
              {isHovering ? (
                <FolderOpen
                  className="h-20 w-20 text-amber-500/70 transition-all dark:text-amber-400/60"
                  strokeWidth={1.5}
                />
              ) : (
                <Folder
                  className="h-20 w-20 text-amber-500/70 transition-all dark:text-amber-400/60"
                  strokeWidth={1.5}
                />
              )}
            </div>

            {/* Content area */}
            <div className="relative z-[1] flex flex-col p-5 pt-0">
              {/* Title + menu */}
              <div className="flex items-start justify-between gap-2">
                <h3 className="line-clamp-2 font-serif text-[15px] font-semibold leading-snug tracking-tight text-foreground/85">
                  {displayName}
                </h3>

                <div
                  className="flex-shrink-0 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <DropdownMenu>
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
              </div>

              {/* Footer: file count + date */}
              <div className="mt-auto flex items-center justify-between pt-4">
                <span className="text-[10.5px] tracking-wide text-foreground/30">
                  {folderFileCount === 0
                    ? "Empty"
                    : folderFileCount === 1
                      ? "1 file"
                      : `${folderFileCount} files`}
                </span>
                <span className="text-foreground/18 text-[10.5px]">
                  {formatDate(file.updatedAt)}
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
      </>
    );
  }

  // Regular file card rendering
  return (
    <>
      <motion.div
        className="group relative cursor-pointer pb-1.5"
        onClick={handleOpen}
        draggable={true}
        onDragStart={handleDragStart}
        style={{ rotate: scatter.rotate, y: scatter.y }}
        whileHover={{
          rotate: 0,
          y: -6,
          scale: 1.02,
          transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
        }}
        whileTap={{ scale: 0.98 }}
      >
        {/* Stacked page 2 (furthest back) — peek at bottom */}
        <div
          className={cn(
            "absolute inset-x-[5px] bottom-0 top-[7px] rounded-[2px]",
            "bg-stone-200/40 dark:bg-neutral-700/20",
            "border border-stone-200/30 dark:border-neutral-700/15"
          )}
        />
        {/* Stacked page 1 */}
        <div
          className={cn(
            "absolute inset-x-[2.5px] bottom-[3px] top-[3.5px] rounded-[2px]",
            "bg-stone-100/60 dark:bg-neutral-700/15",
            "border border-stone-200/20 dark:border-neutral-700/10"
          )}
        />

        {/* Soft ambient glow on hover */}
        <div className="pointer-events-none absolute -inset-4 rounded-3xl bg-foreground/[0.015] opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100 dark:bg-foreground/[0.04]" />

        {/* ═══ MAIN PAPER CARD ═══ */}
        <div
          className={cn(
            "relative flex min-h-[230px] flex-col rounded-[3px]",
            // Warm off-white paper — not pure white
            "bg-[#fdfcfa] dark:bg-[#1e1e20]",
            // Thin paper edge
            "border border-stone-200/50 dark:border-neutral-700/30"
          )}
          style={{ boxShadow: PAPER_SHADOW }}
        >
          {/* Paper grain texture */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.035] dark:opacity-[0.06]"
            style={{
              backgroundImage: PAPER_GRAIN,
              backgroundSize: "200px",
              backgroundRepeat: "repeat",
              mixBlendMode: "multiply",
            }}
          />

          {/* Faint ruled lines */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.025] dark:opacity-[0.035]"
            style={{
              backgroundImage: "linear-gradient(to bottom, transparent 95%, currentColor 95%)",
              backgroundSize: "100% 26px",
              backgroundPosition: "0 14px",
            }}
          />

          {/* Red margin line (very subtle, like notebook paper) */}
          <div
            className="pointer-events-none absolute bottom-0 left-[52px] top-0 w-px opacity-[0.06] dark:opacity-[0.05]"
            style={{ backgroundColor: "#c44" }}
          />

          {/* Relevance badge — search mode only */}
          {searchMatch && (
            <div className="absolute left-2 top-2 z-[2]">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide",
                  searchMatch.score >= 70
                    ? "bg-emerald-100/80 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                    : searchMatch.score >= 40
                      ? "bg-amber-100/80 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      : "bg-stone-100/80 text-stone-500 dark:bg-neutral-800/50 dark:text-neutral-400"
                )}
              >
                {searchMatch.score}%
              </span>
            </div>
          )}

          {/* Content area */}
          <div className="relative z-[1] flex flex-1 flex-col p-5 pl-[68px] pt-4">
            {/* Title + menu */}
            <div className="flex items-start justify-between gap-2">
              <h3 className="line-clamp-2 font-serif text-[15px] font-semibold leading-snug tracking-tight text-foreground/85">
                {displayName}
              </h3>

              <div
                className="flex-shrink-0 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <DropdownMenu>
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

            {/* Preview text — like typewritten text on paper */}
            <p className="mt-3 line-clamp-4 flex-1 text-[12.5px] leading-[26px] text-foreground/35">
              {searchMatch?.snippet ? (
                <span className="text-foreground/45">
                  {highlightQuery(searchMatch.snippet, searchMatch.query)}
                </span>
              ) : preview ? (
                preview
              ) : (
                <span className="italic text-foreground/15">Empty document</span>
              )}
            </p>

            {/* Footer: date + word count */}
            <div className="mt-auto flex items-center justify-between pt-3">
              <span className="text-[10.5px] tracking-wide text-foreground/25">
                {formatDate(file.updatedAt)}
              </span>
              <span className="text-foreground/18 text-[10.5px]">{formatWordCount(wordCount)}</span>
            </div>
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
