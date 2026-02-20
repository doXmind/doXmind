"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
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
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-foreground">Popular Tags</h2>
        {activeTag && (
          <button
            onClick={() => onTagSelect("")}
            className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {tags.map(({ tag, count }) => (
          <button
            key={tag}
            onClick={() => onTagSelect(activeTag === tag ? "" : tag)}
            className={cn(
              "rounded-full px-2.5 py-1 text-[12px] transition-colors",
              activeTag === tag
                ? "bg-foreground text-background"
                : "bg-muted/80 text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {tag}
            <span
              className={cn(
                "ml-1",
                activeTag === tag ? "text-background/60" : "text-muted-foreground/40"
              )}
            >
              {count}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
