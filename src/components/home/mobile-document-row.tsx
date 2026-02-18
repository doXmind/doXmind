"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Star, Share2, Trash2, Folder } from "lucide-react";
import { motion, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { cn, formatRelativeDate } from "@/lib/utils";
import {
  stripHtml,
  getWordCount,
  formatWordCount,
  getNameWithoutExtension,
} from "@/lib/file-utils";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { ShareDialog } from "@/components/share/share-dialog";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { haptics } from "@/lib/haptics";
import { toast } from "sonner";

interface MobileDocumentRowProps {
  file: FileItem;
  searchMatch?: { snippet: string; score: number; query: string };
}

const SWIPE_THRESHOLD = 80;
const ACTION_WIDTH = 80;
const DELETE_ACTION_WIDTH = 160;

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

export function MobileDocumentRow({ file, searchMatch }: MobileDocumentRowProps) {
  const router = useRouter();
  const { setCurrentFile, deleteFile, toggleFavorite, setCurrentFolder, getFilesInFolder } =
    useFileStore();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [isActionsRevealed, setIsActionsRevealed] = useState(false);

  const x = useMotionValue(0);
  const hasTriggeredHapticRef = useRef(false);
  const hasTriggeredLeftHapticRef = useRef(false);

  const displayName = file.isFolder ? file.name : getNameWithoutExtension(file.name);
  const preview = stripHtml(file.content).slice(0, 100);
  const wordCount = getWordCount(file.content);
  const folderFileCount = file.isFolder ? getFilesInFolder(file.id).length : 0;

  // Swipe right: favorite indicator opacity
  const favoriteOpacity = useTransform(x, [0, SWIPE_THRESHOLD], [0, 1]);
  const favoriteScale = useTransform(x, [0, SWIPE_THRESHOLD], [0.5, 1]);

  // Swipe left: action buttons opacity
  const actionsOpacity = useTransform(x, [-ACTION_WIDTH, 0], [1, 0]);

  const handleOpen = useCallback(() => {
    if (isActionsRevealed) {
      setIsActionsRevealed(false);
      return;
    }
    if (file.isFolder) {
      setCurrentFolder(file.id);
      return;
    }
    setCurrentFile(file.id);
    router.push(`/editor/${file.id}`);
  }, [file, router, setCurrentFile, setCurrentFolder, isActionsRevealed]);

  const handleDrag = useCallback((_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    // Haptic feedback when crossing the right swipe threshold
    if (info.offset.x > SWIPE_THRESHOLD && !hasTriggeredHapticRef.current) {
      hasTriggeredHapticRef.current = true;
      haptics.tick();
    } else if (info.offset.x <= SWIPE_THRESHOLD) {
      hasTriggeredHapticRef.current = false;
    }

    // Haptic feedback when crossing the left swipe threshold
    if (info.offset.x < -ACTION_WIDTH && !hasTriggeredLeftHapticRef.current) {
      hasTriggeredLeftHapticRef.current = true;
      haptics.tick();
    } else if (info.offset.x >= -ACTION_WIDTH) {
      hasTriggeredLeftHapticRef.current = false;
    }
  }, []);

  const handleDragEnd = useCallback(
    (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      hasTriggeredHapticRef.current = false;
      hasTriggeredLeftHapticRef.current = false;

      // Swipe right: toggle favorite
      if (info.offset.x > SWIPE_THRESHOLD || (info.offset.x > 40 && info.velocity.x > 300)) {
        toggleFavorite(file.id);
        haptics.success();
        return;
      }

      // Swipe left: reveal action buttons
      if (info.offset.x < -ACTION_WIDTH || (info.offset.x < -40 && info.velocity.x < -300)) {
        setIsActionsRevealed(true);
        return;
      }

      // Not enough swipe — snap back
      setIsActionsRevealed(false);
    },
    [file.id, toggleFavorite]
  );

  const handleDelete = async () => {
    try {
      await deleteFile(file.id);
      haptics.success();
    } catch {
      toast.error("Failed to delete file");
    }
    setShowDeleteModal(false);
  };

  const handleShare = () => {
    setIsActionsRevealed(false);
    setShowShareDialog(true);
  };

  const handleDeleteTap = () => {
    setIsActionsRevealed(false);
    setShowDeleteModal(true);
    haptics.light();
  };

  return (
    <>
      <div className="relative overflow-hidden will-change-transform">
        {/* Left action (swipe right to reveal): Favorite */}
        <motion.div
          className="absolute inset-y-0 left-0 flex items-center justify-center px-6"
          style={{
            opacity: favoriteOpacity,
            backgroundColor: file.isFavorite ? "rgb(234 179 8 / 0.15)" : "rgb(234 179 8 / 0.1)",
          }}
        >
          <motion.div style={{ scale: favoriteScale }}>
            <Star
              className={cn(
                "h-5 w-5",
                file.isFavorite ? "fill-amber-500 text-amber-500" : "text-amber-500"
              )}
            />
          </motion.div>
        </motion.div>

        {/* Right actions (swipe left to reveal): Share, Delete */}
        <motion.div
          className="absolute inset-y-0 right-0 flex items-stretch"
          style={{ opacity: actionsOpacity }}
        >
          <button
            onClick={handleShare}
            className="flex w-20 items-center justify-center bg-blue-500 text-white active:bg-blue-600"
            aria-label="Share"
          >
            <Share2 className="h-5 w-5" />
          </button>
          <button
            onClick={handleDeleteTap}
            className="flex w-20 items-center justify-center bg-red-500 text-white active:bg-red-600"
            aria-label="Delete"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        </motion.div>

        {/* Draggable foreground row */}
        <motion.div
          className={cn(
            "relative z-10 flex cursor-pointer items-start gap-3 bg-background px-5 py-3.5",
            "active:bg-accent/30"
          )}
          drag="x"
          dragDirectionLock
          dragConstraints={{ left: -DELETE_ACTION_WIDTH, right: SWIPE_THRESHOLD }}
          dragElastic={{ left: 0.05, right: 0.1 }}
          dragMomentum={false}
          style={{ x }}
          animate={isActionsRevealed ? { x: -DELETE_ACTION_WIDTH } : { x: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 40, mass: 0.5 }}
          onDrag={handleDrag}
          onDragEnd={handleDragEnd}
          onClick={handleOpen}
        >
          {/* Icon */}
          {file.isFolder ? (
            <Folder
              className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500/70 dark:text-amber-400/60"
              strokeWidth={1.5}
            />
          ) : (
            <div className="relative mt-0.5 h-5 w-4 flex-shrink-0">
              <div className="absolute inset-0 translate-x-[1px] translate-y-[1px] rounded-[1px] border border-stone-200/40 bg-stone-100/50 dark:border-neutral-700/20 dark:bg-neutral-700/15" />
              <div className="absolute inset-0 rounded-[1px] border border-stone-200/50 bg-[#fdfcfa] dark:border-neutral-700/30 dark:bg-[#1e1e20]" />
            </div>
          )}

          {/* Content */}
          <div className="min-w-0 flex-1">
            {/* Title row */}
            <div className="flex items-center gap-1.5">
              {file.isFavorite && !file.isFolder && (
                <Star className="h-3 w-3 flex-shrink-0 fill-amber-400 text-amber-400" />
              )}
              <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-snug text-foreground/90">
                {displayName}
              </h3>
              {/* Search score badge */}
              {searchMatch && (
                <span
                  className={cn(
                    "flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                    searchMatch.score >= 70
                      ? "bg-emerald-100/80 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                      : searchMatch.score >= 40
                        ? "bg-amber-100/80 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                        : "bg-stone-100/80 text-stone-500 dark:bg-neutral-800/50 dark:text-neutral-400"
                  )}
                >
                  {searchMatch.score}%
                </span>
              )}
            </div>

            {/* Content preview */}
            <p className="mt-0.5 line-clamp-1 text-[13px] leading-snug text-foreground/40 dark:text-foreground/50">
              {searchMatch?.snippet ? (
                <span className="text-foreground/55 dark:text-foreground/65">
                  {highlightQuery(searchMatch.snippet, searchMatch.query)}
                </span>
              ) : file.isFolder ? (
                folderFileCount === 0 ? (
                  "Empty folder"
                ) : folderFileCount === 1 ? (
                  "1 file"
                ) : (
                  `${folderFileCount} files`
                )
              ) : preview ? (
                preview
              ) : (
                <span className="italic text-foreground/25 dark:text-foreground/35">
                  Empty document
                </span>
              )}
            </p>

            {/* Metadata row */}
            <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground/50 dark:text-muted-foreground/60">
              <span>{formatRelativeDate(file.updatedAt)}</span>
              {!file.isFolder && wordCount > 0 && (
                <>
                  <span className="text-muted-foreground/30">·</span>
                  <span>{formatWordCount(wordCount)}</span>
                </>
              )}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Delete confirmation */}
      <Modal open={showDeleteModal} onClose={() => setShowDeleteModal(false)}>
        <ModalHeader>Delete {file.isFolder ? "Folder" : "File"}</ModalHeader>
        <p className="text-sm text-muted-foreground">
          Are you sure you want to delete &quot;{displayName}&quot;?
          {file.isFolder && " This will also delete all files inside."} This action cannot be
          undone.
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
