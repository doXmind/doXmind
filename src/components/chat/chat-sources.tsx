"use client";

import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatSource {
  file_id: string;
  file_name: string;
  score: number;
}

interface ChatSourcesProps {
  sources: ChatSource[];
  onSourceClick: (fileId: string, index: number) => void;
  className?: string;
}

/**
 * Source confidence pills for KB answers.
 * Color-coded by relevance score: green (>=0.7), amber (>=0.4), gray (<0.4).
 */
export function ChatSources({ sources, onSourceClick, className }: ChatSourcesProps) {
  if (sources.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {sources.map((source, i) => (
        <button
          key={source.file_id}
          onClick={() => onSourceClick(source.file_id, i)}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors hover:bg-accent",
            source.score >= 0.7
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400"
              : source.score >= 0.4
                ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400"
                : "border-border bg-accent/50 text-muted-foreground"
          )}
        >
          <FileText className="h-3 w-3" />
          <span className="max-w-[120px] truncate">{source.file_name}</span>
          <span className="text-[10px] opacity-60">{Math.round(source.score * 100)}%</span>
        </button>
      ))}
    </div>
  );
}
