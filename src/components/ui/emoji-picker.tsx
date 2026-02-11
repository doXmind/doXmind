"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const EMOJI_CATEGORIES = [
  {
    label: "Documents",
    emojis: ["📄", "📝", "📋", "📑", "📃", "📜", "📓", "📔", "📒", "📕", "📗", "📘", "📙", "📚"],
  },
  {
    label: "Objects",
    emojis: ["💡", "🔑", "🔒", "🔧", "⚙️", "🎯", "📌", "📎", "✂️", "🗂️", "📁", "🗃️", "📦", "🏷️"],
  },
  {
    label: "Symbols",
    emojis: ["⭐", "🌟", "✨", "💫", "🔥", "❤️", "💎", "🏆", "🎨", "🎵", "🚀", "⚡", "🌈", "🎉"],
  },
  {
    label: "Nature",
    emojis: ["🌱", "🌿", "🍀", "🌸", "🌺", "🌻", "🌲", "🍂", "🌊", "☀️", "🌙", "⛅", "❄️", "🌍"],
  },
  {
    label: "Faces",
    emojis: ["😊", "🤔", "💪", "👍", "👋", "🙌", "🤝", "✌️", "👀", "🧠", "💬", "💭", "🗣️", "👤"],
  },
  {
    label: "Food",
    emojis: ["☕", "🍵", "🧁", "🍕", "🍎", "🥑", "🍓", "🍰", "🧀", "🥖", "🍩", "🍪", "🍫", "🥤"],
  },
];

interface EmojiPickerProps {
  onSelect: (emoji: string | null) => void;
  onClose: () => void;
  anchorRect: DOMRect;
}

export function EmojiPicker({ onSelect, onClose, anchorRect }: EmojiPickerProps) {
  const [search, setSearch] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus search on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // Position below anchor
  const top = anchorRect.bottom + 4;
  const left = Math.max(8, anchorRect.left);

  // Filter emojis by search
  const filteredCategories = search
    ? EMOJI_CATEGORIES.map((cat) => ({
        ...cat,
        emojis: cat.emojis.filter((e) => e.includes(search)),
      })).filter((cat) => cat.emojis.length > 0)
    : EMOJI_CATEGORIES;

  return createPortal(
    <div
      ref={pickerRef}
      className="fixed z-50 w-72 rounded-lg border border-border bg-popover shadow-lg"
      style={{ top, left }}
    >
      {/* Search */}
      <div className="border-b border-border p-2">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search emoji..."
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
        />
      </div>

      {/* Emoji grid */}
      <div className="max-h-64 overflow-y-auto p-2">
        {filteredCategories.map((category) => (
          <div key={category.label} className="mb-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {category.label}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {category.emojis.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => onSelect(emoji)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded text-lg",
                    "transition-colors hover:bg-accent"
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ))}
        {filteredCategories.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">No emoji found</p>
        )}
      </div>

      {/* Remove button */}
      <div className="border-t border-border p-2">
        <button
          onClick={() => onSelect(null)}
          className="w-full rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Remove icon
        </button>
      </div>
    </div>,
    document.body
  );
}
