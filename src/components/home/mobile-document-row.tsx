"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Star, Share2, Trash2, Folder, FileText, FolderInput } from "lucide-react";
import { motion } from "framer-motion";
import { cn, formatRelativeDate } from "@/lib/utils";
import { getNameWithoutExtension } from "@/lib/file-utils";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { ShareDialog } from "@/components/share/share-dialog";
import { MoveToFolderSheet } from "@/components/home/move-to-folder-sheet";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { haptics } from "@/lib/haptics";
import { toast } from "sonner";
import { useSwipeToReveal } from "@/hooks/use-swipe-to-reveal";
import { MOBILE_V2 } from "@/lib/constants";
import { MobileContextMenu } from "./mobile-context-menu";

interface MobileDocumentRowProps {
  file: FileItem;
  searchMatch?: { snippet: string; score: number; query: string };
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

export function MobileDocumentRow({ file, searchMatch }: MobileDocumentRowProps) {
  const router = useRouter();
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const { setCurrentFile, deleteFile, toggleFavorite, setCurrentFolder, getFilesInFolder } =
    useFileStore();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showMoveSheet, setShowMoveSheet] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);

  // Long-press detection
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handlePointerDown = useCallback(() => {
    didLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      haptics.light();
      setShowContextMenu(true);
    }, 500);
  }, []);

  const handlePointerUp = useCallback(() => {
    clearLongPress();
  }, [clearLongPress]);

  const handlePointerMove = useCallback(() => {
    clearLongPress();
  }, [clearLongPress]);

  const displayName = file.isFolder ? file.name : getNameWithoutExtension(file.name);
  const folderFileCount = file.isFolder ? getFilesInFolder(file.id).length : 0;

  const swipe = useSwipeToReveal({
    id: file.id,
    rightActionWidth: file.isFolder
      ? MOBILE_V2.ROW_SWIPE.TRIPLE_ACTION_WIDTH
      : MOBILE_V2.ROW_SWIPE.QUAD_ACTION_WIDTH,
  });

  const handleOpen = useCallback(() => {
    if (didLongPress.current) return;
    if (swipe.isRevealed) {
      swipe.close();
      return;
    }
    if (file.isFolder) {
      setCurrentFolder(file.id);
      return;
    }
    setCurrentFile(file.id);
    router.push(`/editor/${file.id}`);
  }, [file, router, setCurrentFile, setCurrentFolder, swipe]);

  const handleDelete = async () => {
    try {
      await deleteFile(file.id);
      haptics.success();
    } catch {
      toast.error(t("failedToDeleteFile"));
    }
    setShowDeleteModal(false);
  };

  const handleFavoriteTap = () => {
    swipe.close();
    toggleFavorite(file.id);
    haptics.success();
  };

  const handleShare = () => {
    swipe.close();
    setShowShareDialog(true);
  };

  const handleMoveTap = () => {
    swipe.close();
    setShowMoveSheet(true);
  };

  const handleDeleteTap = () => {
    swipe.close();
    setShowDeleteModal(true);
    haptics.light();
  };

  return (
    <>
      <div className="relative overflow-hidden will-change-transform">
        {/* Right actions (swipe left to reveal): Favorite, Share, Delete */}
        <motion.div
          className="absolute inset-y-0 right-0 flex items-stretch"
          style={{ opacity: swipe.rightActionsOpacity }}
        >
          <button
            onClick={handleFavoriteTap}
            className={cn(
              "flex w-16 items-center justify-center text-white active:opacity-80",
              file.isFavorite ? "bg-amber-500" : "bg-amber-500/80"
            )}
            aria-label={file.isFavorite ? t("removeFromFavorites") : t("addToFavorites")}
          >
            <Star className={cn("h-5 w-5", file.isFavorite && "fill-white")} />
          </button>
          {!file.isFolder && (
            <button
              onClick={handleMoveTap}
              className="flex w-16 items-center justify-center bg-violet-500 text-white active:opacity-80"
              aria-label={t("moveTo")}
            >
              <FolderInput className="h-5 w-5" />
            </button>
          )}
          <button
            onClick={handleShare}
            className="flex w-16 items-center justify-center bg-blue-500 text-white active:opacity-80"
            aria-label={t("share")}
          >
            <Share2 className="h-5 w-5" />
          </button>
          <button
            onClick={handleDeleteTap}
            className="flex w-16 items-center justify-center bg-red-500 text-white active:opacity-80"
            aria-label={tc("delete")}
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
          {...swipe.dragProps}
          onClick={handleOpen}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerMove={handlePointerMove}
        >
          {/* Icon */}
          {file.isFolder ? (
            <Folder
              className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500/70 dark:text-amber-400/60"
              strokeWidth={1.5}
            />
          ) : (
            <FileText className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted-foreground/50" />
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

            {/* Content preview - only for search results and folders */}
            {(searchMatch?.snippet || file.isFolder) && (
              <p className="mt-0.5 line-clamp-1 text-[13px] leading-snug text-foreground/40 dark:text-foreground/50">
                {searchMatch?.snippet ? (
                  <span className="text-foreground/55 dark:text-foreground/65">
                    {highlightQuery(searchMatch.snippet, searchMatch.query)}
                  </span>
                ) : folderFileCount === 0 ? (
                  t("emptyFolder")
                ) : folderFileCount === 1 ? (
                  t("oneFile")
                ) : (
                  t("nFiles", { count: folderFileCount })
                )}
              </p>
            )}

            {/* Metadata */}
            <span className="mt-1 block text-[11px] text-muted-foreground/50 dark:text-muted-foreground/60">
              {formatRelativeDate(file.updatedAt)}
            </span>
          </div>
        </motion.div>
      </div>

      {/* Delete confirmation */}
      <Modal open={showDeleteModal} onClose={() => setShowDeleteModal(false)}>
        <ModalHeader>{file.isFolder ? t("deleteFolder") : t("deleteFile")}</ModalHeader>
        <p className="text-sm text-muted-foreground">
          {file.isFolder
            ? t("deleteFolderConfirm", { name: displayName })
            : t("deleteFileConfirm", { name: displayName })}
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
        isFolder={file.isFolder}
      />

      {/* Move to folder sheet */}
      {!file.isFolder && (
        <MoveToFolderSheet
          open={showMoveSheet}
          onClose={() => setShowMoveSheet(false)}
          fileId={file.id}
          currentParentId={file.parentId}
        />
      )}

      {/* Long-press context menu */}
      <MobileContextMenu
        file={file}
        open={showContextMenu}
        onClose={() => setShowContextMenu(false)}
      />
    </>
  );
}
