"use client";

import { useRef, useCallback, useLayoutEffect } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  isStreaming?: boolean;
  placeholder?: string;
  disabled?: boolean;
  /** Slot for left-side action buttons (attachment, settings) */
  leftActions?: React.ReactNode;
  /** Slot for context pills rendered above the input row */
  contextSlot?: React.ReactNode;
  /** Handle paste events (e.g., for images) */
  onPaste?: (e: React.ClipboardEvent) => void;
  /** Handle drag-and-drop */
  onDragEnter?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  isDragging?: boolean;
  /** Show "Press Enter to send" hint */
  showHint?: boolean;
  /** Additional buttons before send (e.g., mic, clear) */
  extraActions?: React.ReactNode;
  className?: string;
}

/**
 * Shared rounded-card input composer.
 * GPT-inspired two-row layout: textarea on top, action buttons on bottom.
 */
export function ChatComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming = false,
  placeholder = "Message...",
  disabled = false,
  leftActions,
  contextSlot,
  onPaste,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  isDragging = false,
  showHint = false,
  extraActions,
  className,
}: ChatComposerProps) {
  const t = useTranslations("chat");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea to fit content
  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    // Reset to 0 so scrollHeight reflects true content height,
    // not inflated by CSS min-height (base Textarea has min-h-[60px])
    ta.style.height = "0px";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, []);

  // Sync height before paint whenever value changes (including external clears)
  useLayoutEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (value.trim() && !isStreaming) {
          onSubmit();
        }
      }
    },
    [value, isStreaming, onSubmit]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
      // Resize immediately so height tracks each keystroke without waiting for re-render
      const ta = e.target;
      ta.style.height = "0px";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    },
    [onChange]
  );

  const hasContent = value.trim().length > 0;

  return (
    <div
      className={cn("relative", className)}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-background/80 backdrop-blur-sm">
          <span className="text-sm font-medium text-primary">{t("dropFilesHere")}</span>
        </div>
      )}

      <div
        className={cn(
          "relative flex flex-col rounded-2xl border px-3 py-2 transition-all duration-200",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border/60 bg-card/80 shadow-sm focus-within:border-foreground/15 focus-within:shadow-lg"
        )}
      >
        {/* Context pills row */}
        {contextSlot}

        {/* Top row: Textarea */}
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          className="max-h-[200px] min-h-0 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-base shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 md:text-sm"
          disabled={disabled || isStreaming}
          rows={1}
        />

        {/* Bottom row: Actions */}
        <div className="flex items-center gap-1.5 pt-1">
          {/* Left action buttons */}
          {leftActions}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Extra actions (mic, clear, etc.) */}
          {extraActions}

          {/* Send / Stop button */}
          {isStreaming ? (
            <Tooltip content={t("stopGenerating")} side="top">
              <button
                type="button"
                onClick={onStop}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-foreground/90"
                aria-label={t("stopGenerating")}
              >
                <Square className="h-4 w-4" />
              </button>
            </Tooltip>
          ) : (
            <Tooltip content={t("sendMessage")} side="top">
              <button
                type="button"
                onClick={() => hasContent && onSubmit()}
                disabled={!hasContent}
                className={cn(
                  "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors",
                  hasContent
                    ? "bg-foreground text-background hover:bg-foreground/90"
                    : "bg-muted text-muted-foreground"
                )}
                aria-label={t("sendMessage")}
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Hint text */}
      {showHint && (
        <p className="mt-1.5 hidden text-center text-[11px] text-muted-foreground/50 dark:text-muted-foreground/70 md:block">
          {t("pressEnterHint")}
        </p>
      )}
    </div>
  );
}
