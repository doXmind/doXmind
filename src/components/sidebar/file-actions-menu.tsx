"use client";

import { FileDown, Home, Pencil, Share2, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

export interface FileActionsMenuItemsProps {
  /** Action handlers */
  onRename: () => void;
  onShare: () => void;
  onToggleFavorite: () => void;
  onMoveToRoot: () => void;
  onExport: (format: "markdown" | "pdf" | "docx") => void;
  onDelete: () => void;

  /** State */
  isFavorite: boolean;
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
 * Shared menu items used by both the DropdownMenu (three-dot button)
 * and the right-click ContextMenu in FileItem.
 *
 * Menu item indices (for keyboard navigation):
 *   0 - Rename
 *   1 - Share
 *   2 - Favorite
 *   3 - Move to Root  (only when hasParent is true; shifts subsequent indices by 1)
 *   3+offset - Export Markdown
 *   4+offset - Export PDF
 *   5+offset - Export Word
 *   6+offset - Move to Trash
 */
export function FileActionsMenuItems({
  onRename,
  onShare,
  onToggleFavorite,
  onMoveToRoot,
  onExport,
  onDelete,
  isFavorite,
  hasParent,
  variant,
  focusIndex = -1,
  onFocusIndex,
  contextMenuReady = false,
}: FileActionsMenuItemsProps) {
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
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onShare();
          }}
        >
          <Share2 className="mr-2 h-4 w-4" />
          Share
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
        >
          <Star className={cn("mr-2 h-4 w-4", isFavorite && "fill-amber-500 text-amber-500")} />
          {isFavorite ? "Remove from Favorites" : "Add to Favorites"}
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
              Move to Root
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Export as</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onExport("markdown");
          }}
        >
          <FileDown className="mr-2 h-4 w-4" />
          Markdown
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onExport("pdf");
          }}
        >
          <FileDown className="mr-2 h-4 w-4" />
          PDF
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onExport("docx");
          }}
        >
          <FileDown className="mr-2 h-4 w-4" />
          Word
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
          Move to Trash
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
        Rename
      </button>

      {/* Share */}
      <button
        role="menuitem"
        onClick={onShare}
        onMouseEnter={() => setFocus(1)}
        className={contextItemClass(1)}
      >
        <Share2 className="mr-2 h-4 w-4" />
        Share
      </button>

      {/* Favorite */}
      <button
        role="menuitem"
        onClick={onToggleFavorite}
        onMouseEnter={() => setFocus(2)}
        className={contextItemClass(2)}
      >
        <Star className={cn("mr-2 h-4 w-4", isFavorite && "fill-amber-500 text-amber-500")} />
        {isFavorite ? "Remove from Favorites" : "Add to Favorites"}
      </button>

      {hasParent && (
        <>
          <div className="my-1 h-px bg-border" />

          {/* Move to Root */}
          <button
            role="menuitem"
            onClick={onMoveToRoot}
            onMouseEnter={() => setFocus(3)}
            className={contextItemClass(3)}
          >
            <Home className="mr-2 h-4 w-4" />
            Move to Root
          </button>
        </>
      )}

      <div className="my-1 h-px bg-border" />

      {/* Export submenu label */}
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Export as</div>

      {/* Export Markdown */}
      <button
        role="menuitem"
        onClick={() => onExport("markdown")}
        onMouseEnter={() => setFocus(3 + exportOffset)}
        className={contextItemClass(3 + exportOffset)}
      >
        <FileDown className="mr-2 h-4 w-4" />
        Markdown
      </button>

      {/* Export PDF */}
      <button
        role="menuitem"
        onClick={() => onExport("pdf")}
        onMouseEnter={() => setFocus(4 + exportOffset)}
        className={contextItemClass(4 + exportOffset)}
      >
        <FileDown className="mr-2 h-4 w-4" />
        PDF
      </button>

      {/* Export Word */}
      <button
        role="menuitem"
        onClick={() => onExport("docx")}
        onMouseEnter={() => setFocus(5 + exportOffset)}
        className={contextItemClass(5 + exportOffset)}
      >
        <FileDown className="mr-2 h-4 w-4" />
        Word
      </button>

      <div className="my-1 h-px bg-border" />

      {/* Move to Trash */}
      <button
        role="menuitem"
        onClick={onDelete}
        onMouseEnter={() => setFocus(6 + exportOffset)}
        className={contextItemClass(6 + exportOffset, true)}
      >
        <Trash2 className="mr-2 h-4 w-4" />
        Move to Trash
      </button>
    </>
  );
}

/**
 * Returns the total number of actionable items in the menu.
 * Used by the keyboard navigation handler in FileItem.
 *
 * Items: Rename, Share, Favorite, [Move to Root], Export x3, Delete = 7 or 8
 */
export function getMenuItemCount(hasParent: boolean): number {
  return hasParent ? 8 : 7;
}
