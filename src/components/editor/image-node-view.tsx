"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NodeViewWrapper, NodeViewProps } from "@tiptap/react";
import { cn } from "@/lib/utils";

interface ResizeState {
  isResizing: boolean;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  aspectRatio: number;
  handle: string;
}

export function ImageNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const { src, alt, title, width, height, align } = node.attrs;
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [currentSize, setCurrentSize] = useState<{ width: number; height: number } | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

  // Get natural image dimensions when loaded
  const handleImageLoad = useCallback(() => {
    if (imgRef.current) {
      setNaturalSize({
        width: imgRef.current.naturalWidth,
        height: imgRef.current.naturalHeight,
      });
    }
  }, []);

  // Start resize
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, handle: string) => {
      e.preventDefault();
      e.stopPropagation();

      const img = imgRef.current;
      if (!img) return;

      const rect = img.getBoundingClientRect();
      const startWidth = width || rect.width;
      const startHeight = height || rect.height;
      const aspectRatio = startWidth / startHeight;

      setResizeState({
        isResizing: true,
        startX: e.clientX,
        startY: e.clientY,
        startWidth,
        startHeight,
        aspectRatio,
        handle,
      });
      setCurrentSize({ width: startWidth, height: startHeight });
    },
    [width, height]
  );

  // Handle resize move
  useEffect(() => {
    if (!resizeState?.isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - resizeState.startX;
      const deltaY = e.clientY - resizeState.startY;

      let newWidth = resizeState.startWidth;
      let newHeight = resizeState.startHeight;

      // Calculate new dimensions based on handle position
      const handle = resizeState.handle;
      const preserveAspectRatio = !e.shiftKey;

      if (handle.includes("right")) {
        newWidth = Math.max(50, resizeState.startWidth + deltaX);
      } else if (handle.includes("left")) {
        newWidth = Math.max(50, resizeState.startWidth - deltaX);
      }

      if (handle.includes("bottom")) {
        newHeight = Math.max(50, resizeState.startHeight + deltaY);
      } else if (handle.includes("top")) {
        newHeight = Math.max(50, resizeState.startHeight - deltaY);
      }

      // Preserve aspect ratio unless Shift is pressed
      if (preserveAspectRatio) {
        // Determine which dimension changed more
        const widthChange = Math.abs(newWidth - resizeState.startWidth);
        const heightChange = Math.abs(newHeight - resizeState.startHeight);

        if (widthChange >= heightChange) {
          newHeight = newWidth / resizeState.aspectRatio;
        } else {
          newWidth = newHeight * resizeState.aspectRatio;
        }
      }

      // Ensure minimum size
      newWidth = Math.max(50, Math.round(newWidth));
      newHeight = Math.max(50, Math.round(newHeight));

      setCurrentSize({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      if (currentSize) {
        updateAttributes({
          width: currentSize.width,
          height: currentSize.height,
        });
      }
      setResizeState(null);
      setCurrentSize(null);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizeState, currentSize, updateAttributes]);

  // Displayed dimensions
  const displayWidth = currentSize?.width || width;
  const displayHeight = currentSize?.height || height;

  // Keyboard resize handler for accessibility
  const handleKeyboardResize = useCallback(
    (e: React.KeyboardEvent, handle: string) => {
      const step = e.shiftKey ? 50 : 10; // Larger step with Shift
      const img = imgRef.current;
      if (!img) return;

      const currentWidth = width || img.getBoundingClientRect().width;
      const currentHeight = height || img.getBoundingClientRect().height;
      const aspectRatio = currentWidth / currentHeight;

      let newWidth = currentWidth;
      let newHeight = currentHeight;

      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          e.preventDefault();
          newWidth = currentWidth + step;
          newHeight = newWidth / aspectRatio;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          newWidth = Math.max(50, currentWidth - step);
          newHeight = newWidth / aspectRatio;
          break;
        default:
          return;
      }

      updateAttributes({
        width: Math.round(newWidth),
        height: Math.round(newHeight),
      });
    },
    [width, height, updateAttributes]
  );

  return (
    <NodeViewWrapper className="image-node-wrapper" data-align={align}>
      <div
        ref={containerRef}
        className={cn(
          "image-container",
          selected && "selected",
          resizeState?.isResizing && "is-resizing"
        )}
        data-align={align}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt || ""}
          title={title || undefined}
          onLoad={handleImageLoad}
          className="rounded-lg"
          style={{
            width: displayWidth ? `${displayWidth}px` : undefined,
            height: displayHeight ? `${displayHeight}px` : undefined,
            maxWidth: "100%",
          }}
          draggable={false}
        />

        {/* Resize handles - only show when selected */}
        {selected && (
          <>
            <div
              role="slider"
              aria-label="Resize from top-left corner"
              aria-valuenow={displayWidth || 0}
              tabIndex={0}
              className="resize-handle top-left"
              onMouseDown={(e) => handleResizeStart(e, "top-left")}
              onKeyDown={(e) => handleKeyboardResize(e, "top-left")}
            />
            <div
              role="slider"
              aria-label="Resize from top-right corner"
              aria-valuenow={displayWidth || 0}
              tabIndex={0}
              className="resize-handle top-right"
              onMouseDown={(e) => handleResizeStart(e, "top-right")}
              onKeyDown={(e) => handleKeyboardResize(e, "top-right")}
            />
            <div
              role="slider"
              aria-label="Resize from bottom-left corner"
              aria-valuenow={displayWidth || 0}
              tabIndex={0}
              className="resize-handle bottom-left"
              onMouseDown={(e) => handleResizeStart(e, "bottom-left")}
              onKeyDown={(e) => handleKeyboardResize(e, "bottom-left")}
            />
            <div
              role="slider"
              aria-label="Resize from bottom-right corner"
              aria-valuenow={displayWidth || 0}
              tabIndex={0}
              className="resize-handle bottom-right"
              onMouseDown={(e) => handleResizeStart(e, "bottom-right")}
              onKeyDown={(e) => handleKeyboardResize(e, "bottom-right")}
            />
          </>
        )}

        {/* Size label during resize */}
        {resizeState?.isResizing && currentSize && (
          <div className="size-label">
            {Math.round(currentSize.width)} × {Math.round(currentSize.height)}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}
