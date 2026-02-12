"use client";

import { FilePlus, FolderPlus, LayoutTemplate, Loader2, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface NewButtonProps {
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onOpenTemplatePicker: () => void;
  onImportFile: () => void;
  isImporting: boolean;
  disableFolder?: boolean;
}

export function NewButton({
  onCreateFile,
  onCreateFolder,
  onOpenTemplatePicker,
  onImportFile,
  isImporting,
  disableFolder,
}: NewButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          aria-label="New"
          data-onboarding="new-button"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={onCreateFile}>
          <FilePlus className="mr-2 h-4 w-4" />
          New Document
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCreateFolder} disabled={disableFolder}>
          <FolderPlus className="mr-2 h-4 w-4" />
          New Folder
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onOpenTemplatePicker}>
          <LayoutTemplate className="mr-2 h-4 w-4" />
          From Template
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImportFile} disabled={isImporting}>
          {isImporting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          Import File
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
