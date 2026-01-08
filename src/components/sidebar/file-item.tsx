"use client";

import { FileText, Trash2, Pencil } from "lucide-react";
import { useState } from "react";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useFileStore, type FileItem as FileItemType } from "@/stores/file-store";

interface FileItemProps {
  file: FileItemType;
}

export function FileItem({ file }: FileItemProps) {
  const { currentFileId, setCurrentFile, deleteFile, renameFile } =
    useFileStore();
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(file.name);

  const isActive = currentFileId === file.id;

  const handleClick = () => {
    if (!isRenaming) {
      setCurrentFile(file.id);
    }
  };

  const handleRename = async () => {
    if (newName.trim() && newName !== file.name) {
      try {
        await renameFile(file.id, newName.trim());
      } catch (error) {
        console.error("Failed to rename file:", error);
      }
    }
    setIsRenaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRename();
    } else if (e.key === "Escape") {
      setNewName(file.name);
      setIsRenaming(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Delete "${file.name}"?`)) {
      try {
        await deleteFile(file.id);
      } catch (error) {
        console.error("Failed to delete file:", error);
      }
    }
  };

  return (
    <div
      onClick={handleClick}
      className={cn(
        "group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors",
        isActive
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50 text-foreground"
      )}
    >
      <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />

      <div className="flex-1 min-w-0">
        {isRenaming ? (
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="h-6 px-1 py-0 text-sm"
            autoFocus
          />
        ) : (
          <>
            <p className="text-sm truncate">{file.name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {formatDate(file.updatedAt)}
            </p>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => e.stopPropagation()}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                setIsRenaming(true);
              }}
            >
              <Pencil className="h-4 w-4 mr-2" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleDelete}
              className="text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
