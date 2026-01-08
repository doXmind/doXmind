"use client";

import { BubbleMenu, Editor } from "@tiptap/react";
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Trash2,
  Combine,
  SplitSquareHorizontal,
  TableProperties,
  Trash,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TableBubbleMenuProps {
  editor: Editor;
}

export function TableBubbleMenu({ editor }: TableBubbleMenuProps) {
  return (
    <BubbleMenu
      editor={editor}
      tippyOptions={{
        duration: 100,
        placement: "top",
        offset: [0, 10],
      }}
      shouldShow={({ editor }) => {
        return editor.isActive("table");
      }}
      className="table-bubble-menu flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-lg"
    >
      {/* Row Operations */}
      <div className="flex items-center gap-0.5">
        <TableButton
          icon={<ArrowUp className="h-4 w-4" />}
          onClick={() => editor.chain().focus().addRowBefore().run()}
          tooltip="Insert row above"
        />
        <TableButton
          icon={<ArrowDown className="h-4 w-4" />}
          onClick={() => editor.chain().focus().addRowAfter().run()}
          tooltip="Insert row below"
        />
        <TableButton
          icon={<Trash2 className="h-4 w-4" />}
          onClick={() => editor.chain().focus().deleteRow().run()}
          tooltip="Delete row"
        />
      </div>

      <div className="w-px h-5 bg-border mx-1" />

      {/* Column Operations */}
      <div className="flex items-center gap-0.5">
        <TableButton
          icon={<ArrowLeft className="h-4 w-4" />}
          onClick={() => editor.chain().focus().addColumnBefore().run()}
          tooltip="Insert column left"
        />
        <TableButton
          icon={<ArrowRight className="h-4 w-4" />}
          onClick={() => editor.chain().focus().addColumnAfter().run()}
          tooltip="Insert column right"
        />
        <TableButton
          icon={<Trash2 className="h-4 w-4" />}
          onClick={() => editor.chain().focus().deleteColumn().run()}
          tooltip="Delete column"
        />
      </div>

      <div className="w-px h-5 bg-border mx-1" />

      {/* Cell Operations */}
      <div className="flex items-center gap-0.5">
        <TableButton
          icon={<Combine className="h-4 w-4" />}
          onClick={() => editor.chain().focus().mergeCells().run()}
          tooltip="Merge cells"
          disabled={!editor.can().mergeCells()}
        />
        <TableButton
          icon={<SplitSquareHorizontal className="h-4 w-4" />}
          onClick={() => editor.chain().focus().splitCell().run()}
          tooltip="Split cell"
          disabled={!editor.can().splitCell()}
        />
      </div>

      <div className="w-px h-5 bg-border mx-1" />

      {/* Header & Delete */}
      <div className="flex items-center gap-0.5">
        <TableButton
          icon={<TableProperties className="h-4 w-4" />}
          onClick={() => editor.chain().focus().toggleHeaderRow().run()}
          tooltip="Toggle header row"
        />
        <TableButton
          icon={<Trash className="h-4 w-4" />}
          onClick={() => editor.chain().focus().deleteTable().run()}
          tooltip="Delete table"
          className="text-destructive hover:text-destructive"
        />
      </div>
    </BubbleMenu>
  );
}

interface TableButtonProps {
  icon: React.ReactNode;
  onClick: () => void;
  tooltip?: string;
  disabled?: boolean;
  className?: string;
}

function TableButton({
  icon,
  onClick,
  tooltip,
  disabled,
  className,
}: TableButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className={cn(
        "h-7 w-7",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      {icon}
    </Button>
  );
}
