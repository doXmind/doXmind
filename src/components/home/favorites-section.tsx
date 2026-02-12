"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star, MoreHorizontal, Trash2 } from "lucide-react";
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
import { formatRelativeDate } from "@/lib/utils";
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

interface FavoritesSectionProps {
  favorites: FileItem[];
}

export function FavoritesSection({ favorites }: FavoritesSectionProps) {
  const router = useRouter();
  const { setCurrentFile } = useFileStore();

  if (favorites.length === 0) return null;

  const handleOpen = (file: FileItem) => {
    setCurrentFile(file.id);
    router.push(`/editor/${file.id}`);
  };

  return (
    <motion.div
      data-onboarding="favorites-section"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      <h2 className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-muted-foreground/50">
        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
        Favorites
      </h2>

      <div className="flex gap-4 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: "touch" }}>
        {favorites.map((file, index) => (
          <FavoriteTile key={file.id} file={file} index={index} onOpen={handleOpen} />
        ))}
      </div>
    </motion.div>
  );
}

function FavoriteTile({
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
  const preview = stripHtml(file.content).slice(0, 80);
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
        className="group relative min-w-[200px] max-w-[280px] flex-shrink-0 cursor-pointer rounded-lg border border-stone-200/40 bg-[#fdfcfa] p-4 dark:border-neutral-700/25 dark:bg-[#1e1e20] sm:min-w-0 sm:flex-1"
        style={{ boxShadow: PAPER_SHADOW }}
        initial={{ opacity: 0, y: 8 }}
        animate={{
          opacity: 1,
          y: 0,
          transition: { duration: 0.4, delay: 0.05 * index, ease: [0.16, 1, 0.3, 1] },
        }}
        whileHover={{ y: -2, scale: 1.02, transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } }}
        whileTap={{ scale: 0.98 }}
        onClick={() => onOpen(file)}
      >
        {/* Options menu */}
        <div
          className="absolute right-1.5 top-1.5 z-[2] opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-md"
                aria-label="File options"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => toggleFavorite(file.id)}>
                <Star className="mr-2 h-4 w-4 fill-amber-500 text-amber-500" />
                Remove from Favorites
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

        <h3 className="truncate pr-5 font-serif text-sm font-bold leading-snug tracking-tight text-foreground/85">
          {file.name || "Untitled"}
        </h3>
        <p className="mt-1.5 truncate text-xs leading-relaxed text-foreground/30">
          {preview || <span className="italic">No content yet</span>}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10px] tracking-wide text-foreground/25">
            {formatRelativeDate(file.updatedAt)}
          </span>
          <span className="text-[10px] text-foreground/20">{formatWordCount(wordCount)}</span>
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
