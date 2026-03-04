"use client";

import { useTranslations } from "next-intl";
import { Folder, Home, Check } from "lucide-react";
import { Modal, ModalHeader } from "@/components/ui/modal";
import { useFileStore } from "@/stores/file-store";
import { haptics } from "@/lib/haptics";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface MoveToFolderSheetProps {
  open: boolean;
  onClose: () => void;
  fileId: string;
  currentParentId: string | null;
}

export function MoveToFolderSheet({
  open,
  onClose,
  fileId,
  currentParentId,
}: MoveToFolderSheetProps) {
  const t = useTranslations("home");
  const { files, moveFileToFolder } = useFileStore();

  const folders = files.filter((f) => f.isFolder && f.id !== fileId);

  const handleMove = async (folderId: string | null) => {
    if (folderId === currentParentId) {
      onClose();
      return;
    }
    try {
      await moveFileToFolder(fileId, folderId);
      haptics.success();
      toast.success(folderId ? t("fileMovedToFolder") : t("fileMovedToRoot"));
    } catch {
      toast.error(t("failedToMoveFile"));
    }
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader>{t("moveTo")}</ModalHeader>
      <div className="flex flex-col">
        {/* Root option */}
        <button
          onClick={() => handleMove(null)}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors active:bg-accent/50",
            currentParentId === null && "bg-accent/30"
          )}
        >
          <Home className="h-5 w-5 text-muted-foreground" />
          <span className="flex-1 text-[15px]">{t("root")}</span>
          {currentParentId === null && <Check className="h-4 w-4 text-primary" />}
        </button>

        {/* Folder list */}
        {folders.map((folder) => (
          <button
            key={folder.id}
            onClick={() => handleMove(folder.id)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors active:bg-accent/50",
              currentParentId === folder.id && "bg-accent/30"
            )}
          >
            <Folder className="h-5 w-5 text-amber-500/70 dark:text-amber-400/60" />
            <span className="flex-1 truncate text-[15px]">{folder.name}</span>
            {currentParentId === folder.id && <Check className="h-4 w-4 text-primary" />}
          </button>
        ))}
      </div>
    </Modal>
  );
}
