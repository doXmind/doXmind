"use client";

import { useState, useRef, useEffect } from "react";
import { SmilePlus } from "lucide-react";

const REACTION_EMOJIS = ["👍", "👎", "❤️", "🔥", "🎉", "😄", "🤔", "👀", "🚀", "💯"];

interface EmojiReactionPickerProps {
  onSelect: (emoji: string) => void;
}

export function EmojiReactionPicker({ onSelect }: EmojiReactionPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-full px-2 py-1 text-muted-foreground/60 transition-colors hover:bg-amber-500/10 hover:text-amber-500"
      >
        <SmilePlus className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1 flex gap-0.5 rounded-lg border border-border bg-card p-1.5 shadow-lg">
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => {
                onSelect(emoji);
                setOpen(false);
              }}
              className="rounded p-1 text-base transition-colors hover:bg-muted"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
