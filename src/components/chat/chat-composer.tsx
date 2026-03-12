"use client";

import { useRef, useCallback, useLayoutEffect, useMemo } from "react";
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
  /** External ref to access the textarea element (for caret position, etc.) */
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  /** Intercept keydown before default handling. Return true to consume the event. */
  onKeyDownIntercept?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Slot for mention dropdown, rendered above the composer card */
  mentionDropdown?: React.ReactNode;
  /** Called when cursor position changes (click, arrow keys, typing) */
  onCursorChange?: (e: React.SyntheticEvent<HTMLTextAreaElement>) => void;
  /** Active @mention display names (without extension) to highlight in the input */
  mentionNames?: string[];
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
  textareaRef: externalTextareaRef,
  onKeyDownIntercept,
  mentionDropdown,
  onCursorChange,
  mentionNames,
}: ChatComposerProps) {
  const t = useTranslations("chat");
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalTextareaRef || internalTextareaRef;

  // Max textarea height ≈ 3 visible lines; overflow scrolls
  const MAX_TEXTAREA_HEIGHT = 72;

  // Auto-resize textarea to fit content
  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    // Reset to 0 so scrollHeight reflects true content height,
    // not inflated by CSS min-height (base Textarea has min-h-[60px])
    ta.style.height = "0px";
    ta.style.height = Math.min(ta.scrollHeight, MAX_TEXTAREA_HEIGHT) + "px";
  }, [textareaRef]);

  // Sync height before paint whenever value changes (including external clears)
  useLayoutEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (onKeyDownIntercept?.(e)) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (value.trim() && !isStreaming) {
          onSubmit();
        }
      }
    },
    [value, isStreaming, onSubmit, onKeyDownIntercept]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
      onCursorChange?.(e);
      // Resize immediately so height tracks each keystroke without waiting for re-render
      const ta = e.target;
      ta.style.height = "0px";
      ta.style.height = Math.min(ta.scrollHeight, MAX_TEXTAREA_HEIGHT) + "px";
    },
    [onChange, onCursorChange]
  );

  // Build overlay that mirrors textarea text exactly, with @mentions styled.
  // Normal text is transparent (textarea text shows through), mentions have
  // an opaque background that covers the raw @name underneath.
  const mentionOverlay = useMemo(() => {
    if (!mentionNames || mentionNames.length === 0) return null;
    const escaped = mentionNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const regex = new RegExp(`@(${escaped.join("|")})(?=\\s|$)`, "g");
    if (!regex.test(value)) return null;

    const parts: React.ReactNode[] = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    regex.lastIndex = 0;
    while ((m = regex.exec(value)) !== null) {
      if (m.index > lastIdx) {
        // Transparent text — preserves layout, textarea text shows through
        parts.push(
          <span key={`t${lastIdx}`} className="text-transparent">
            {value.slice(lastIdx, m.index)}
          </span>
        );
      }
      parts.push(
        <span key={`m${m.index}`} className="mention-tag mention-tag-input">
          {m[0]}
        </span>
      );
      lastIdx = regex.lastIndex;
    }
    if (lastIdx < value.length) {
      parts.push(
        <span key={`t${lastIdx}`} className="text-transparent">
          {value.slice(lastIdx)}
        </span>
      );
    }
    return parts;
  }, [value, mentionNames]);

  const hasContent = value.trim().length > 0;

  return (
    <div
      className={cn("relative", className)}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Mention dropdown — rendered above the card */}
      {mentionDropdown && (
        <div className="absolute bottom-full left-0 right-0 z-20 mb-2">{mentionDropdown}</div>
      )}

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

        {/* Top row: Textarea with mention highlight overlay */}
        <div className="relative">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onKeyUp={onCursorChange}
            onClick={onCursorChange}
            onPaste={onPaste}
            placeholder={placeholder}
            className="max-h-[72px] min-h-0 resize-none overflow-y-auto border-0 bg-transparent px-1 py-1.5 text-base shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 md:text-sm"
            disabled={disabled || isStreaming}
            rows={1}
          />
          {/* Mirror overlay — shows styled @mentions; pointer events pass through to textarea */}
          {mentionOverlay && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-1 py-1.5 text-base text-foreground md:text-sm"
            >
              {mentionOverlay}
            </div>
          )}
        </div>

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
