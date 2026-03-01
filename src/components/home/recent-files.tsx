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
import { useIsMobile } from "@/hooks/use-device-type";
import { cn, formatRelativeDate } from "@/lib/utils";
import { formatWordCount } from "@/lib/file-utils";
import { haptics } from "@/lib/haptics";
import { toast } from "sonner";
import { useSwipeToReveal } from "@/hooks/use-swipe-to-reveal";
import { MOBILE_V2 } from "@/lib/constants";

interface RecentFilesProps {
  files: FileItem[];
  favorites?: FileItem[];
}

export function RecentFiles({ files, favorites = [] }: RecentFilesProps) {
  const router = useRouter();
  const { setCurrentFile } = useFileStore();

  if (files.length === 0) return null;

  const handleOpen = (file: FileItem) => {
    setCurrentFile(file.id);
    router.push(`/editor/${file.id}`);
  };

  // Merge favorites into carousel cards (deduplicate with recents)
  const recentIds = new Set(files.map((f) => f.id));
  const extraFavorites = favorites.filter((f) => !recentIds.has(f.id));
  const carouselFiles = [...files, ...extraFavorites];

  return (
    <motion.div
      data-onboarding="recent-files"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60 dark:text-muted-foreground/70 md:mb-3.5">
        Continue writing
      </h2>

      {/* Mobile: horizontal carousel */}
      <div className="scrollbar-none flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-1 pl-1 md:hidden">
        {carouselFiles.map((file, index) => (
          <RecentCarouselCard key={file.id} file={file} index={index} onOpen={handleOpen} />
        ))}
      </div>

      {/* Desktop: grid */}
      <div className="hidden gap-2.5 md:grid md:grid-cols-3">
        {files.map((file, index) => (
          <RecentTile key={file.id} file={file} index={index} onOpen={handleOpen} />
        ))}
      </div>
    </motion.div>
  );
}

function RecentCarouselCard({
  file,
  index,
  onOpen,
}: {
  file: FileItem;
  index: number;
  onOpen: (f: FileItem) => void;
}) {
  const preview = file.preview;

  return (
    <motion.button
      className={cn(
        "flex w-[152px] flex-shrink-0 snap-start flex-col gap-1.5",
        "rounded-xl border border-border/50 bg-card/80 p-3",
        "text-left active:scale-[0.97] active:bg-accent/30",
        "transition-transform duration-150"
      )}
      initial={{ opacity: 0, x: 20 }}
      animate={{
        opacity: 1,
        x: 0,
        transition: { delay: index * 0.06, duration: 0.35, ease: [0.16, 1, 0.3, 1] },
      }}
      onClick={() => onOpen(file)}
    >
      <div className="flex items-start gap-1.5">
        <h3 className="line-clamp-1 min-w-0 flex-1 text-[13px] font-semibold leading-snug text-foreground/85">
          {file.name?.replace(/\.md$/i, "") || "Untitled"}
        </h3>
        {file.isFavorite && (
          <Star className="mt-0.5 h-3 w-3 flex-shrink-0 fill-amber-500 text-amber-500" />
        )}
      </div>
      <p className="line-clamp-2 text-[12px] leading-relaxed text-foreground/40 dark:text-foreground/50">
        {preview || <span className="italic">Empty document</span>}
      </p>
      <span className="mt-auto text-[11px] text-muted-foreground/50">
        {formatRelativeDate(file.updatedAt)}
      </span>
    </motion.button>
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
  const isMobile = useIsMobile();
  const wordCount = file.wordCount;
  const preview = file.preview;

  const swipe = useSwipeToReveal({
    id: `recent-${file.id}`,
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

  // Shared content (used by both mobile swipe and desktop static)
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
          {/* Right actions: Favorite, Delete */}
          <motion.div
            className="absolute inset-y-0 right-0 flex items-stretch"
            style={{ opacity: swipe.rightActionsOpacity }}
          >
            <button
              onClick={handleFavoriteTap}
              className={cn(
                "flex w-20 items-center justify-center text-white active:opacity-80",
                file.isFavorite ? "bg-amber-500" : "bg-amber-500/80"
              )}
              aria-label={file.isFavorite ? "Remove from favorites" : "Add to favorites"}
            >
              <Star className={cn("h-5 w-5", file.isFavorite && "fill-white")} />
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
                  <Star
                    className={cn(
                      "mr-2 h-4 w-4",
                      file.isFavorite && "fill-amber-500 text-amber-500"
                    )}
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
