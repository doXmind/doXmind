"use client";

import { Copy, ExternalLink, FileDown, FolderOpen, Home, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  MENU_ROW_CLASS,
} from "@/components/ui/dropdown-menu";

export interface FileActionsMenuItemsProps {
  /** Action handlers */
  onOpenExternally?: () => void;
  onRename: () => void;
  onMoveToRoot: () => void;
  onRevealInFinder: () => void;
  onCopySource: () => void;
  onExportPdf: () => void;
  onDelete: () => void;

  /** State */
  hasParent: boolean;
  isAttachment?: boolean;

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
 * Page menu item indices (for keyboard navigation):
 *   0 - Rename
 *   1 - Reveal in Finder
 *   2 - Move to Root  (only when hasParent is true; shifts subsequent indices by 1)
 *   2+offset - Copy Markdown Source
 *   3+offset - Export PDF
 *   4+offset - Move to Trash
 *
 * Attachment indices: Open externally, Rename, Reveal, [Move to Root], Delete.
 */
export function FileActionsMenuItems({
  onOpenExternally,
  onRename,
  onMoveToRoot,
  onRevealInFinder,
  onCopySource,
  onExportPdf,
  onDelete,
  hasParent,
  isAttachment = false,
  variant,
  focusIndex = -1,
  onFocusIndex,
  contextMenuReady = false,
}: FileActionsMenuItemsProps) {
  const t = useTranslations("sidebar");
  const tAttachment = useTranslations("attachment");
  const exportOffset = hasParent ? 1 : 0;

  if (variant === "dropdown") {
    return (
      <>
        {isAttachment && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onOpenExternally?.();
            }}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            {tAttachment("openExternally")}
          </DropdownMenuItem>
        )}
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
        {!isAttachment && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onCopySource();
              }}
            >
              <Copy className="mr-2 h-4 w-4" />
              {t("copyMarkdownSource")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onExportPdf();
              }}
            >
              <FileDown className="mr-2 h-4 w-4" />
              {t("pdfFormat")}
            </DropdownMenuItem>
          </>
        )}
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
      // Same row as every other menu in the app: 28px, 6px radius, 20ms hover.
      MENU_ROW_CLASS,
      destructive && "text-destructive",
      contextMenuReady &&
        (destructive ? "hover:bg-destructive/10" : "hover:bg-[var(--sidebar-hover)]"),
      focusIndex === index && (destructive ? "bg-destructive/10" : "bg-[var(--sidebar-active)]")
    );
  const renameIndex = isAttachment ? 1 : 0;
  const revealIndex = renameIndex + 1;
  const moveIndex = revealIndex + 1;
  const deleteIndex = isAttachment ? moveIndex + exportOffset : 4 + exportOffset;

  return (
    <>
      {isAttachment && (
        <button
          role="menuitem"
          onClick={onOpenExternally}
          onMouseEnter={() => setFocus(0)}
          className={contextItemClass(0)}
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          {tAttachment("openExternally")}
        </button>
      )}

      {/* Rename */}
      <button
        role="menuitem"
        onClick={onRename}
        onMouseEnter={() => setFocus(renameIndex)}
        className={contextItemClass(renameIndex)}
      >
        <Pencil className="mr-2 h-4 w-4" />
        {t("rename")}
      </button>

      {/* Reveal in Finder */}
      <button
        role="menuitem"
        onClick={onRevealInFinder}
        onMouseEnter={() => setFocus(revealIndex)}
        className={contextItemClass(revealIndex)}
      >
        <FolderOpen className="mr-2 h-4 w-4" />
        {t("revealInFinder")}
      </button>

      {hasParent && (
        <>
          <div className="-mx-1.5 my-1 h-px bg-border" />

          {/* Move to Root */}
          <button
            role="menuitem"
            onClick={onMoveToRoot}
            onMouseEnter={() => setFocus(moveIndex)}
            className={contextItemClass(moveIndex)}
          >
            <Home className="mr-2 h-4 w-4" />
            {t("moveToRoot")}
          </button>
        </>
      )}

      {!isAttachment && (
        <>
          <div className="-mx-1.5 my-1 h-px bg-border" />

          {/* Copy the complete portable Markdown source. */}
          <button
            role="menuitem"
            onClick={onCopySource}
            onMouseEnter={() => setFocus(2 + exportOffset)}
            className={contextItemClass(2 + exportOffset)}
          >
            <Copy className="mr-2 h-4 w-4" />
            {t("copyMarkdownSource")}
          </button>

          {/* Export PDF */}
          <button
            role="menuitem"
            onClick={onExportPdf}
            onMouseEnter={() => setFocus(3 + exportOffset)}
            className={contextItemClass(3 + exportOffset)}
          >
            <FileDown className="mr-2 h-4 w-4" />
            {t("pdfFormat")}
          </button>
        </>
      )}

      <div className="-mx-1.5 my-1 h-px bg-border" />

      {/* Move to Trash */}
      <button
        role="menuitem"
        onClick={onDelete}
        onMouseEnter={() => setFocus(deleteIndex)}
        className={contextItemClass(deleteIndex, true)}
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
 * Page items: Rename, Reveal, [Move to Root], Copy Source, Export PDF, Delete = 5 or 6.
 * Attachment items: Open externally, Rename, Reveal, [Move to Root], Delete = 4 or 5.
 */
export function getMenuItemCount(hasParent: boolean, isAttachment = false): number {
  if (isAttachment) return hasParent ? 5 : 4;
  return hasParent ? 6 : 5;
}
