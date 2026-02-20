"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "@/lib/api";

interface TagFilterBarProps {
  activeTag: string;
  onTagSelect: (tag: string) => void;
}

interface TagInfo {
  tag: string;
  count: number;
}

export function TagFilterBar({ activeTag, onTagSelect }: TagFilterBarProps) {
  const [tags, setTags] = useState<TagInfo[]>([]);

  useEffect(() => {
    api
      .getCommunityTags(20)
      .then((res) => setTags(res.tags))
      .catch(() => {});
  }, []);

  if (tags.length === 0) return null;

  return (
    <div className="scrollbar-none mb-6 flex items-center gap-2 overflow-x-auto pb-1">
      {activeTag && (
        <button
          onClick={() => onTagSelect("")}
          className="flex shrink-0 items-center gap-1 rounded-full border border-foreground/20 bg-foreground/5 px-3 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-foreground/10"
        >
          <X className="h-3 w-3" />
          Clear
        </button>
      )}
      {tags.map(({ tag, count }) => (
        <button
          key={tag}
          onClick={() => onTagSelect(activeTag === tag ? "" : tag)}
          className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium transition-all ${
            activeTag === tag
              ? "border-foreground/20 bg-foreground/5 text-foreground"
              : "border-border/60 bg-transparent text-muted-foreground hover:border-foreground/20 hover:text-foreground"
          }`}
        >
          {tag}
          <span className="ml-1.5 text-muted-foreground/50">{count}</span>
        </button>
      ))}
    </div>
  );
}
