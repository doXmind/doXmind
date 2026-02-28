"use client";

import { useState, useCallback, useEffect } from "react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import { ExternalLink, Pencil, Trash2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isDiffReviewActive } from "@/extensions/diff-review";
import { useStreamingStore } from "@/stores/streaming-store";

interface LinkBubbleMenuProps {
  editor: Editor;
  disabled?: boolean;
}

export function LinkBubbleMenu({ editor }: LinkBubbleMenuProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  // Get current link URL
  const currentUrl = editor.getAttributes("link").href || "";

  // Reset edit state when link changes
  useEffect(() => {
    setUrl(currentUrl);
    setIsEditing(false);
  }, [currentUrl]);

  const handleEdit = useCallback(() => {
    setUrl(currentUrl);
    setIsEditing(true);
  }, [currentUrl]);

  const handleSave = useCallback(() => {
    if (url.trim()) {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
    }
    setIsEditing(false);
  }, [editor, url]);

  const handleRemove = useCallback(() => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
  }, [editor]);

  const handleOpen = useCallback(() => {
    if (currentUrl) {
      window.open(currentUrl, "_blank", "noopener,noreferrer");
    }
  }, [currentUrl]);

  const handleCopy = useCallback(async () => {
    if (currentUrl) {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [currentUrl]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setIsEditing(false);
        setUrl(currentUrl);
      }
    },
    [handleSave, currentUrl]
  );

  // Only show when cursor is on a link
  const shouldShow = useCallback(() => {
    if (isDiffReviewActive(editor)) return false;
    if (useStreamingStore.getState().isStreaming) return false;
    // Don't show when text is selected (let the main bubble menu handle that)
    const { from, to } = editor.state.selection;
    if (to - from > 0) return false;
    return editor.isActive("link");
  }, [editor]);

  return (
    <BubbleMenu
      editor={editor}
      options={{
        placement: "bottom-start",
      }}
      shouldShow={shouldShow}
      className="link-bubble-menu"
    >
      <div className="flex min-w-0 items-center gap-1 rounded-lg border border-border bg-popover p-1.5 shadow-lg">
        {isEditing ? (
          // Edit mode
          <div className="flex items-center gap-1.5">
            <Input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter URL"
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
            {/* URL preview */}
            <a
              href={currentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="max-w-48 truncate px-2 text-sm text-muted-foreground hover:text-foreground"
              title={currentUrl}
              onClick={(e) => {
                // Allow Ctrl/Cmd+Click to open
                if (!e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  handleOpen();
                }
              }}
            >
              {currentUrl}
            </a>

            <div className="mx-0.5 h-5 w-px bg-border" />

            {/* Actions */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCopy}
              className="h-7 w-7"
              title="Copy link"
            >
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleEdit}
              className="h-7 w-7"
              title="Edit link"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleOpen}
              className="h-7 w-7"
              title="Open link"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRemove}
              className="h-7 w-7 text-destructive hover:text-destructive"
              title="Remove link"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    </BubbleMenu>
  );
}
