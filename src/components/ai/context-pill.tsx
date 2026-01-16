"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, X, FileText, ImageIcon } from "lucide-react";
import type { ChatContextItem } from "@/stores/editor-store";

interface ContextPillProps {
  context: ChatContextItem;
  onRemove: () => void;
}

/**
 * Context Pill component - shows selected text or image as a collapsible pill.
 * Cursor-style UI for displaying attached content in chat input.
 */
export function ContextPill({ context, onRemove }: ContextPillProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isImage = context.type === "image";
  const Icon = isImage ? ImageIcon : FileText;
  const label = isImage
    ? `Image${context.alt ? `: ${context.alt}` : ""}`
    : `Selected Text (${context.text.length} chars)`;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:text-primary"
        >
          <Icon className="h-4 w-4 flex-shrink-0 text-primary" />
          <span className="truncate text-muted-foreground">{label}</span>
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
          )}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="flex-shrink-0 rounded p-1 transition-colors hover:bg-accent"
          title="Remove context"
        >
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
      {isExpanded && (
        <div className="max-h-[150px] overflow-y-auto border-t border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          {isImage ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={context.src}
              alt={context.alt || "Image"}
              className="h-auto max-w-full rounded"
            />
          ) : (
            <div className="whitespace-pre-wrap">{context.text}</div>
          )}
        </div>
      )}
    </div>
  );
}
