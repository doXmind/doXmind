"use client";

import { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { ArrowLeft, ArrowRight, Copy, Trash2, Eraser, TableProperties } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  focusCellAt,
  duplicateColumn,
  clearColumn,
  isHeaderColumnActive,
} from "@/lib/table-operations";

interface TableColumnMenuProps {
  editor: Editor;
  tablePos: number;
  colIndex: number;
  position: { x: number; y: number };
  colCount: number;
  onClose: () => void;
}

export function TableColumnMenu({
  editor,
  tablePos,
  colIndex,
  position,
  colCount,
  onClose,
}: TableColumnMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleScroll = () => onClose();
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleInsertLeft = useCallback(() => {
    focusCellAt(editor, tablePos, 0, colIndex);
    editor.chain().focus().addColumnBefore().run();
    onClose();
  }, [editor, tablePos, colIndex, onClose]);

  const handleInsertRight = useCallback(() => {
    focusCellAt(editor, tablePos, 0, colIndex);
    editor.chain().focus().addColumnAfter().run();
    onClose();
  }, [editor, tablePos, colIndex, onClose]);

  const handleToggleHeader = useCallback(() => {
    focusCellAt(editor, tablePos, 0, colIndex);
    editor.chain().focus().toggleHeaderColumn().run();
    onClose();
  }, [editor, tablePos, colIndex, onClose]);

  const handleDuplicate = useCallback(() => {
    duplicateColumn(editor, tablePos, colIndex);
    onClose();
  }, [editor, tablePos, colIndex, onClose]);

  const handleClear = useCallback(() => {
    clearColumn(editor, tablePos, colIndex);
    onClose();
  }, [editor, tablePos, colIndex, onClose]);

  const handleDelete = useCallback(() => {
    focusCellAt(editor, tablePos, 0, colIndex);
    editor.chain().focus().deleteColumn().run();
    onClose();
  }, [editor, tablePos, colIndex, onClose]);

  const isHeaderCol = isHeaderColumnActive(editor, tablePos);
  const canDelete = colCount > 1;

  // Position adjustment to stay in viewport
  const adjustedPosition = {
    x: Math.min(position.x, window.innerWidth - 220),
    y: Math.min(position.y, window.innerHeight - 280),
  };

  return createPortal(
    <div
      ref={menuRef}
      className={cn(
        "fixed z-[100] min-w-[180px] rounded-lg border border-border bg-popover py-1.5 shadow-xl",
        "animate-in fade-in-0 zoom-in-95"
      )}
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
      role="menu"
      aria-label="Column actions"
    >
      <MenuItem
        icon={<ArrowLeft className="h-3.5 w-3.5" />}
        label="Insert Left"
        onClick={handleInsertLeft}
      />
      <MenuItem
        icon={<ArrowRight className="h-3.5 w-3.5" />}
        label="Insert Right"
        onClick={handleInsertRight}
      />

      <div className="my-1.5 h-px bg-border" />

      <MenuItem
        icon={<TableProperties className="h-3.5 w-3.5" />}
        label="Header Column"
        onClick={handleToggleHeader}
        active={isHeaderCol}
      />

      <div className="my-1.5 h-px bg-border" />

      <MenuItem
        icon={<Copy className="h-3.5 w-3.5" />}
        label="Duplicate"
        onClick={handleDuplicate}
      />
      <MenuItem
        icon={<Eraser className="h-3.5 w-3.5" />}
        label="Clear Contents"
        onClick={handleClear}
      />

      <div className="my-1.5 h-px bg-border" />

      <MenuItem
        icon={<Trash2 className="h-3.5 w-3.5" />}
        label="Delete Column"
        onClick={handleDelete}
        disabled={!canDelete}
        destructive
      />
    </div>,
    document.body
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  destructive,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors duration-75",
        disabled && "pointer-events-none opacity-40",
        destructive
          ? "text-destructive hover:bg-destructive/10"
          : "text-foreground hover:bg-accent/50"
      )}
      onClick={onClick}
      disabled={disabled}
      role="menuitem"
    >
      <span className={cn("text-muted-foreground", destructive && "text-destructive/70")}>
        {icon}
      </span>
      <span className="flex-1 text-left">{label}</span>
      {active && <span className="text-xs text-primary">●</span>}
    </button>
  );
}
