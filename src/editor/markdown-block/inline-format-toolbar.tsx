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
import { BlockTypeOptionIcon } from "@/editor/markdown-block/block-gutter-controls";
import type { MarkdownSettableBlockKind } from "@/editor/markdown-block/markdown-block-document";
import { cn } from "@/lib/utils";

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
      title="Change block type"
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
          <DropdownMenuTrigger asChild>{typeControl}</DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={8}
            aria-label="Inline block types"
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
        typeControl
      )}
      <span role="separator" aria-orientation="vertical" className="mx-0.5 h-5 w-px bg-border" />
      <FormatButton label="Bold" active={activeFormats.bold} onClick={onBold}>
        <Bold className="h-4 w-4" aria-hidden="true" />
      </FormatButton>
      <FormatButton label="Italic" active={activeFormats.italic} onClick={onItalic}>
        <Italic className="h-4 w-4" aria-hidden="true" />
      </FormatButton>
      <FormatButton label="Strikethrough" active={activeFormats.strike} onClick={onStrike}>
        <Strikethrough className="h-4 w-4" aria-hidden="true" />
      </FormatButton>
      <FormatButton label="Link" active={activeFormats.link} onClick={onLink}>
        <Link2 className="h-4 w-4" aria-hidden="true" />
      </FormatButton>
      <FormatButton label="Inline code" active={activeFormats.code} onClick={onCode}>
        <Code2 className="h-4 w-4" aria-hidden="true" />
      </FormatButton>
      <span role="separator" aria-orientation="vertical" className="mx-0.5 h-5 w-px bg-border" />
      <button
        type="button"
        aria-label="More actions"
        title="More actions"
        className="editor-control flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
        onClick={onMore}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
  return position && typeof document !== "undefined"
    ? createPortal(toolbar, document.body)
    : toolbar;
}

function FormatButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "editor-control flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground",
        active && "bg-muted text-foreground"
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
