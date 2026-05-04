"use client";

import { memo } from "react";
import { FolderPlus, LayoutTemplate, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useTranslations } from "next-intl";
import { MarkdownGlyph, PdfGlyph, SpreadsheetGlyph } from "@/components/icons/document-glyphs";

interface NewButtonProps {
  /** Default markdown create — kept for backwards compat. */
  onCreateFile: () => void;
  /** Optional explicit PDF create. When omitted the PDF entry is hidden. */
  onCreatePdf?: () => void;
  /** Optional explicit Excel create. When omitted the Excel entry is hidden. */
  onCreateExcel?: () => void;
  onCreateFolder: () => void;
  onOpenTemplatePicker: () => void;
  disableFolder?: boolean;
  hideFolder?: boolean;
}

export const NewButton = memo(function NewButton({
  onCreateFile,
  onCreatePdf,
  onCreateExcel,
  onCreateFolder,
  onOpenTemplatePicker,
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
          <MarkdownGlyph className="mr-2 h-4 w-4" />
          {t("newMarkdown")}
        </DropdownMenuItem>
        {onCreatePdf && (
          <DropdownMenuItem onClick={onCreatePdf}>
            <PdfGlyph className="mr-2 h-4 w-4" />
            {t("newPdf")}
          </DropdownMenuItem>
        )}
        {onCreateExcel && (
          <DropdownMenuItem onClick={onCreateExcel}>
            <SpreadsheetGlyph className="mr-2 h-4 w-4" />
            {t("newExcel")}
          </DropdownMenuItem>
        )}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
