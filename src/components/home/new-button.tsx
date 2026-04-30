"use client";

import { memo } from "react";
import {
  FileArchive,
  FilePlus,
  FolderPlus,
  LayoutTemplate,
  Loader2,
  Plus,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useTranslations } from "next-intl";

interface NewButtonProps {
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onOpenTemplatePicker: () => void;
  onImportFile: () => void;
  onImportWorkspace?: () => void;
  isImporting: boolean;
  disableFolder?: boolean;
  hideFolder?: boolean;
}

export const NewButton = memo(function NewButton({
  onCreateFile,
  onCreateFolder,
  onOpenTemplatePicker,
  onImportFile,
  onImportWorkspace,
  isImporting,
  disableFolder,
  hideFolder,
}: NewButtonProps) {
  const t = useTranslations("sidebar");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="sidebar-action-button h-7 w-7 rounded-lg"
          aria-label={t("newDocument")}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={onCreateFile}>
          <FilePlus className="mr-2 h-4 w-4" />
          {t("newDocument")}
        </DropdownMenuItem>
        {!hideFolder && (
          <DropdownMenuItem onClick={onCreateFolder} disabled={disableFolder}>
            <FolderPlus className="mr-2 h-4 w-4" />
            {t("newFolder")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onOpenTemplatePicker}>
          <LayoutTemplate className="mr-2 h-4 w-4" />
          {t("fromTemplate")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImportFile} disabled={isImporting}>
          {isImporting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          {t("importFile")}
        </DropdownMenuItem>
        {onImportWorkspace && (
          <DropdownMenuItem onClick={onImportWorkspace}>
            <FileArchive className="mr-2 h-4 w-4" />
            {t("importWorkspace")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
