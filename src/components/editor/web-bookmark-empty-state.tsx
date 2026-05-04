"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";
import { normaliseBookmarkUrl } from "@/lib/api/unfurl";

interface WebBookmarkEmptyStateProps {
  onSubmit: (url: string) => void;
}

/**
 * Notion-style empty state for the web bookmark block:
 * - Header: bookmark icon + "Add a web bookmark" callout-like row.
 * - User clicks the header to open a floating popup with URL input.
 * - Click outside / Esc closes the popup; the placeholder header stays.
 *
 * Note: the popup MUST start closed. The normal insert flow goes through
 * the centralized bookmark modal (via the slash command's openBookmarkModal),
 * so an empty bookmark only appears when a previous insert was abandoned.
 * Auto-opening here would re-pop the popup every time such a doc loads,
 * and the input.focus() call would scroll the page to the orphan block.
 */
export function WebBookmarkEmptyState({ onSubmit }: WebBookmarkEmptyStateProps) {
  const t = useTranslations("editor");

  const [isOpen, setIsOpen] = useState(false);
  const [url, setUrl] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus({ preventScroll: true });
  }, [isOpen]);

  const handleHeaderClick = useCallback(() => setIsOpen(true), []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const normalised = normaliseBookmarkUrl(url);
      if (normalised) onSubmit(normalised);
    },
    [url, onSubmit]
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  }, []);

  return (
    <div ref={containerRef} className="relative" onClick={(e) => e.stopPropagation()}>
      {/* Header — callout-like row, always visible */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleHeaderClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleHeaderClick();
          }
        }}
        className={cn(
          "doxmind-block-placeholder flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
          !isOpen && "cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
        )}
      >
        <Bookmark className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">{t("addWebBookmark")}</span>
      </div>

      {/* Floating popup positioned below the header */}
      {isOpen && (
        <div className="absolute left-1/2 top-full z-20 mt-2 w-[360px] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-lg border border-border/60 bg-popover p-3 shadow-lg">
          <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
            <input
              ref={inputRef}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("pasteUrlPlaceholder")}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={!url.trim()}
              className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("createBookmark")}
            </button>
            <p className="text-center text-xs text-muted-foreground">{t("createBookmarkHint")}</p>
          </form>
        </div>
      )}
    </div>
  );
}
