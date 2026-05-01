"use client";

import { useState } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { FileText, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { navigateToEditorFile } from "@/lib/editor-navigation";
import { useFileStore } from "@/stores/file-store";
import { useEditorStore } from "@/stores/editor-store";

export function PageLinkNodeView({
  node,
  editor,
  updateAttributes,
  selected,
  deleteNode,
}: NodeViewProps) {
  const { pageId, pageTitle, pageIcon } = node.attrs;
  const currentFileId = useFileStore((s) => s.currentFileId);
  const [isHovered, setIsHovered] = useState(false);

  // Live title sync: read from file store in case the page was renamed
  const file = useFileStore((s) => s.getFile(pageId));
  const displayTitle = file?.name || pageTitle || "Untitled";
  const displayIcon = file?.icon || pageIcon;
  const isDeleted = !file && pageId;

  const showToolbar = (isHovered || selected) && editor.isEditable;

  const handleClick = () => {
    if (!pageId || isDeleted) return;
    if (currentFileId !== pageId) {
      navigateToEditorFile(pageId);
    }
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    const { openPagePicker } = useEditorStore.getState();
    openPagePicker((attrs) => {
      updateAttributes(attrs);
    });
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteNode();
  };

  return (
    <NodeViewWrapper data-type="page-link" contentEditable={false} className="not-prose my-1">
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleClick();
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={cn(
          "relative flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left",
          "transition-colors hover:bg-accent/50",
          isDeleted && "opacity-50"
        )}
      >
        {/* Hover toolbar */}
        {showToolbar && (
          <div className="image-overlay-toolbar !top-1/2 !-translate-y-1/2">
            <button
              type="button"
              className="image-toolbar-icon-btn"
              onClick={handleEdit}
              title="Change linked page"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <div className="image-toolbar-sep" />
            <button
              type="button"
              className="image-toolbar-icon-btn"
              onClick={handleDelete}
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {/* Icon */}
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-base">
          {displayIcon ? (
            <span>{displayIcon}</span>
          ) : (
            <FileText className="h-4 w-4 text-muted-foreground" />
          )}
        </span>

        {/* Title */}
        <span
          className={cn(
            "min-w-0 truncate text-sm",
            isDeleted
              ? "italic text-muted-foreground"
              : "text-foreground underline underline-offset-2"
          )}
        >
          {isDeleted ? "Page not found" : displayTitle}
        </span>
      </div>
    </NodeViewWrapper>
  );
}
