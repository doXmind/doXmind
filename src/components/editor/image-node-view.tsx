"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { NodeViewWrapper, NodeViewProps } from "@tiptap/react";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  ImageIcon,
  Type,
  Trash2,
  Check,
  Download,
  MoreHorizontal,
  ArrowUpFromLine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { isInsideList, liftAtomBlock } from "@/lib/block-operations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { ImageEmptyState } from "./image-empty-state";
import { resolveImageSrc } from "@/lib/asset-url";
import { useFileStore } from "@/stores/file-store";

interface ResizeState {
  isResizing: boolean;
  startX: number;
  startWidth: number;
  aspectRatio: number;
  side: "left" | "right";
}

type EditMode = "none" | "url" | "alt";

export function ImageNodeView({
  node,
  updateAttributes,
  selected,
  editor,
  deleteNode,
  getPos,
}: NodeViewProps) {
  const t = useTranslations("editor");
  const tc = useTranslations("common");
  const { src, alt, title, width, height, align } = node.attrs;
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Resolve relative workspace paths (e.g. "./assets/foo.png") into a URL
  // the webview can actually load (Tauri asset protocol).
  const rootPath = useFileStore((s) => s.rootPath);
  const docRelPath = useFileStore((s) => {
    const file = s.files.find((f) => f.id === s.currentFileId);
    return file?.storageHandle?.relPath ?? file?.storageHandle?.path ?? null;
  });
  const resolvedSrc = useMemo(
    () => resolveImageSrc(src ?? "", rootPath, docRelPath),
    [src, rootPath, docRelPath]
  );

  let nodePos: number | undefined;
  try {
    nodePos = typeof getPos === "function" ? getPos() : undefined;
  } catch {
    // getPos() can throw during unmount
  }

  const isNested = nodePos !== undefined && isInsideList(editor.state.doc, nodePos);

  const handleLiftOut = useCallback(() => {
    if (nodePos !== undefined) {
      liftAtomBlock(editor, nodePos);
    }
  }, [editor, nodePos]);

  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [currentWidth, setCurrentWidth] = useState<number | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Inline edit mode for URL/alt text
  const [editMode, setEditMode] = useState<EditMode>("none");
  const [inputValue, setInputValue] = useState("");

  // Show toolbar on hover or when selected
  const showToolbar = (isHovered || selected) && !resizeState?.isResizing;

  // Get natural image dimensions when loaded
  const handleImageLoad = useCallback(() => {
    // No-op: we only need the ref for resize calculations
  }, []);

  // --- Notion-style edge resize (left/right vertical bars) ---

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, side: "left" | "right") => {
      e.preventDefault();
      e.stopPropagation();

      const img = imgRef.current;
      if (!img) return;

      const rect = img.getBoundingClientRect();
      const startWidth = width || rect.width;
      const aspectRatio = rect.width / rect.height;

      setResizeState({
        isResizing: true,
        startX: e.clientX,
        startWidth,
        aspectRatio,
        side,
      });
      setCurrentWidth(startWidth);
    },
    [width]
  );

  useEffect(() => {
    if (!resizeState?.isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - resizeState.startX;

      // Left handle: dragging left = larger, dragging right = smaller
      // Right handle: dragging right = larger, dragging left = smaller
      const direction = resizeState.side === "right" ? 1 : -1;
      const newWidth = Math.max(80, resizeState.startWidth + deltaX * direction);

      setCurrentWidth(Math.round(newWidth));
    };

    const handleMouseUp = () => {
      if (currentWidth) {
        const newHeight = Math.round(currentWidth / resizeState.aspectRatio);
        updateAttributes({
          width: currentWidth,
          height: newHeight,
        });
      }
      setResizeState(null);
      setCurrentWidth(null);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizeState, currentWidth, updateAttributes]);

  // Displayed width
  const displayWidth = currentWidth || width;
  const displayHeight =
    displayWidth && height && width ? Math.round(displayWidth * (height / width)) : height;

  // --- Toolbar actions ---

  const handleSetAlign = useCallback(
    (newAlign: "left" | "center" | "right") => {
      updateAttributes({ align: newAlign });
    },
    [updateAttributes]
  );

  const handleEditUrl = useCallback(() => {
    setInputValue(src || "");
    setEditMode("url");
    setShowMoreMenu(false);
  }, [src]);

  const handleEditAlt = useCallback(() => {
    setInputValue(alt || "");
    setEditMode("alt");
    setShowMoreMenu(false);
  }, [alt]);

  const handleSaveInput = useCallback(() => {
    if (editMode === "url" && inputValue.trim()) {
      updateAttributes({ src: inputValue.trim() });
    } else if (editMode === "alt") {
      updateAttributes({ alt: inputValue.trim() });
    }
    setEditMode("none");
    setInputValue("");
  }, [editMode, inputValue, updateAttributes]);

  const handleDelete = useCallback(() => {
    const imgSrc = src;
    deleteNode();
    if (imgSrc && imgSrc.startsWith("/api/images/")) {
      api.deleteImage(imgSrc).catch((error) => {
        console.warn("Failed to delete image from server:", error);
      });
    }
  }, [src, deleteNode]);

  const handleDownload = useCallback(() => {
    if (!resolvedSrc) return;
    const a = document.createElement("a");
    a.href = resolvedSrc;
    a.download = alt || "image";
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [resolvedSrc, alt]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        handleSaveInput();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setEditMode("none");
        setInputValue("");
      }
    },
    [handleSaveInput]
  );

  // Close more menu on outside click
  useEffect(() => {
    if (!showMoreMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMoreMenu]);

  // Reset state when deselected
  useEffect(() => {
    if (!selected && !isHovered) {
      setEditMode("none");
      setInputValue("");
      setShowMoreMenu(false);
    }
  }, [selected, isHovered]);

  // Notion-style empty placeholder when no image has been chosen yet.
  if (!src) {
    return (
      <NodeViewWrapper className="image-node-wrapper" data-align={align}>
        <ImageEmptyState
          onSetSrc={(newSrc, newAlt) =>
            updateAttributes({ src: newSrc, ...(newAlt ? { alt: newAlt } : {}) })
          }
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="image-node-wrapper" data-align={align}>
      <div
        ref={containerRef}
        className={cn("image-container group", resizeState?.isResizing && "is-resizing")}
        data-align={align}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          setIsHovered(false);
          if (!selected) setShowMoreMenu(false);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={resolvedSrc}
          alt={alt || ""}
          title={title || undefined}
          onLoad={handleImageLoad}
          className={cn(
            "rounded-lg",
            selected && "ring-2 ring-primary/50 ring-offset-1 ring-offset-background"
          )}
          style={{
            width: displayWidth ? `${displayWidth}px` : undefined,
            height: displayHeight ? `${displayHeight}px` : undefined,
            maxWidth: "100%",
          }}
          draggable={false}
        />

        {/* Notion-style overlay toolbar (top-right, inside the image) */}
        {showToolbar && editor.isEditable && editMode === "none" && (
          <div
            className="image-overlay-toolbar"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Lift out of list (only when nested) */}
            {isNested && (
              <>
                <Tooltip content={t("liftOutOfList")} side="top">
                  <button type="button" className="image-toolbar-icon-btn" onClick={handleLiftOut}>
                    <ArrowUpFromLine className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
                <div className="image-toolbar-sep" />
              </>
            )}

            {/* Alignment buttons */}
            <Tooltip content={t("alignLeft")} side="top">
              <button
                type="button"
                className={cn("image-toolbar-icon-btn", align === "left" && "active")}
                onClick={() => handleSetAlign("left")}
              >
                <AlignLeft className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <Tooltip content={t("alignCenter")} side="top">
              <button
                type="button"
                className={cn("image-toolbar-icon-btn", (!align || align === "center") && "active")}
                onClick={() => handleSetAlign("center")}
              >
                <AlignCenter className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <Tooltip content={t("alignRight")} side="top">
              <button
                type="button"
                className={cn("image-toolbar-icon-btn", align === "right" && "active")}
                onClick={() => handleSetAlign("right")}
              >
                <AlignRight className="h-3.5 w-3.5" />
              </button>
            </Tooltip>

            <div className="image-toolbar-sep" />

            {/* Download */}
            <Tooltip content={t("imageDownload")} side="top">
              <button type="button" className="image-toolbar-icon-btn" onClick={handleDownload}>
                <Download className="h-3.5 w-3.5" />
              </button>
            </Tooltip>

            {/* More menu */}
            <div className="relative" ref={moreMenuRef}>
              <Tooltip content={t("imageMore")} side="top">
                <button
                  type="button"
                  className="image-toolbar-icon-btn"
                  onClick={() => setShowMoreMenu(!showMoreMenu)}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </Tooltip>

              {showMoreMenu && (
                <div className="image-more-menu">
                  <button type="button" className="image-more-menu-item" onClick={handleEditUrl}>
                    <ImageIcon className="h-3.5 w-3.5" />
                    <span>{t("replaceImage")}</span>
                  </button>
                  <button type="button" className="image-more-menu-item" onClick={handleEditAlt}>
                    <Type className="h-3.5 w-3.5" />
                    <span>{t("altTextLabel")}</span>
                  </button>
                  <div className="my-1 h-px bg-border" />
                  <button
                    type="button"
                    className="image-more-menu-item text-destructive"
                    onClick={handleDelete}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{tc("delete")}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Inline input for URL/alt text editing (overlaid on image) */}
        {editMode !== "none" && (
          <div
            className="image-edit-input-overlay"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Input
              type={editMode === "url" ? "url" : "text"}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={editMode === "url" ? t("pasteImageUrl") : t("describeImage")}
              className="h-8 flex-1 bg-background/90 text-sm"
              autoFocus
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                handleSaveInput();
              }}
              className="h-8 w-8 text-primary"
            >
              <Check className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Notion-style edge resize handles (left and right vertical bars) */}
        {showToolbar && editor.isEditable && (
          <>
            <div
              className="image-resize-handle-left"
              onMouseDown={(e) => handleResizeStart(e, "left")}
            >
              <div className="image-resize-bar" />
            </div>
            <div
              className="image-resize-handle-right"
              onMouseDown={(e) => handleResizeStart(e, "right")}
            >
              <div className="image-resize-bar" />
            </div>
          </>
        )}

        {/* Size label during resize */}
        {resizeState?.isResizing && currentWidth && (
          <div className="size-label">
            {currentWidth} × {displayHeight || "auto"}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}
