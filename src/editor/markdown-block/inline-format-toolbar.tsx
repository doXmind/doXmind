"use client";

import {
  Bold,
  Check,
  ChevronDown,
  Code2,
  Italic,
  Link2,
  MoreHorizontal,
  Strikethrough,
} from "lucide-react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { BlockTypeOptionIcon } from "@/editor/markdown-block/block-gutter-controls";
import type { MarkdownSettableBlockKind } from "@/editor/markdown-block/markdown-block-document";
import { cn, formatShortcut } from "@/lib/utils";

export interface InlineFormatState {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  link?: boolean;
  code?: boolean;
}

export interface InlineFormatToolbarPosition {
  top: number;
  left: number;
}

export interface InlineBlockTypeOption {
  label: string;
  kind: MarkdownSettableBlockKind;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface InlineFormatToolbarProps {
  visible: boolean;
  position?: InlineFormatToolbarPosition;
  typeLabel?: string;
  blockTypeOptions?: readonly InlineBlockTypeOption[];
  activeFormats?: InlineFormatState;
  className?: string;
  onType?: () => void;
  onTurnInto?: (option: InlineBlockTypeOption) => void;
  onBold: () => void;
  onItalic: () => void;
  onStrike: () => void;
  onLink: () => void;
  onCode: () => void;
  onMore: () => void;
}

export function InlineFormatToolbar({
  visible,
  position,
  typeLabel = "Text",
  blockTypeOptions = [],
  activeFormats = {},
  className,
  onType,
  onTurnInto,
  onBold,
  onItalic,
  onStrike,
  onLink,
  onCode,
  onMore,
}: InlineFormatToolbarProps) {
  if (!visible) return null;

  const positionStyle: CSSProperties | undefined = position
    ? {
        position: "fixed",
        top: position.top - 8,
        left: position.left,
        transform: "translate(-50%, -100%)",
      }
    : undefined;

  const preserveSelection = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
  };
  const currentTypeOption = blockTypeOptions.find((option) => option.label === typeLabel);
  const typeControl = (
    <button
      type="button"
      aria-label={`Change block type: ${typeLabel}`}
      // `editor-control` is the editor's one table of interaction states (editor.css): 20ms hover,
      // a pressed state at twice the hover tint, and the app's focus ring. The bare
      // `transition-colors` this used to carry inherited Tailwind's 150ms default, which made the
      // toolbar the slowest-reacting control on the Page by a factor of seven.
      className="editor-control flex h-8 max-w-32 items-center gap-1 rounded-lg px-2 text-xs font-medium text-foreground"
      onClick={blockTypeOptions.length && onTurnInto ? undefined : onType}
    >
      {currentTypeOption ? (
        <BlockTypeOptionIcon option={currentTypeOption} className="h-3.5 w-3.5 shrink-0" />
      ) : null}
      <span className="truncate">{typeLabel}</span>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );

  const toolbar = (
    <div
      role="toolbar"
      aria-label="Text formatting"
      aria-orientation="horizontal"
      // Portalled onto `document.body` when positioned, so the runtime's "pressed outside the
      // editor, release the caret" listener has to skip it or formatting would tear down the Block
      // whose text it is formatting.
      data-native-editor-overlay
      style={positionStyle}
      className={cn(
        "z-50 flex h-10 items-center gap-0.5 rounded-xl border border-border/80 bg-popover/95 p-1 text-popover-foreground shadow-xl backdrop-blur-xl",
        position ? "fixed" : "absolute bottom-full left-1/2 -translate-x-1/2 -translate-y-2",
        className
      )}
      onMouseDown={preserveSelection}
    >
      {blockTypeOptions.length && onTurnInto ? (
        <DropdownMenu>
          {/* Outside the trigger, not inside it: `asChild` clones its one child and injects the
              trigger's props, so a component in that slot swallows them and the menu never opens.
              This is the order `block-gutter-controls` already uses for the grip. */}
          <ToolbarTooltip label="Change block type">
            <DropdownMenuTrigger asChild>{typeControl}</DropdownMenuTrigger>
          </ToolbarTooltip>
          <DropdownMenuContent
            align="start"
            sideOffset={8}
            aria-label="Inline block types"
            // The same marker the toolbar itself carries, for the same reason. This panel is its
            // own portal onto `document.body`, so without it the editor's caret-release listener
            // read a press here as a press outside the Page: it cleared the active Block, the row
            // re-rendered, the selection that keeps this toolbar visible went with it, and the
            // button unmounted between the pointerdown and the click. Measured in the packaged
            // app, picking Heading 2 here changed nothing at all and raised no error.
            data-native-editor-overlay
            className="max-h-[min(24rem,calc(100vh-2rem))] w-52 rounded-xl border-border/80 bg-popover/95 p-1.5 shadow-xl backdrop-blur-xl"
          >
            {blockTypeOptions.map((option) => {
              const selected = option.label === typeLabel;
              return (
                <DropdownMenuItem
                  key={`${option.kind}-${option.level ?? "base"}`}
                  aria-label={option.label}
                  aria-current={selected ? "true" : undefined}
                  className="h-8 gap-2.5 rounded-lg px-2.5"
                  onClick={() => onTurnInto(option)}
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
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <ToolbarTooltip label="Change block type">{typeControl}</ToolbarTooltip>
      )}
      <span role="separator" aria-orientation="vertical" className="mx-0.5 h-5 w-px bg-border" />
      <FormatButton label="Bold" shortcut="Ctrl+B" active={activeFormats.bold} onClick={onBold}>
        <Bold className="h-4 w-4" aria-hidden="true" />
      </FormatButton>
      <FormatButton
        label="Italic"
        shortcut="Ctrl+I"
        active={activeFormats.italic}
        onClick={onItalic}
      >
        <Italic className="h-4 w-4" aria-hidden="true" />
      </FormatButton>
      <FormatButton
        label="Strikethrough"
        shortcut="Ctrl+Shift+X"
        active={activeFormats.strike}
        onClick={onStrike}
      >
        <Strikethrough className="h-4 w-4" aria-hidden="true" />
      </FormatButton>
      <FormatButton label="Link" shortcut="Ctrl+K" active={activeFormats.link} onClick={onLink}>
        <Link2 className="h-4 w-4" aria-hidden="true" />
      </FormatButton>
      <FormatButton
        label="Inline code"
        shortcut="Ctrl+E"
        active={activeFormats.code}
        onClick={onCode}
      >
        <Code2 className="h-4 w-4" aria-hidden="true" />
      </FormatButton>
      <span role="separator" aria-orientation="vertical" className="mx-0.5 h-5 w-px bg-border" />
      <ToolbarTooltip label="More actions">
        <button
          type="button"
          aria-label="More actions"
          className="editor-control flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
          onClick={onMore}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </ToolbarTooltip>
    </div>
  );
  return position && typeof document !== "undefined"
    ? createPortal(toolbar, document.body)
    : toolbar;
}

/**
 * The toolbar's own hover label.
 *
 * These controls carried a native `title` and nothing else, so the one surface in the editor made
 * entirely of unlabelled glyphs was also the only one with no readable label: measured in the
 * packaged app, hovering a format button for 1.4s put no popout in the document at all, while the
 * gutter beside it — same gesture, same 320ms — showed its own. Same component as the gutter's, so
 * both answer a hover the same way.
 */
function ToolbarTooltip({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip
      side="top"
      delayDuration={320}
      content={
        <span className="block text-center">
          {label}
          {shortcut ? <span className="ml-1.5 opacity-60">{formatShortcut(shortcut)}</span> : null}
        </span>
      }
    >
      {children}
    </Tooltip>
  );
}

function FormatButton({
  label,
  shortcut,
  active = false,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <ToolbarTooltip label={label} shortcut={shortcut}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        // No fill of its own for the lit state: `bg-muted` is the colour the shared hover tint is
        // solved to land on, so "this format is on" and "the pointer is here" painted the same
        // pixel. `editor-control` answers `aria-pressed` with the accent instead (editor.css).
        className="editor-control flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
        onClick={onClick}
      >
        {children}
      </button>
    </ToolbarTooltip>
  );
}
