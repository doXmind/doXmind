"use client";

/**
 * Find & Replace floating panel — anchored top-right of the sheet area.
 *
 * Search runs against the cell's *display value* (post number-format), not
 * the raw formula, so what the user types matches what they actually see.
 * Replacements are written back via the workspace's cell-update batching;
 * formulas are left untouched and skipped during replace-all to avoid
 * corrupting computed cells.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface FindMatch {
  row: number;
  col: number;
}

interface ExcelFindReplacePanelProps {
  initialQuery?: string;
  matchCount: number;
  currentMatch: FindMatch | null;
  matchCaseEnabled: boolean;
  matchWholeCellEnabled: boolean;
  onQueryChange(query: string): void;
  onReplaceTextChange(text: string): void;
  onMatchCaseChange(enabled: boolean): void;
  onMatchWholeCellChange(enabled: boolean): void;
  onFindNext(): void;
  onFindPrev(): void;
  onReplace(): void;
  onReplaceAll(): void;
  onClose(): void;
}

export function ExcelFindReplacePanel({
  initialQuery,
  matchCount,
  currentMatch,
  matchCaseEnabled,
  matchWholeCellEnabled,
  onQueryChange,
  onReplaceTextChange,
  onMatchCaseChange,
  onMatchWholeCellChange,
  onFindNext,
  onFindPrev,
  onReplace,
  onReplaceAll,
  onClose,
}: ExcelFindReplacePanelProps) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [replaceText, setReplaceText] = useState("");
  const findInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus + select on open so the user can start typing immediately.
  useEffect(() => {
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, []);

  // Bridge local state to parent so the workspace can compute matches.
  useEffect(() => {
    onQueryChange(query);
  }, [query, onQueryChange]);
  useEffect(() => {
    onReplaceTextChange(replaceText);
  }, [replaceText, onReplaceTextChange]);

  return (
    <div
      role="dialog"
      aria-label="Find and replace"
      className="animate-in fade-in-0 zoom-in-95 absolute right-3 top-3 z-30 w-80 rounded-md border border-border/60 bg-popover p-3 text-popover-foreground shadow-lg"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-ui-xs font-semibold text-foreground/90">Find &amp; replace</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onClose}
          aria-label="Close find and replace"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex items-center gap-1">
        <input
          ref={findInputRef}
          type="text"
          value={query}
          placeholder="Find"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (event.shiftKey) onFindPrev();
              else onFindNext();
            }
          }}
          className="text-ui-sm bg-sidebar h-7 flex-1 rounded-md border border-border/70 px-2 text-foreground outline-none focus:border-primary/40"
        />
        <Tooltip content="Previous (⇧⏎)" side="bottom">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={matchCount === 0}
            onClick={onFindPrev}
            aria-label="Previous match"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
        </Tooltip>
        <Tooltip content="Next (⏎)" side="bottom">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={matchCount === 0}
            onClick={onFindNext}
            aria-label="Next match"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </Tooltip>
      </div>

      <input
        type="text"
        value={replaceText}
        placeholder="Replace with"
        spellCheck={false}
        onChange={(event) => setReplaceText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.metaKey || event.ctrlKey) onReplaceAll();
            else onReplace();
          }
        }}
        className="text-ui-sm bg-sidebar mt-2 h-7 w-full rounded-md border border-border/70 px-2 text-foreground outline-none focus:border-primary/40"
      />

      <div className="mt-2 flex items-center gap-3">
        <label className="text-ui-xs flex items-center gap-1.5 text-muted-foreground">
          <input
            type="checkbox"
            checked={matchCaseEnabled}
            onChange={(event) => onMatchCaseChange(event.target.checked)}
            className="h-3 w-3 cursor-pointer"
          />
          Match case
        </label>
        <label className="text-ui-xs flex items-center gap-1.5 text-muted-foreground">
          <input
            type="checkbox"
            checked={matchWholeCellEnabled}
            onChange={(event) => onMatchWholeCellChange(event.target.checked)}
            className="h-3 w-3 cursor-pointer"
          />
          Whole cell
        </label>
      </div>

      <div className="mt-3 flex items-center justify-between gap-1">
        <span className={cn("text-ui-xs text-muted-foreground")}>
          {matchCount === 0
            ? query
              ? "No matches"
              : ""
            : `${currentMatch ? "Match" : "Found"} ${matchCount}`}
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            disabled={matchCount === 0}
            onClick={onReplace}
          >
            Replace
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            disabled={matchCount === 0}
            onClick={onReplaceAll}
          >
            Replace all
          </Button>
        </div>
      </div>
    </div>
  );
}
