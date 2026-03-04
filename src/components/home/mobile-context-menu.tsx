"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ExternalLink, Pencil, Star, Share2, FileDown, FolderInput, Trash2 } from "lucide-react";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { ShareDialog } from "@/components/share/share-dialog";
import { MoveToFolderSheet } from "@/components/home/move-to-folder-sheet";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { haptics } from "@/lib/haptics";
import { toast } from "sonner";
import { getNameWithoutExtension } from "@/lib/file-utils";

interface MobileContextMenuProps {
  file: FileItem | null;
  open: boolean;
  onClose: () => void;
}

export function MobileContextMenu({ file, open, onClose }: MobileContextMenuProps) {
  const router = useRouter();
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const { setCurrentFile, deleteFile, renameFile, toggleFavorite } = useFileStore();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");

  if (!file) return null;

  const displayName = file.isFolder ? file.name : getNameWithoutExtension(file.name);

  const handleOpen = () => {
    onClose();
    setCurrentFile(file.id);
    router.push(`/editor/${file.id}`);
  };

  const handleRenameOpen = () => {
    setRenameDraft(displayName);
    onClose();
    setShowRename(true);
  };

  const handleRenameSubmit = () => {
    const trimmed = renameDraft.trim();
    if (trimmed && trimmed !== displayName) {
      const newName = file.isFolder ? trimmed : `${trimmed}.md`;
      renameFile(file.id, newName);
    }
    setShowRename(false);
  };

  const handleFavorite = () => {
    haptics.success();
    toggleFavorite(file.id);
    onClose();
  };

  const handleShare = () => {
    onClose();
    setShowShare(true);
  };

  const handleMoveOpen = () => {
    onClose();
    setShowMove(true);
  };

  const handleExport = async (format: "markdown" | "pdf" | "docx") => {
    onClose();
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
      toast.error(t("failedToExport", { format: format.toUpperCase() }));
    }
  };

  const handleDeleteConfirm = () => {
    onClose();
    setShowDeleteConfirm(true);
  };

  const handleDelete = async () => {
    try {
      await deleteFile(file.id);
    } catch {
      toast.error(t("failedToDeleteFile"));
    }
    setShowDeleteConfirm(false);
  };

  const actions = [
    ...(file.isFolder
      ? []
      : [
          {
            icon: <ExternalLink className="h-5 w-5" />,
            label: t("open"),
            onClick: handleOpen,
          },
        ]),
    {
      icon: <Pencil className="h-5 w-5" />,
      label: t("rename"),
      onClick: handleRenameOpen,
    },
    {
      icon: <Star className={cn("h-5 w-5", file.isFavorite && "fill-amber-500 text-amber-500")} />,
      label: file.isFavorite ? t("removeFromFavorites") : t("addToFavorites"),
      onClick: handleFavorite,
    },
    {
      icon: <Share2 className="h-5 w-5" />,
      label: t("share"),
      onClick: handleShare,
    },
    ...(file.isFolder
      ? []
      : [
          {
            icon: <FolderInput className="h-5 w-5" />,
            label: t("moveTo"),
            onClick: handleMoveOpen,
          },
        ]),
    ...(file.isFolder
      ? []
      : [
          {
            icon: <FileDown className="h-5 w-5" />,
            label: t("exportAsMarkdown"),
            onClick: () => handleExport("markdown"),
          },
          {
            icon: <FileDown className="h-5 w-5" />,
            label: t("exportAsPdf"),
            onClick: () => handleExport("pdf"),
          },
        ]),
    {
      icon: <Trash2 className="h-5 w-5 text-destructive" />,
      label: tc("delete"),
      onClick: handleDeleteConfirm,
      destructive: true,
    },
  ];

  return (
    <>
      <Modal open={open} onClose={onClose}>
        <div className="px-1 pb-2 pt-1">
          {/* File name header */}
          <p className="mb-3 truncate px-3 text-[13px] font-medium text-foreground/70">
            {displayName}
          </p>

          {/* Action list */}
          <div className="flex flex-col">
            {actions.map((action, i) => (
              <button
                key={i}
                onClick={action.onClick}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors active:bg-accent/50",
                  "destructive" in action && action.destructive && "text-destructive"
                )}
              >
                <span className="text-muted-foreground">{action.icon}</span>
                <span className="text-[15px]">{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      </Modal>

      {/* Rename modal */}
      <Modal open={showRename} onClose={() => setShowRename(false)}>
        <ModalHeader>{t("rename")}</ModalHeader>
        <input
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
          <Button variant="ghost" onClick={() => setShowRename(false)}>
            {tc("cancel")}
          </Button>
          <Button onClick={handleRenameSubmit} disabled={!renameDraft.trim()}>
            {t("rename")}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Delete confirmation */}
      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)}>
        <ModalHeader>{file.isFolder ? t("deleteFolder") : t("deleteFile")}</ModalHeader>
        <p className="text-sm text-muted-foreground">
          {file.isFolder
            ? t("deleteFolderConfirm", { name: displayName })
            : t("deleteFileConfirm", { name: displayName })}
        </p>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setShowDeleteConfirm(false)}>
            {tc("cancel")}
          </Button>
          <Button variant="destructive" onClick={handleDelete}>
            {tc("delete")}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Share dialog */}
      <ShareDialog
        open={showShare}
        onClose={() => setShowShare(false)}
        fileId={file.id}
        fileName={file.name}
        isFolder={file.isFolder}
      />

      {/* Move to folder sheet */}
      {!file.isFolder && (
        <MoveToFolderSheet
          open={showMove}
          onClose={() => setShowMove(false)}
          fileId={file.id}
          currentParentId={file.parentId}
        />
      )}
    </>
  );
}
