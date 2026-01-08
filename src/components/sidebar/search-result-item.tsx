"use client";

import { FileText, Sparkles } from "lucide-react";
import { cn, truncate } from "@/lib/utils";
import { useFileStore } from "@/stores/file-store";
import type { SearchResultItem } from "@/lib/api";

interface SearchResultItemProps {
  result: SearchResultItem;
  onSelect?: () => void;
}

export function SearchResultItemComponent({ result, onSelect }: SearchResultItemProps) {
  const { setCurrentFile, currentFileId, getFile } = useFileStore();
  const fileId = result.metadata.file_id;
  const isActive = currentFileId === fileId;

  // Get file name from local store as fallback
  const localFile = getFile(fileId);
  const fileName = result.metadata.name || localFile?.name || "Unknown file";

  const handleClick = () => {
    setCurrentFile(fileId);
    onSelect?.();
  };

  // Calculate relevance score (lower distance = higher relevance)
  const relevanceScore = result.distance !== undefined
    ? Math.round((1 - result.distance) * 100)
    : null;

  return (
    <div
      onClick={handleClick}
      className={cn(
        "group flex flex-col gap-1 px-2 py-2 rounded-md cursor-pointer transition-colors border-l-2",
        isActive
          ? "bg-accent text-accent-foreground border-l-primary"
          : "hover:bg-accent/50 text-foreground border-l-transparent hover:border-l-primary/50"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium truncate flex-1">
          {fileName}
        </span>
        {relevanceScore !== null && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Sparkles className="h-3 w-3 text-yellow-500" />
            <span>{relevanceScore}%</span>
          </div>
        )}
      </div>

      {/* Content preview */}
      <p className="text-xs text-muted-foreground line-clamp-2 pl-5">
        {truncate(result.content.trim(), 150)}
      </p>
    </div>
  );
}
