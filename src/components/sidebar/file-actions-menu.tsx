"use client";

import { FileDown, FolderOpen, Home, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

export interface FileActionsMenuItemsProps {
  /** Action handlers */
  onRename: () => void;
  onMoveToRoot: () => void;
  onRevealInFinder: () => void;
  onExport: (format: "markdown" | "pdf" | "docx") => void;
  onDelete: () => void;

  /** State */
  hasParent: boolean;

  /** Rendering variant */
  variant: "dropdown" | "context";

  /**
   * Context menu specific props (ignored for "dropdown" variant)
   */
  focusIndex?: number;
  onFocusIndex?: (index: number) => void;
  contextMenuReady?: boolean;
}

/**
 * Shared menu items used by both the DropdownMenu (mobile three-dot button)
 * and the right-click ContextMenu in FileItem.
 *
 * Menu item indices (for keyboard navigation):
 *   0 - Rename
 *   1 - Reveal in Finder
 *   2 - Move to Root  (only when hasParent is true; shifts subsequent indices by 1)
 *   2+offset - Export Markdown
 *   3+offset - Export PDF
 *   4+offset - Export Word
 *   5+offset - Move to Trash
 */
export function FileActionsMenuItems({
  onRename,
  onMoveToRoot,
  onRevealInFinder,
  onExport,
  onDelete,
  hasParent,
  variant,
  focusIndex = -1,
  onFocusIndex,
  contextMenuReady = false,
}: FileActionsMenuItemsProps) {
  const t = useTranslations("sidebar");
  const exportOffset = hasParent ? 1 : 0;

  if (variant === "dropdown") {
    return (
      <>
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onRename();
          }}
        >
          <Pencil className="mr-2 h-4 w-4" />
          {t("rename")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onRevealInFinder();
          }}
        >
          <FolderOpen className="mr-2 h-4 w-4" />
          {t("revealInFinder")}
        </DropdownMenuItem>
        {hasParent && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onMoveToRoot();
              }}
            >
              <Home className="mr-2 h-4 w-4" />
              {t("moveToRoot")}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t("exportAs")}
        </DropdownMenuLabel>
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onExport("markdown");
          }}
        >
          <FileDown className="mr-2 h-4 w-4" />
          {t("markdownFormat")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onExport("pdf");
          }}
        >
          <FileDown className="mr-2 h-4 w-4" />
          {t("pdfFormat")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onExport("docx");
          }}
        >
          <FileDown className="mr-2 h-4 w-4" />
          {t("wordFormat")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {t("moveToTrash")}
        </DropdownMenuItem>
      </>
    );
  }

  // Context menu variant
  const setFocus = (index: number) => {
    if (contextMenuReady && onFocusIndex) {
      onFocusIndex(index);
    }
  };

  const contextItemClass = (index: number, destructive?: boolean) =>
    cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none",
      destructive && "text-destructive",
      contextMenuReady &&
        (destructive ? "hover:bg-destructive/10" : "hover:bg-accent hover:text-accent-foreground"),
      focusIndex === index &&
        (destructive ? "bg-destructive/10" : "bg-accent text-accent-foreground")
    );

  return (
    <>
      {/* Rename */}
      <button
        role="menuitem"
        onClick={onRename}
        onMouseEnter={() => setFocus(0)}
        className={contextItemClass(0)}
      >
        <Pencil className="mr-2 h-4 w-4" />
        {t("rename")}
      </button>

      {/* Reveal in Finder */}
      <button
        role="menuitem"
        onClick={onRevealInFinder}
        onMouseEnter={() => setFocus(1)}
        className={contextItemClass(1)}
      >
        <FolderOpen className="mr-2 h-4 w-4" />
        {t("revealInFinder")}
      </button>

      {hasParent && (
        <>
          <div className="my-1 h-px bg-border" />

          {/* Move to Root */}
          <button
            role="menuitem"
            onClick={onMoveToRoot}
            onMouseEnter={() => setFocus(2)}
            className={contextItemClass(2)}
          >
            <Home className="mr-2 h-4 w-4" />
            {t("moveToRoot")}
          </button>
        </>
      )}

      <div className="my-1 h-px bg-border" />

      {/* Export submenu label */}
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{t("exportAs")}</div>

      {/* Export Markdown */}
      <button
        role="menuitem"
        onClick={() => onExport("markdown")}
        onMouseEnter={() => setFocus(2 + exportOffset)}
        className={contextItemClass(2 + exportOffset)}
      >
        <FileDown className="mr-2 h-4 w-4" />
        {t("markdownFormat")}
      </button>

      {/* Export PDF */}
      <button
        role="menuitem"
        onClick={() => onExport("pdf")}
        onMouseEnter={() => setFocus(3 + exportOffset)}
        className={contextItemClass(3 + exportOffset)}
      >
        <FileDown className="mr-2 h-4 w-4" />
        {t("pdfFormat")}
      </button>

      {/* Export Word */}
      <button
        role="menuitem"
        onClick={() => onExport("docx")}
        onMouseEnter={() => setFocus(4 + exportOffset)}
        className={contextItemClass(4 + exportOffset)}
      >
        <FileDown className="mr-2 h-4 w-4" />
        {t("wordFormat")}
      </button>

      <div className="my-1 h-px bg-border" />

      {/* Move to Trash */}
      <button
        role="menuitem"
        onClick={onDelete}
        onMouseEnter={() => setFocus(5 + exportOffset)}
        className={contextItemClass(5 + exportOffset, true)}
      >
        <Trash2 className="mr-2 h-4 w-4" />
        {t("moveToTrash")}
      </button>
    </>
  );
}

/**
 * Returns the total number of actionable items in the menu.
 * Used by the keyboard navigation handler in FileItem.
 *
 * Items: Rename, Reveal, [Move to Root], Export x3, Delete = 6 or 7
 */
export function getMenuItemCount(hasParent: boolean): number {
  return hasParent ? 7 : 6;
}
