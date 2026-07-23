"use client";

import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Copy,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  List,
  ListChecks,
  ListOrdered,
  Pilcrow,
  Plus,
  RefreshCw,
  Search,
  TextQuote,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { type DragEventHandler, useEffect, useMemo, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  MarkdownBlockKind,
  MarkdownSettableBlockKind,
} from "@/editor/markdown-block/markdown-block-document";
import { cn } from "@/lib/utils";

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface TurnIntoOption {
  label: string;
  kind: MarkdownSettableBlockKind;
  level?: HeadingLevel;
  keywords: string;
}

export const TURN_INTO_OPTIONS: readonly TurnIntoOption[] = [
  { label: "Text", kind: "paragraph", keywords: "paragraph plain" },
  { label: "Heading 1", kind: "heading", level: 1, keywords: "h1 title" },
  { label: "Heading 2", kind: "heading", level: 2, keywords: "h2 subtitle" },
  { label: "Heading 3", kind: "heading", level: 3, keywords: "h3" },
  { label: "Heading 4", kind: "heading", level: 4, keywords: "h4" },
  { label: "Heading 5", kind: "heading", level: 5, keywords: "h5" },
  { label: "Heading 6", kind: "heading", level: 6, keywords: "h6" },
  { label: "Bulleted list", kind: "bullet_list_item", keywords: "unordered bullet" },
  { label: "Numbered list", kind: "ordered_list_item", keywords: "ordered number" },
  { label: "To-do", kind: "task_list_item", keywords: "todo task checkbox" },
  { label: "Quote", kind: "blockquote", keywords: "blockquote citation" },
];

const HEADING_ICONS: Record<HeadingLevel, LucideIcon> = {
  1: Heading1,
  2: Heading2,
  3: Heading3,
  4: Heading4,
  5: Heading5,
  6: Heading6,
};

export function BlockTypeOptionIcon({
  option,
  className = "h-4 w-4",
}: {
  option: Pick<TurnIntoOption, "kind" | "level">;
  className?: string;
}) {
  const Icon =
    option.kind === "heading"
      ? HEADING_ICONS[option.level ?? 1]
      : option.kind === "bullet_list_item"
        ? List
        : option.kind === "ordered_list_item"
          ? ListOrdered
          : option.kind === "task_list_item"
            ? ListChecks
            : option.kind === "blockquote"
              ? TextQuote
              : Pilcrow;
  return <Icon className={className} aria-hidden="true" />;
}

export interface BlockGutterControlsProps {
  currentKind: MarkdownBlockKind;
  currentLevel?: HeadingLevel;
  className?: string;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  canTurnInto?: boolean;
  draggable?: boolean;
  buttonTabIndex?: number;
  describedBy?: string;
  onAdd: () => void;
  onTurnInto: (kind: MarkdownSettableBlockKind, level?: HeadingLevel) => void;
  onCopyMarkdown: () => void | Promise<void>;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onDragStart?: DragEventHandler<HTMLButtonElement>;
  onDragEnd?: DragEventHandler<HTMLButtonElement>;
}

export function BlockGutterControls({
  currentKind,
  currentLevel,
  className,
  canMoveUp = true,
  canMoveDown = true,
  canTurnInto = true,
  draggable = true,
  buttonTabIndex,
  describedBy,
  onAdd,
  onTurnInto,
  onCopyMarkdown,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onDelete,
  onDragStart,
  onDragEnd,
}: BlockGutterControlsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [turnIntoOpen, setTurnIntoOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const turnIntoOptions = useMemo(
    () =>
      TURN_INTO_OPTIONS.filter((option) =>
        `${option.label} ${option.keywords}`.toLocaleLowerCase().includes(normalizedQuery)
      ),
    [normalizedQuery]
  );
  const matchesAction = (...terms: string[]) =>
    !normalizedQuery || terms.some((term) => term.toLocaleLowerCase().includes(normalizedQuery));
  const matchingActions = {
    copy: matchesAction("Copy Markdown", "copy source"),
    duplicate: matchesAction("Duplicate", "clone"),
    moveUp: matchesAction("Move up", "reorder"),
    moveDown: matchesAction("Move down", "reorder"),
    delete: matchesAction("Delete", "remove"),
  };
  const hasMatchingAction = Object.values(matchingActions).some(Boolean);
  const showTurnIntoOptions = Boolean(normalizedQuery) || turnIntoOpen;
  const showActions = Boolean(normalizedQuery) || !turnIntoOpen;
  const currentBlockLabel =
    TURN_INTO_OPTIONS.find(
      (option) =>
        option.kind === currentKind && (option.kind !== "heading" || option.level === currentLevel)
    )?.label ?? "Source block";

  useEffect(() => {
    if (!menuOpen) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [menuOpen]);

  const handleOpenChange = (open: boolean) => {
    setMenuOpen(open);
    if (!open) {
      setQuery("");
      setTurnIntoOpen(false);
    }
  };

  return (
    <div
      role="group"
      aria-label="Block controls"
      className={cn("flex items-center gap-0.5", className)}
    >
      <button
        type="button"
        aria-label="Add block"
        aria-describedby={describedBy}
        title="Add block"
        tabIndex={buttonTabIndex}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={onAdd}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
      <DropdownMenu open={menuOpen} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Block actions"
            aria-describedby={describedBy}
            title="Drag to move · Click for actions"
            draggable={draggable}
            tabIndex={buttonTabIndex}
            className="flex h-7 w-7 cursor-grab items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:cursor-grabbing"
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          >
            <GripVertical className="h-4 w-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          aria-label="Block actions menu"
          className="max-h-[min(28rem,calc(100vh-2rem))] w-60 rounded-xl border-border/80 bg-popover/95 p-1.5 shadow-xl backdrop-blur-xl"
        >
          <div className="p-1">
            <div className="flex h-9 items-center gap-2 rounded-lg border border-border/80 bg-background/70 px-2.5 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/25">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                aria-label="Search block actions"
                placeholder="Search actions…"
                value={query}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
                onChange={(event) => {
                  setQuery(event.target.value);
                  if (event.target.value.trim()) setTurnIntoOpen(false);
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Escape") handleOpenChange(false);
                }}
              />
            </div>
          </div>

          {!normalizedQuery && !turnIntoOpen ? (
            <>
              <DropdownMenuLabel className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {currentBlockLabel}
              </DropdownMenuLabel>
              <button
                type="button"
                role="menuitem"
                aria-label="Turn into"
                className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
                onClick={() => setTurnIntoOpen(true)}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 text-left">Turn into</span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              </button>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {!normalizedQuery && turnIntoOpen ? (
            <button
              type="button"
              role="menuitem"
              aria-label="Back to block actions"
              className="mb-1 flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
              onClick={() => setTurnIntoOpen(false)}
            >
              <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 text-left">Turn into</span>
            </button>
          ) : null}
          {showTurnIntoOptions && turnIntoOptions.length ? (
            <>
              {turnIntoOptions.map((option) => {
                const selected =
                  currentKind === option.kind &&
                  (option.kind !== "heading" || currentLevel === option.level);
                return (
                  <DropdownMenuItem
                    key={`${option.kind}-${option.level ?? "base"}`}
                    aria-label={option.label}
                    aria-current={selected ? "true" : undefined}
                    disabled={!canTurnInto}
                    onClick={() => onTurnInto(option.kind, option.level)}
                    className="h-8 gap-2.5 rounded-lg px-2.5"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
                      <BlockTypeOptionIcon option={option} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-left">{option.label}</span>
                    {selected ? (
                      <Check className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    ) : null}
                  </DropdownMenuItem>
                );
              })}
            </>
          ) : null}
          {showTurnIntoOptions && showActions && turnIntoOptions.length && hasMatchingAction ? (
            <DropdownMenuSeparator />
          ) : null}
          {showActions && matchingActions.copy ? (
            <DropdownMenuItem
              aria-label="Copy Markdown"
              onClick={() => void onCopyMarkdown()}
              className="h-8 gap-2.5 rounded-lg px-2.5"
            >
              <ClipboardCopy className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 text-left">Copy Markdown</span>
            </DropdownMenuItem>
          ) : null}
          {showActions && matchingActions.duplicate ? (
            <DropdownMenuItem
              aria-label="Duplicate"
              onClick={onDuplicate}
              className="h-8 gap-2.5 rounded-lg px-2.5"
            >
              <Copy className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 text-left">Duplicate</span>
              <kbd className="text-[10px] text-muted-foreground">⌘⇧D</kbd>
            </DropdownMenuItem>
          ) : null}
          {showActions && matchingActions.moveUp ? (
            <DropdownMenuItem
              aria-label="Move up"
              disabled={!canMoveUp}
              onClick={onMoveUp}
              className="h-8 gap-2.5 rounded-lg px-2.5"
            >
              <ArrowUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 text-left">Move up</span>
              <kbd className="text-[10px] text-muted-foreground">⌥↑</kbd>
            </DropdownMenuItem>
          ) : null}
          {showActions && matchingActions.moveDown ? (
            <DropdownMenuItem
              aria-label="Move down"
              disabled={!canMoveDown}
              onClick={onMoveDown}
              className="h-8 gap-2.5 rounded-lg px-2.5"
            >
              <ArrowDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 text-left">Move down</span>
              <kbd className="text-[10px] text-muted-foreground">⌥↓</kbd>
            </DropdownMenuItem>
          ) : null}
          {showActions && matchingActions.delete ? (
            <>
              {!normalizedQuery ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                aria-label="Delete"
                onClick={onDelete}
                className="h-8 gap-2.5 rounded-lg px-2.5 text-destructive focus-visible:ring-destructive"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                <span className="min-w-0 flex-1 text-left">Delete</span>
                <kbd className="text-[10px] opacity-70">⌘⇧⌫</kbd>
              </DropdownMenuItem>
            </>
          ) : null}
          {showTurnIntoOptions &&
          showActions &&
          !turnIntoOptions.length &&
          !hasMatchingAction &&
          normalizedQuery ? (
            <p className="px-3 py-5 text-center text-xs text-muted-foreground">
              No matching actions
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
