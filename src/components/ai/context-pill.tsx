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

  const isImage = context.type === 'image';
  const Icon = isImage ? ImageIcon : FileText;
  const label = isImage
    ? `Image${context.alt ? `: ${context.alt}` : ''}`
    : `Selected Text (${context.text.length} chars)`;

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-muted/30">
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left hover:text-primary transition-colors"
        >
          <Icon className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="truncate text-muted-foreground">
            {label}
          </span>
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          )}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="p-1 hover:bg-accent rounded transition-colors flex-shrink-0"
          title="Remove context"
        >
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
      {isExpanded && (
        <div className="px-3 py-2 text-sm text-muted-foreground bg-muted/50 border-t border-border max-h-[150px] overflow-y-auto">
          {isImage ? (
            <img
              src={context.src}
              alt={context.alt || 'Image'}
              className="max-w-full h-auto rounded"
            />
          ) : (
            <div className="whitespace-pre-wrap">{context.text}</div>
          )}
        </div>
      )}
    </div>
  );
}
