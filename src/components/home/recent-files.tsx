"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Star, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { cn, formatRelativeDate } from "@/lib/utils";
import { stripHtml, getWordCount, formatWordCount } from "@/lib/file-utils";
import { toast } from "sonner";

const PAPER_SHADOW =
  "0 1px 2px rgba(0,0,0,0.04), 0 2px 4px rgba(0,0,0,0.03), 0 4px 8px rgba(0,0,0,0.025), inset 0 0.5px 0 rgba(255,255,255,0.04)";

interface RecentFilesProps {
  files: FileItem[];
}

export function RecentFiles({ files }: RecentFilesProps) {
  const router = useRouter();
  const { setCurrentFile } = useFileStore();

  if (files.length === 0) return null;

  const handleOpen = (file: FileItem) => {
    setCurrentFile(file.id);
    router.push(`/editor/${file.id}`);
  };

  return (
    <motion.div
      data-onboarding="recent-files"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <h2 className="mb-3.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60 dark:text-muted-foreground/70">
        Continue writing
      </h2>

      <div className="grid gap-2.5 sm:grid-cols-3">
        {files.map((file, index) => (
          <RecentTile key={file.id} file={file} index={index} onOpen={handleOpen} />
        ))}
      </div>
    </motion.div>
  );
}

function RecentTile({
  file,
  index,
  onOpen,
}: {
  file: FileItem;
  index: number;
  onOpen: (file: FileItem) => void;
}) {
  const { toggleFavorite, deleteFile } = useFileStore();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const wordCount = getWordCount(file.content);
  const preview = stripHtml(file.content).slice(0, 80);

  const handleDelete = async () => {
    try {
      await deleteFile(file.id);
    } catch {
      toast.error("Failed to delete file");
    }
    setShowDeleteModal(false);
  };

  return (
    <>
      <motion.div
        className="group relative flex cursor-pointer gap-3 rounded-lg border border-stone-200/40 bg-[#fdfcfa] px-4 py-3.5 dark:border-neutral-700/25 dark:bg-[#1e1e20] sm:items-center sm:py-3"
        style={{ boxShadow: PAPER_SHADOW }}
        initial={{ opacity: 0, y: 8 }}
        animate={{
          opacity: 1,
          y: 0,
          transition: { duration: 0.4, delay: 0.05 * index, ease: [0.16, 1, 0.3, 1] },
        }}
        whileHover={{ y: -1, transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } }}
        whileTap={{ scale: 0.98 }}
        onClick={() => onOpen(file)}
      >
        {/* Mobile: stacked layout with content preview */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/85">
              {file.name?.replace(/\.md$/i, "") || "Untitled"}
            </h3>
            {/* Desktop-only inline metadata */}
            <span className="hidden flex-shrink-0 text-xs tracking-wide text-foreground/45 dark:text-foreground/55 sm:inline">
              {formatRelativeDate(file.updatedAt)}
            </span>
            <span className="hidden flex-shrink-0 text-xs text-foreground/40 dark:text-foreground/50 sm:inline">
              {formatWordCount(wordCount)}
            </span>
          </div>
          {/* Mobile content preview */}
          <p className="mt-1 line-clamp-1 text-[13px] text-foreground/40 dark:text-foreground/50 sm:hidden">
            {preview || <span className="italic text-foreground/25">Empty document</span>}
          </p>
          {/* Mobile metadata row */}
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground/50 dark:text-muted-foreground/60 sm:hidden">
            <span>{formatRelativeDate(file.updatedAt)}</span>
            {wordCount > 0 && (
              <>
                <span className="text-muted-foreground/30">·</span>
                <span>{formatWordCount(wordCount)}</span>
              </>
            )}
          </div>
        </div>

        {/* Options menu */}
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
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => toggleFavorite(file.id)}>
                <Star
                  className={cn("mr-2 h-4 w-4", file.isFavorite && "fill-amber-500 text-amber-500")}
                />
                {file.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
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
      </motion.div>

      {/* Delete confirmation */}
      <Modal open={showDeleteModal} onClose={() => setShowDeleteModal(false)}>
        <ModalHeader>Delete File</ModalHeader>
        <p className="text-sm text-muted-foreground">
          Are you sure you want to delete &quot;{file.name || "Untitled"}&quot;? This action cannot
          be undone.
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
