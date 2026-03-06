"use client";

import { useState, memo } from "react";
import { ChevronDown, ChevronRight, X, FileText, ImageIcon, Copy, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ChatContextItem } from "@/stores/chat-context-store";
import { cn } from "@/lib/utils";

interface ContextPillProps {
  context: ChatContextItem;
  onRemove: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
  showActions?: boolean;
}

/**
 * Context Pill component - shows selected text or image as a collapsible pill.
 * Cursor-style UI for displaying attached content in chat input.
 */
export const ContextPill = memo(function ContextPill({
  context,
  onRemove,
  onCopy,
  onDelete,
  showActions,
}: ContextPillProps) {
  const t = useTranslations("chat");
  const tc = useTranslations("common");
  const [isExpanded, setIsExpanded] = useState(true);

  const isImage = context.type === "image";
  const isSelection = context.type === "selection" || context.type === "inline_result";
  const isInlineResult = context.type === "inline_result";
  const isEmptySelection = isSelection && !context.text.trim();
  const Icon = isImage ? ImageIcon : FileText;
  const label = isImage
    ? `${t("imageContext")}${context.alt ? `: ${context.alt}` : ""}`
    : isInlineResult
      ? t("inlineResultContext")
      : isEmptySelection
        ? t("emptyBlock")
        : t("selectedTextChars", { count: context.text.length });

  // Show action buttons for selection contexts when showActions is true
  const shouldShowActions = showActions && isSelection;

  return (
    <div className="overflow-hidden rounded-md border border-border/60 bg-muted/20">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:text-primary"
        >
          <Icon className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
          <span className="truncate text-muted-foreground">{label}</span>
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
          )}
        </button>

        {/* Action buttons: Copy, Delete */}
        {shouldShowActions && (
          <div className="flex items-center gap-1">
            {onCopy && !isEmptySelection && (
              <button
                type="button"
                onClick={onCopy}
                className={cn(
                  "flex-shrink-0 rounded p-1.5 transition-colors",
                  "bg-primary/10 text-primary hover:bg-primary/20"
                )}
                title={tc("copy")}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className={cn(
                  "flex-shrink-0 rounded p-1.5 transition-colors",
                  "bg-destructive/10 text-destructive hover:bg-destructive/20"
                )}
                title={tc("delete")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={onRemove}
          className="flex-shrink-0 rounded p-1 transition-colors hover:bg-accent"
          title={t("removeContext")}
        >
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
      {isExpanded && (
        <div className="max-h-[120px] overflow-y-auto border-t border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
          {isImage ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={context.src}
              alt={context.alt || "Image"}
              className="h-auto max-w-full rounded"
            />
          ) : (
            <div className="whitespace-pre-wrap">
              {context.text.length > 100 ? `${context.text.slice(0, 100)}...` : context.text}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
