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
import { toast } from "sonner";

const PAPER_SHADOW =
  "0 1px 2px rgba(0,0,0,0.04), 0 2px 4px rgba(0,0,0,0.03), 0 4px 8px rgba(0,0,0,0.025), inset 0 0.5px 0 rgba(255,255,255,0.04)";

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/&nbsp;/g, " ")
    .trim();
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
        className="group relative flex cursor-pointer items-center gap-3 rounded-lg border border-stone-200/40 bg-[#fdfcfa] px-4 py-3 dark:border-neutral-700/25 dark:bg-[#1e1e20]"
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
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/85">
          {file.name?.replace(/\.md$/i, "") || "Untitled"}
        </h3>
        <span className="flex-shrink-0 text-xs tracking-wide text-foreground/45 dark:text-foreground/55">
          {formatRelativeDate(file.updatedAt)}
        </span>
        <span className="flex-shrink-0 text-xs text-foreground/40 dark:text-foreground/50">
          {formatWordCount(wordCount)}
        </span>

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
