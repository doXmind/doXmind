"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Smile } from "lucide-react";
import { useFileStore } from "@/stores/file-store";
import { EmojiPicker } from "@/components/ui/emoji-picker";

interface DocumentTitleProps {
  fileId: string;
  fileName: string;
  onEnterEditor?: () => void;
}

export function DocumentTitle({ fileId, fileName, onEnterEditor }: DocumentTitleProps) {
  const { renameFile, getFile, setFileIcon } = useFileStore();
  const file = getFile(fileId);
  const icon = file?.icon ?? null;
  const displayName = fileName.replace(/\.md$/, "");
  const [value, setValue] = useState(displayName);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const iconButtonRef = useRef<HTMLButtonElement>(null);
  const isComposingRef = useRef(false);

  // Sync value when file changes
  useEffect(() => {
    setValue(displayName);
  }, [displayName]);

  // Auto-resize textarea to fit content
  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value]);

  const handleBlur = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setValue(displayName);
      return;
    }
    const newName = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
    if (newName !== fileName) {
      try {
        await renameFile(fileId, newName);
      } catch {
        setValue(displayName);
      }
    }
  }, [value, displayName, fileName, fileId, renameFile]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingRef.current) return;
    if (e.key === "Enter") {
      e.preventDefault();
      onEnterEditor?.();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setValue(displayName);
      inputRef.current?.blur();
    }
  };

  const handleEmojiSelect = useCallback(
    (emoji: string | null) => {
      setFileIcon(fileId, emoji);
      setShowEmojiPicker(false);
    },
    [fileId, setFileIcon]
  );

  return (
    <div className="mb-2 mt-4 px-0">
      <div className="flex items-start gap-2">
        {/* Emoji icon button */}
        <button
          ref={iconButtonRef}
          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          className="mt-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent"
          title="Set document icon"
        >
          {icon ? (
            <span className="text-2xl leading-none">{icon}</span>
          ) : (
            <Smile className="h-5 w-5 text-muted-foreground/40" />
          )}
        </button>

        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          placeholder="Untitled"
          rows={1}
          className="w-full resize-none overflow-hidden border-none bg-transparent text-3xl font-bold leading-tight text-foreground outline-none placeholder:text-muted-foreground/40 focus:ring-0"
          spellCheck={false}
        />
      </div>

      {/* Emoji picker */}
      {showEmojiPicker && iconButtonRef.current && (
        <EmojiPicker
          onSelect={handleEmojiSelect}
          onClose={() => setShowEmojiPicker(false)}
          anchorRect={iconButtonRef.current.getBoundingClientRect()}
        />
      )}
    </div>
  );
}
