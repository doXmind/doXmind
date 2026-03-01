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
import { useIsMobile } from "@/hooks/use-device-type";
import { cn, formatRelativeDate } from "@/lib/utils";
import { formatWordCount } from "@/lib/file-utils";
import { haptics } from "@/lib/haptics";
import { toast } from "sonner";
import { useSwipeToReveal } from "@/hooks/use-swipe-to-reveal";
import { MOBILE_V2 } from "@/lib/constants";

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
      <h2 className="mb-3.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60 dark:text-muted-foreground/70">
        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
        Favorites
      </h2>

      <div className="grid gap-2.5 sm:grid-cols-3">
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
  const isMobile = useIsMobile();
  const wordCount = file.wordCount;
  const preview = file.preview;

  const swipe = useSwipeToReveal({
    id: `fav-${file.id}`,
    rightActionWidth: MOBILE_V2.ROW_SWIPE.DOUBLE_ACTION_WIDTH,
  });

  const handleDelete = async () => {
    try {
      await deleteFile(file.id);
    } catch {
      toast.error("Failed to delete file");
    }
    setShowDeleteModal(false);
  };

  const handleFavoriteTap = () => {
    swipe.close();
    toggleFavorite(file.id);
    haptics.success();
  };

  const handleDeleteTap = () => {
    swipe.close();
    setShowDeleteModal(true);
    haptics.light();
  };

  const handleClick = () => {
    if (swipe.isRevealed) {
      swipe.close();
      return;
    }
    onOpen(file);
  };

  // Shared content
  const tileContent = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/85">
            {file.name?.replace(/\.md$/i, "") || "Untitled"}
          </h3>
          <span className="hidden flex-shrink-0 text-xs tracking-wide text-foreground/45 dark:text-foreground/55 sm:inline">
            {formatRelativeDate(file.updatedAt)}
          </span>
          <span className="hidden flex-shrink-0 text-xs text-foreground/40 dark:text-foreground/50 sm:inline">
            {formatWordCount(wordCount)}
          </span>
        </div>
        <p className="mt-1 line-clamp-1 text-[13px] text-foreground/40 dark:text-foreground/50 sm:hidden">
          {preview || <span className="italic text-foreground/25">Empty document</span>}
        </p>
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
    </>
  );

  return (
    <>
      {isMobile ? (
        /* Mobile: swipe-to-reveal actions */
        <motion.div
          className="relative overflow-hidden rounded-xl border border-border/50 will-change-transform"
          initial={{ opacity: 0, y: 8 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { duration: 0.4, delay: 0.05 * index, ease: [0.16, 1, 0.3, 1] },
          }}
        >
          {/* Right actions: Unfavorite, Delete */}
          <motion.div
            className="absolute inset-y-0 right-0 flex items-stretch"
            style={{ opacity: swipe.rightActionsOpacity }}
          >
            <button
              onClick={handleFavoriteTap}
              className="flex w-20 items-center justify-center bg-amber-500 text-white active:opacity-80"
              aria-label="Remove from favorites"
            >
              <Star className="h-5 w-5 fill-white" />
            </button>
            <button
              onClick={handleDeleteTap}
              className="flex w-20 items-center justify-center bg-red-500 text-white active:opacity-80"
              aria-label="Delete"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          </motion.div>

          {/* Draggable row */}
          <motion.div
            className="relative z-10 flex cursor-pointer gap-3 bg-card px-4 py-3.5 active:bg-accent/30"
            {...swipe.dragProps}
            onClick={handleClick}
          >
            {tileContent}
          </motion.div>
        </motion.div>
      ) : (
        /* Desktop: static card with hover dropdown */
        <motion.div
          className="group relative flex cursor-pointer gap-3 rounded-xl border border-border/50 bg-card px-4 py-3.5 transition-all duration-300 hover:border-border hover:shadow-md sm:items-center sm:py-3"
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
          {tileContent}

          <div
            className="flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
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
                  <Star className={cn("mr-2 h-4 w-4 fill-amber-500 text-amber-500")} />
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
        </motion.div>
      )}

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
