"use client";

import { useState, useRef, useCallback } from "react";
import { ImagePlus, X, Move } from "lucide-react";
import { useFileStore } from "@/stores/file-store";
import { CoverPickerModal } from "./cover-picker-modal";
import { isCssBackground } from "@/lib/cover-presets";
import { cn } from "@/lib/utils";

interface PageCoverProps {
  fileId: string;
}

export function PageCover({ fileId }: PageCoverProps) {
  const { getFile, setCoverImage, setCoverPosition } = useFileStore();
  const file = getFile(fileId);
  const coverUrl = file?.coverImageUrl;
  const coverPos = file?.coverPosition ?? 0.5;

  const [isHovered, setIsHovered] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragStartPos = useRef(0);

  const handleImageConfirm = useCallback(
    (src: string) => {
      setCoverImage(fileId, src);
      setShowImageModal(false);
    },
    [fileId, setCoverImage]
  );

  const handleRemoveCover = useCallback(() => {
    setCoverImage(fileId, null);
  }, [fileId, setCoverImage]);

  const handleRepositionStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      dragStartY.current = e.clientY;
      dragStartPos.current = coverPos;

      const handleMouseMove = (ev: MouseEvent) => {
        if (!containerRef.current) return;
        const containerHeight = containerRef.current.offsetHeight;
        const deltaY = ev.clientY - dragStartY.current;
        const deltaPct = deltaY / containerHeight;
        const newPos = Math.max(0, Math.min(1, dragStartPos.current + deltaPct));
        setCoverPosition(fileId, newPos);
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [fileId, coverPos, setCoverPosition]
  );

  // No cover: show "Add cover" button on hover (rendered in DocumentTitle)
  if (!coverUrl) return null;

  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          "group relative mb-4 h-[200px] overflow-hidden md:h-[280px]",
          isDragging && "cursor-ns-resize"
        )}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          if (!isDragging) setIsHovered(false);
        }}
      >
        {/* Cover image or CSS background */}
        {isCssBackground(coverUrl) ? (
          <div className="h-full w-full" style={{ background: coverUrl }} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl}
            alt="Page cover"
            className="h-full w-full object-cover"
            style={{ objectPosition: `center ${coverPos * 100}%` }}
            draggable={false}
          />
        )}

        {/* Overlay controls on hover */}
        {isHovered && !isDragging && (
          <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
            <button
              onClick={() => setShowImageModal(true)}
              className="flex items-center gap-1 rounded-md bg-background/80 px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background/95"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              Change cover
            </button>
            {!isCssBackground(coverUrl) && (
              <button
                onMouseDown={handleRepositionStart}
                className="flex items-center gap-1 rounded-md bg-background/80 px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background/95"
              >
                <Move className="h-3.5 w-3.5" />
                Reposition
              </button>
            )}
            <button
              onClick={handleRemoveCover}
              className="flex items-center gap-1 rounded-md bg-background/80 px-2.5 py-1.5 text-xs font-medium text-destructive shadow-sm backdrop-blur-sm transition-colors hover:bg-background/95"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Drag indicator */}
        {isDragging && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <span className="rounded-md bg-background/80 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm">
              Drag to reposition
            </span>
          </div>
        )}
      </div>

      {/* Cover picker modal */}
      <CoverPickerModal
        open={showImageModal}
        onClose={() => setShowImageModal(false)}
        onConfirm={handleImageConfirm}
        currentValue={coverUrl}
      />
    </>
  );
}
