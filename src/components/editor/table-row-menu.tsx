"use client";

import { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { ArrowUp, ArrowDown, Copy, Trash2, Eraser, TableProperties } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { focusCellAt, duplicateRow, clearRow, isHeaderRowActive } from "@/lib/table-operations";

interface TableRowMenuProps {
  editor: Editor;
  tablePos: number;
  rowIndex: number;
  position: { x: number; y: number };
  rowCount: number;
  onClose: () => void;
}

export function TableRowMenu({
  editor,
  tablePos,
  rowIndex,
  position,
  rowCount,
  onClose,
}: TableRowMenuProps) {
  const t = useTranslations("editor");
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

  const handleInsertAbove = useCallback(() => {
    focusCellAt(editor, tablePos, rowIndex, 0);
    editor.chain().focus().addRowBefore().run();
    onClose();
  }, [editor, tablePos, rowIndex, onClose]);

  const handleInsertBelow = useCallback(() => {
    focusCellAt(editor, tablePos, rowIndex, 0);
    editor.chain().focus().addRowAfter().run();
    onClose();
  }, [editor, tablePos, rowIndex, onClose]);

  const handleToggleHeader = useCallback(() => {
    focusCellAt(editor, tablePos, rowIndex, 0);
    editor.chain().focus().toggleHeaderRow().run();
    onClose();
  }, [editor, tablePos, rowIndex, onClose]);

  const handleDuplicate = useCallback(() => {
    duplicateRow(editor, tablePos, rowIndex);
    onClose();
  }, [editor, tablePos, rowIndex, onClose]);

  const handleClear = useCallback(() => {
    clearRow(editor, tablePos, rowIndex);
    onClose();
  }, [editor, tablePos, rowIndex, onClose]);

  const handleDelete = useCallback(() => {
    focusCellAt(editor, tablePos, rowIndex, 0);
    editor.chain().focus().deleteRow().run();
    onClose();
  }, [editor, tablePos, rowIndex, onClose]);

  const isHeaderRow = isHeaderRowActive(editor, tablePos);
  const canDelete = rowCount > 1;

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
      aria-label={t("tableMenu.rowActions")}
    >
      <MenuItem
        icon={<ArrowUp className="h-3.5 w-3.5" />}
        label={t("tableMenu.insertAbove")}
        onClick={handleInsertAbove}
      />
      <MenuItem
        icon={<ArrowDown className="h-3.5 w-3.5" />}
        label={t("tableMenu.insertBelow")}
        onClick={handleInsertBelow}
      />

      <div className="my-1.5 h-px bg-border" />

      <MenuItem
        icon={<TableProperties className="h-3.5 w-3.5" />}
        label={t("tableMenu.headerRow")}
        onClick={handleToggleHeader}
        active={isHeaderRow}
      />

      <div className="my-1.5 h-px bg-border" />

      <MenuItem
        icon={<Copy className="h-3.5 w-3.5" />}
        label={t("tableMenu.duplicate")}
        onClick={handleDuplicate}
      />
      <MenuItem
        icon={<Eraser className="h-3.5 w-3.5" />}
        label={t("tableMenu.clearContents")}
        onClick={handleClear}
      />

      <div className="my-1.5 h-px bg-border" />

      <MenuItem
        icon={<Trash2 className="h-3.5 w-3.5" />}
        label={t("tableMenu.deleteRow")}
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
