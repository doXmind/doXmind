"use client";

import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  ClipboardCopy,
  Code,
  Copy,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Info,
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  MENU_ICON_CLASS,
  MENU_PANEL_CLASS,
} from "@/components/ui/dropdown-menu";
import type {
  MarkdownBlockKind,
  MarkdownContainerTurnIntoKind,
  MarkdownSettableBlockKind,
} from "@/editor/markdown-block/markdown-block-document";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface TurnIntoOption {
  label: string;
  kind: MarkdownSettableBlockKind | MarkdownContainerTurnIntoKind;
  level?: HeadingLevel;
  keywords: string;
}

// Notion's own Turn Into list, measured live: …Bulleted list, Numbered list, To-do list, Toggle
// list, Code, Quote, Callout… — Toggle and Code sit between To-do and Quote, Callout after it.
// Table and Divider are in Notion's slash menu but not reachable from Turn Into, so neither is
// added here despite both existing as Block kinds.
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
  { label: "Toggle", kind: "toggle", keywords: "details collapse expand" },
  { label: "Code", kind: "fenced_code", keywords: "fence code block" },
  { label: "Quote", kind: "blockquote", keywords: "blockquote citation" },
  { label: "Callout", kind: "callout", keywords: "note callout" },
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
  className = MENU_ICON_CLASS,
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
              : option.kind === "toggle"
                ? ChevronRight
                : option.kind === "fenced_code"
                  ? Code
                  : option.kind === "callout"
                    ? Info
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
  /** Lets the row pin the controls visible while this menu owns focus. */
  onMenuOpenChange?: (open: boolean) => void;
  /** `above` when the user Option/Alt-clicked, matching Notion's "⌥-click to add above". */
  onAdd: (placement: "below" | "above") => void;
  onTurnInto: (
    kind: MarkdownSettableBlockKind | MarkdownContainerTurnIntoKind,
    level?: HeadingLevel
  ) => void;
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
  onMenuOpenChange,
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
  const searchRef = useRef<HTMLInputElement>(null);
  const gripRef = useRef<HTMLButtonElement>(null);
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
  const currentBlockLabel =
    TURN_INTO_OPTIONS.find(
      (option) =>
        option.kind === currentKind && (option.kind !== "heading" || option.level === currentLevel)
    )?.label ?? "Source block";

  const renderTurnIntoOption = (option: TurnIntoOption) => {
    const selected =
      currentKind === option.kind && (option.kind !== "heading" || currentLevel === option.level);
    return (
      <DropdownMenuItem
        key={`${option.kind}-${option.level ?? "base"}`}
        aria-label={option.label}
        aria-current={selected ? "true" : undefined}
        disabled={!canTurnInto}
        onClick={() => onTurnInto(option.kind, option.level)}
        className="gap-2.5"
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
  };

  useEffect(() => {
    if (!menuOpen) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [menuOpen]);

  const handleOpenChange = (open: boolean) => {
    setMenuOpen(open);
    onMenuOpenChange?.(open);
    if (!open) {
      setQuery("");
      // Radix returns focus to the trigger for us in most paths, but not after an item that
      // re-renders the row (Move up, Turn into). Without this the next keystroke goes to <body>.
      window.setTimeout(() => gripRef.current?.focus({ preventScroll: true }), 0);
    }
  };

  return (
    <div
      role="group"
      aria-label="Block controls"
      // `leading-[0]` is what keeps the two 24×24 controls level. The grip's trigger is wrapped by
      // `DropdownMenu` in an `inline-block`, so its flex item is a line box, not the button: at the
      // row's inherited 28px line-height that item measured 28px tall against the `+`'s 24px, and
      // `items-center` then dropped the `+` exactly 2.00px below the grip on all 48 rows of a
      // fixture. With no leading to add, the line box is the 24px button and both resolve alike.
      className={cn("flex items-center gap-0.5 leading-[0]", className)}
    >
      <Tooltip
        side="top"
        delayDuration={320}
        content={
          <span className="block text-center">
            Click to add below
            <span className="block opacity-60">⌥-click to add above</span>
          </span>
        }
      >
        <button
          type="button"
          aria-label="Add block"
          aria-describedby={describedBy}
          tabIndex={buttonTabIndex}
          // 20ms hover feedback, measured from Notion. Tailwind's default 150ms `transition-colors`
          // makes a pointer-tracking control feel like it is lagging behind the cursor.
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors duration-[20ms] ease-in hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={(event) => onAdd(event.altKey ? "above" : "below")}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </Tooltip>
      <DropdownMenu open={menuOpen} onOpenChange={handleOpenChange}>
        <Tooltip
          side="top"
          delayDuration={320}
          content={
            <span className="block text-center">
              Drag to move
              <span className="block opacity-60">Click to open menu</span>
              {/* The only route into this menu from the text is the shortcut, and nothing named it
                  anywhere the user could read. `aria-keyshortcuts` below says the same thing to
                  assistive tech, which cannot see a tooltip. */}
              <span className="block opacity-60">⌘/ or Ctrl+/ to open</span>
            </span>
          }
        >
          <DropdownMenuTrigger asChild>
            <button
              ref={gripRef}
              type="button"
              aria-label="Block actions"
              aria-describedby={describedBy}
              aria-keyshortcuts="Meta+/ Control+/"
              draggable={draggable}
              tabIndex={buttonTabIndex}
              className="flex h-6 w-6 cursor-grab items-center justify-center rounded text-muted-foreground transition-colors duration-[20ms] ease-in hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:cursor-grabbing data-[state=open]:bg-muted data-[state=open]:text-foreground"
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            >
              <GripVertical className="h-4 w-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          aria-label="Block actions menu"
          // Notion's measured menu chrome: 265px wide, 10px radius, opaque surface, and a layered
          // shadow whose outermost layer is a hairline ring instead of a border. No backdrop blur —
          // blurring a menu that opens next to the caret costs a full-screen composite per frame.
          className={`max-h-[min(28rem,calc(100vh-2rem))] w-[265px] ${MENU_PANEL_CLASS}`}
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
                onChange={(event) => setQuery(event.target.value)}
                onMouseDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Escape") handleOpenChange(false);
                }}
              />
            </div>
          </div>

          {!normalizedQuery ? (
            <>
              <DropdownMenuLabel className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {currentBlockLabel}
              </DropdownMenuLabel>
              {/* Notion's "Turn into ▸", and for the reason Notion draws the ▸ rather than a list.
                  This row used to swap the panel's contents for the type list in place, deliberately
                  — one panel, no second surface to aim at. Measured, that swap grew the panel from
                  270.5px to 396.0px in a single unanimated frame under a pointer that had not moved,
                  and the pixel under the pointer changed from "Turn into" to "Text": a second press
                  at the same point, at gaps of 80/120/200/350ms, retyped `## Heading two alpha` into
                  a paragraph 4/4. Undoable, but an edit nobody asked for. Opening beside the panel
                  removes it structurally rather than by timing — the parent's box never changes, so
                  the row under the pointer is still the row the pointer chose. It also ends the
                  clipping the growth caused; see the flip/fit pass in dropdown-menu.tsx. */}
              <DropdownMenuSub>
                {/* The shared trigger draws its own ▸ at the 16px icon size. This panel's trailing
                    marks — the Check on the current kind, the ⌘ hints — are 14px muted, so the
                    chevron is brought down to them rather than shouting over the row it belongs to. */}
                <DropdownMenuSubTrigger className="gap-2.5 [&>svg:last-child]:h-3.5 [&>svg:last-child]:w-3.5 [&>svg:last-child]:text-muted-foreground">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
                    <RefreshCw className={MENU_ICON_CLASS} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 text-left">Turn into</span>
                </DropdownMenuSubTrigger>
                {/* Right, not the primitive's leftward default: the gutter sits at the left edge of
                    the content column, so the only side with room is the one Notion uses anyway. */}
                <DropdownMenuSubContent side="right" aria-label="Turn into" className="w-[265px]">
                  {TURN_INTO_OPTIONS.map(renderTurnIntoOption)}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {/* A query searches both halves at once, so the matching types stay flat in this panel
              rather than hiding behind the submenu the search box would have to be left to reach. */}
          {normalizedQuery && turnIntoOptions.length ? (
            <>{turnIntoOptions.map(renderTurnIntoOption)}</>
          ) : null}
          {normalizedQuery && turnIntoOptions.length && hasMatchingAction ? (
            <DropdownMenuSeparator />
          ) : null}
          {matchingActions.copy ? (
            <DropdownMenuItem
              aria-label="Copy Markdown"
              onClick={() => void onCopyMarkdown()}
              className="gap-2.5"
            >
              <ClipboardCopy
                className={`${MENU_ICON_CLASS} text-muted-foreground`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 text-left">Copy Markdown</span>
            </DropdownMenuItem>
          ) : null}
          {matchingActions.duplicate ? (
            <DropdownMenuItem aria-label="Duplicate" onClick={onDuplicate} className="gap-2.5">
              <Copy className={`${MENU_ICON_CLASS} text-muted-foreground`} aria-hidden="true" />
              <span className="min-w-0 flex-1 text-left">Duplicate</span>
              <kbd className="text-[10px] text-muted-foreground">⌘D</kbd>
            </DropdownMenuItem>
          ) : null}
          {matchingActions.moveUp ? (
            <DropdownMenuItem
              aria-label="Move up"
              disabled={!canMoveUp}
              onClick={onMoveUp}
              className="gap-2.5"
            >
              <ArrowUp className={`${MENU_ICON_CLASS} text-muted-foreground`} aria-hidden="true" />
              <span className="min-w-0 flex-1 text-left">Move up</span>
              <kbd className="text-[10px] text-muted-foreground">⌥↑</kbd>
            </DropdownMenuItem>
          ) : null}
          {matchingActions.moveDown ? (
            <DropdownMenuItem
              aria-label="Move down"
              disabled={!canMoveDown}
              onClick={onMoveDown}
              className="gap-2.5"
            >
              <ArrowDown
                className={`${MENU_ICON_CLASS} text-muted-foreground`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 text-left">Move down</span>
              <kbd className="text-[10px] text-muted-foreground">⌥↓</kbd>
            </DropdownMenuItem>
          ) : null}
          {matchingActions.delete ? (
            <>
              {!normalizedQuery ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                aria-label="Delete"
                onClick={onDelete}
                className="gap-2.5 text-destructive focus-visible:ring-destructive"
              >
                <Trash2 className={MENU_ICON_CLASS} aria-hidden="true" />
                <span className="min-w-0 flex-1 text-left">Delete</span>
                <kbd className="text-[10px] opacity-70">⌘⇧⌫</kbd>
              </DropdownMenuItem>
            </>
          ) : null}
          {normalizedQuery && !turnIntoOptions.length && !hasMatchingAction ? (
            <p className="px-3 py-5 text-center text-xs text-muted-foreground">
              No matching actions
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
