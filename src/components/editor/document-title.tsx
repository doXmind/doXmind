"use client";

import { useState, useRef, useCallback } from "react";
import { Smile, ImagePlus } from "lucide-react";
import { useFileStore } from "@/stores/file-store";
import { EmojiPicker } from "@/components/ui/emoji-picker";
import { CoverPickerModal } from "./cover-picker-modal";
import { cn } from "@/lib/utils";

interface DocumentTitleProps {
  fileId: string;
}

export function DocumentTitle({ fileId }: DocumentTitleProps) {
  const { getFile, setFileIcon, setCoverImage } = useFileStore();
  const file = getFile(fileId);
  const icon = file?.icon ?? null;
  const hasCover = !!file?.coverImageUrl;
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showCoverModal, setShowCoverModal] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const iconButtonRef = useRef<HTMLButtonElement>(null);
  const addIconButtonRef = useRef<HTMLButtonElement>(null);

  const handleEmojiSelect = useCallback(
    (emoji: string | null) => {
      setFileIcon(fileId, emoji);
      setShowEmojiPicker(false);
    },
    [fileId, setFileIcon]
  );

  return (
    <div
      className={cn(
        "group relative",
        // Without an icon, collapse to a thin hover-trigger strip so the editor
        // body sits flush under the chrome header. With an icon set, reserve
        // room for the floating toolbar (top 28px) plus the 36px glyph row.
        icon ? "h-[68px] pt-7" : "h-7"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Floating action toolbar — overlays the strip; opacity-only transition keeps layout stable */}
      <div
        className="absolute left-0 right-0 top-0 z-10 flex h-7 items-center gap-1 transition-opacity duration-150"
        style={{ opacity: isHovered ? 1 : 0, pointerEvents: isHovered ? "auto" : "none" }}
      >
        {!icon && (
          <button
            ref={addIconButtonRef}
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
          >
            <Smile className="h-3.5 w-3.5" />
            <span>Add icon</span>
          </button>
        )}
        {!hasCover && (
          <button
            onClick={() => setShowCoverModal(true)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
          >
            <ImagePlus className="h-3.5 w-3.5" />
            <span>Add cover</span>
          </button>
        )}
      </div>

      {/* Emoji icon — only when set */}
      {icon && (
        <button
          ref={iconButtonRef}
          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          className="flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-accent"
          title="Change document icon"
        >
          <span className="text-2xl leading-none">{icon}</span>
        </button>
      )}

      {showEmojiPicker && (iconButtonRef.current || addIconButtonRef.current) && (
        <EmojiPicker
          onSelect={handleEmojiSelect}
          onClose={() => setShowEmojiPicker(false)}
          anchorRect={(iconButtonRef.current ?? addIconButtonRef.current)!.getBoundingClientRect()}
        />
      )}

      <CoverPickerModal
        open={showCoverModal}
        onClose={() => setShowCoverModal(false)}
        onConfirm={(value) => {
          setCoverImage(fileId, value);
          setShowCoverModal(false);
        }}
      />
    </div>
  );
}
