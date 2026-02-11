"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderInput, Trash2, Download, X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useFileStore } from "@/stores/file-store";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";
import { storeLogger } from "@/lib/logger";

const log = storeLogger.child("BulkActionBar");

export function BulkActionBar() {
  const router = useRouter();
  const { selectedFileIds, clearSelection, bulkMoveFiles, bulkDeleteFiles, getFolders, files } =
    useFileStore();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const folders = getFolders();
  const selectedCount = selectedFileIds.size;

  if (selectedCount === 0) return null;

  const handleMove = async (folderId: string | null) => {
    try {
      const fileIds = Array.from(selectedFileIds);
      await bulkMoveFiles(fileIds, folderId);
      toast.success(
        `Moved ${selectedCount} file${selectedCount > 1 ? "s" : ""} ${folderId ? "to folder" : "to root"}`
      );
    } catch (error) {
      log.error("Failed to bulk move files", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const handleDeleteConfirm = async () => {
    setShowDeleteModal(false);
    setIsDeleting(true);
    try {
      const fileIds = Array.from(selectedFileIds);
      await bulkDeleteFiles(fileIds);
      // Navigate to the next file or welcome screen
      const nextId = useFileStore.getState().currentFileId;
      router.push(nextId ? `/editor/${nextId}` : "/editor");
      toast.success(`Moved ${selectedCount} file${selectedCount > 1 ? "s" : ""} to trash`);
    } catch (error) {
      log.error("Failed to bulk delete files", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExport = () => {
    const fileIds = Array.from(selectedFileIds);
    const selectedFiles = files.filter((f) => fileIds.includes(f.id));

    // Export as a combined markdown file
    const content = selectedFiles
      .map((file) => `# ${file.name}\n\n${file.content}\n\n---\n`)
      .join("\n");

    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `export-${selectedCount}-files.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success(`Exported ${selectedCount} file${selectedCount > 1 ? "s" : ""}`);
  };

  return (
    <>
      <div className="sticky bottom-0 left-0 right-0 z-10 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {selectedCount} file{selectedCount > 1 ? "s" : ""} selected
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Move to folder */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-2">
                  <FolderInput className="h-4 w-4" />
                  Move
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => handleMove(null)}>
                  <span className="flex items-center gap-2">
                    <span>Root</span>
                  </span>
                </DropdownMenuItem>
                {folders.length > 0 && <div className="my-1 h-px bg-border" />}
                {folders.map((folder) => (
                  <DropdownMenuItem key={folder.id} onClick={() => handleMove(folder.id)}>
                    <span className="truncate">{folder.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Export */}
            <Button variant="outline" size="sm" onClick={handleExport} className="h-8 gap-2">
              <Download className="h-4 w-4" />
              Export
            </Button>

            {/* Move to Trash */}
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteModal(true)}
              disabled={isDeleting}
              className="h-8 gap-2"
            >
              <Trash2 className="h-4 w-4" />
              Trash
            </Button>

            {/* Cancel */}
            <Button variant="ghost" size="sm" onClick={clearSelection} className="h-8 gap-2">
              <X className="h-4 w-4" />
              Cancel
            </Button>
          </div>
        </div>
      </div>

      {/* Move to Trash Confirmation Modal */}
      <Modal open={showDeleteModal} onClose={() => setShowDeleteModal(false)}>
        <ModalHeader onClose={() => setShowDeleteModal(false)}>
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Move {selectedCount} file{selectedCount > 1 ? "s" : ""} to trash?
          </span>
        </ModalHeader>
        <p className="text-sm text-muted-foreground">
          {selectedCount > 1 ? "These files" : "This file"} will be moved to trash. You can restore{" "}
          {selectedCount > 1 ? "them" : "it"} later.
        </p>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowDeleteModal(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDeleteConfirm}>
            Move to Trash
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
