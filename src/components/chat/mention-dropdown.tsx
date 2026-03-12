"use client";

import { useRef, useEffect, memo } from "react";
import { FileText, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { MentionItem } from "@/hooks/use-mention-trigger";

interface MentionDropdownProps {
  items: MentionItem[];
  selectedIndex: number;
  onSelect: (item: MentionItem) => void;
  onHover: (index: number) => void;
}

export const MentionDropdown = memo(function MentionDropdown({
  items,
  selectedIndex,
  onSelect,
  onHover,
}: MentionDropdownProps) {
  const t = useTranslations("chat");
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Group items by source
  const documents = items.filter((i) => i.source === "document");
  const dataFiles = items.filter((i) => i.source === "data_file");

  let globalIndex = 0;

  const renderItem = (item: MentionItem) => {
    const idx = globalIndex++;
    const isSelected = idx === selectedIndex;

    return (
      <button
        key={`${item.source}-${item.id}`}
        ref={isSelected ? selectedRef : undefined}
        type="button"
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
          isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
        )}
        onMouseEnter={() => onHover(idx)}
        onMouseDown={(e) => {
          // Use mouseDown to fire before textarea blur
          e.preventDefault();
          onSelect(item);
        }}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-sm">
          {item.icon || <FileText className="h-3.5 w-3.5 text-muted-foreground" />}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {item.displayName || "Untitled"}
          {item.parentName && (
            <span className="ml-1 text-xs text-muted-foreground">({item.parentName})</span>
          )}
        </span>
      </button>
    );
  };

  return (
    <div
      ref={listRef}
      className="max-h-[240px] overflow-y-auto rounded-xl border border-border/60 bg-popover p-1.5 shadow-lg"
    >
      {/* Documents section */}
      {documents.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted-foreground">
            <FileText className="h-3 w-3" />
            {t("mentionDocuments")}
          </div>
          {documents.map(renderItem)}
        </>
      )}

      {/* Data files section */}
      {dataFiles.length > 0 && (
        <>
          {documents.length > 0 && <div className="my-1 border-t border-border/40" />}
          <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted-foreground">
            <Database className="h-3 w-3" />
            {t("mentionDataFiles")}
          </div>
          {dataFiles.map(renderItem)}
        </>
      )}

      {items.length === 0 && (
        <div className="px-2 py-3 text-center text-xs text-muted-foreground">
          {t("mentionNoResults")}
        </div>
      )}
    </div>
  );
});
