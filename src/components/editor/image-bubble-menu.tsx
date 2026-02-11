"use client";

import { useState, useCallback, useEffect } from "react";
import { BubbleMenu, Editor } from "@tiptap/react";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  ImageIcon,
  Type,
  Trash2,
  Check,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useChatContextStore } from "@/stores/chat-context-store";
import { isDiffReviewActive } from "@/extensions/diff-review";

interface ImageBubbleMenuProps {
  editor: Editor;
  disabled?: boolean;
}

type EditMode = "none" | "url" | "alt";

export function ImageBubbleMenu({ editor }: ImageBubbleMenuProps) {
  const [editMode, setEditMode] = useState<EditMode>("none");
  const [inputValue, setInputValue] = useState("");
  const { addChatContext } = useChatContextStore();

  // Get current image attributes
  const getImageAttrs = () => {
    const { src, alt, align } = editor.getAttributes("image");
    return { src: src || "", alt: alt || "", align: align || "center" };
  };

  const { src, alt, align } = getImageAttrs();

  // Reset edit state when selection changes
  useEffect(() => {
    setEditMode("none");
    setInputValue("");
  }, [src]);

  const handleSetAlign = useCallback(
    (newAlign: "left" | "center" | "right") => {
      editor.chain().focus().updateAttributes("image", { align: newAlign }).run();
    },
    [editor]
  );

  const handleEditUrl = useCallback(() => {
    setInputValue(src);
    setEditMode("url");
  }, [src]);

  const handleEditAlt = useCallback(() => {
    setInputValue(alt);
    setEditMode("alt");
  }, [alt]);

  const handleSave = useCallback(() => {
    if (editMode === "url" && inputValue.trim()) {
      editor.chain().focus().updateAttributes("image", { src: inputValue.trim() }).run();
    } else if (editMode === "alt") {
      editor.chain().focus().updateAttributes("image", { alt: inputValue.trim() }).run();
    }
    setEditMode("none");
    setInputValue("");
  }, [editor, editMode, inputValue]);

  const handleDelete = useCallback(() => {
    // Capture src before deletion removes the node
    const imgSrc = src;

    // Delete from editor first (immediate UI feedback)
    editor.chain().focus().deleteSelection().run();

    // Then delete from S3 (fire-and-forget, best effort)
    if (imgSrc && imgSrc.startsWith("/api/images/")) {
      api.deleteImage(imgSrc).catch((error) => {
        console.warn("Failed to delete image from server:", error);
      });
    }
  }, [editor, src]);

  const handleAskInChat = useCallback(() => {
    if (src) {
      addChatContext({
        type: "image",
        src,
        alt: alt || undefined,
      });
    }
  }, [src, alt, addChatContext]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setEditMode("none");
        setInputValue("");
      }
    },
    [handleSave]
  );

  // Only show when an image is selected
  const shouldShow = useCallback(() => {
    if (isDiffReviewActive(editor)) return false;
    return editor.isActive("image");
  }, [editor]);

  return (
    <BubbleMenu
      editor={editor}
      tippyOptions={{
        duration: 150,
        placement: "bottom",
        offset: [0, 8],
      }}
      shouldShow={shouldShow}
      className="image-bubble-menu"
    >
      <div className="flex items-center gap-1 rounded-lg border border-border bg-popover p-1.5 shadow-lg">
        {editMode !== "none" ? (
          // Edit mode
          <div className="flex items-center gap-1.5">
            <Input
              type={editMode === "url" ? "url" : "text"}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={editMode === "url" ? "Image URL" : "Alt text"}
              className="h-7 w-64 text-sm"
              autoFocus={typeof window !== "undefined" && window.innerWidth >= 768}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSave}
              className="h-7 w-7 text-primary"
              title="Save"
            >
              <Check className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          // View mode
          <>
            {/* Alignment buttons */}
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleSetAlign("left")}
                className={cn("h-7 w-7", align === "left" && "bg-accent")}
                title="Align left"
              >
                <AlignLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleSetAlign("center")}
                className={cn("h-7 w-7", align === "center" && "bg-accent")}
                title="Align center"
              >
                <AlignCenter className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleSetAlign("right")}
                className={cn("h-7 w-7", align === "right" && "bg-accent")}
                title="Align right"
              >
                <AlignRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="mx-0.5 h-5 w-px bg-border" />

            {/* Edit buttons */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleEditUrl}
              className="h-7 w-7"
              title="Replace image"
            >
              <ImageIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleEditAlt}
              className="h-7 w-7"
              title="Edit alt text"
            >
              <Type className="h-4 w-4" />
            </Button>

            <div className="mx-0.5 h-5 w-px bg-border" />

            {/* Ask in Chat button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleAskInChat}
              className="h-7 w-7 text-primary"
              title="Ask in Chat"
            >
              <MessageSquare className="h-4 w-4" />
            </Button>

            <div className="mx-0.5 h-5 w-px bg-border" />

            {/* Delete button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDelete}
              className="h-7 w-7 text-destructive hover:text-destructive"
              title="Delete image"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    </BubbleMenu>
  );
}
