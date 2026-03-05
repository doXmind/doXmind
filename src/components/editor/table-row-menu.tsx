"use client";

import { useEffect, useRef, useCallback, useState, useMemo, useLayoutEffect } from "react";
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
  const [query, setQuery] = useState("");
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({
    left: position.x,
    top: position.y,
  });

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

  const menuItems = useMemo(
    () => [
      {
        id: "insert-above",
        icon: <ArrowUp className="h-3.5 w-3.5" />,
        label: t("tableMenu.insertAbove"),
        onClick: handleInsertAbove,
        group: "insert",
      },
      {
        id: "insert-below",
        icon: <ArrowDown className="h-3.5 w-3.5" />,
        label: t("tableMenu.insertBelow"),
        onClick: handleInsertBelow,
        group: "insert",
      },
      {
        id: "header-row",
        icon: <TableProperties className="h-3.5 w-3.5" />,
        label: t("tableMenu.headerRow"),
        onClick: handleToggleHeader,
        active: isHeaderRow,
        group: "format",
      },
      {
        id: "duplicate",
        icon: <Copy className="h-3.5 w-3.5" />,
        label: t("tableMenu.duplicate"),
        onClick: handleDuplicate,
        group: "edit",
      },
      {
        id: "clear",
        icon: <Eraser className="h-3.5 w-3.5" />,
        label: t("tableMenu.clearContents"),
        onClick: handleClear,
        group: "edit",
      },
      {
        id: "delete",
        icon: <Trash2 className="h-3.5 w-3.5" />,
        label: t("tableMenu.deleteRow"),
        onClick: handleDelete,
        group: "danger",
        destructive: true,
        disabled: !canDelete,
      },
    ],
    [
      t,
      handleInsertAbove,
      handleInsertBelow,
      handleToggleHeader,
      isHeaderRow,
      handleDuplicate,
      handleClear,
      handleDelete,
      canDelete,
    ]
  );

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return menuItems;
    return menuItems.filter((item) => item.label.toLowerCase().includes(q));
  }, [menuItems, query]);

  useLayoutEffect(() => {
    if (!menuRef.current) return;

    const rect = menuRef.current.getBoundingClientRect();
    const padding = 12;
    const gap = 8;
    let left = position.x + gap;
    let top = position.y + gap;

    const spaceBelow = window.innerHeight - (position.y + gap) - padding;
    const spaceAbove = position.y - gap - padding;

    if (left + rect.width > window.innerWidth - padding) {
      left = position.x - rect.width - gap;
    }

    if (spaceBelow < rect.height && spaceAbove > spaceBelow) {
      top = position.y - rect.height - gap;
    }

    left = Math.max(padding, Math.min(left, window.innerWidth - rect.width - padding));
    top = Math.max(padding, Math.min(top, window.innerHeight - rect.height - padding));

    setMenuStyle({ left, top });
  }, [position, filteredItems.length]);

  return createPortal(
    <div
      ref={menuRef}
      className={cn(
        "fixed z-[100] w-[280px] overflow-hidden rounded-xl border border-border bg-popover shadow-xl",
        "animate-in fade-in-0 zoom-in-95"
      )}
      style={menuStyle}
      role="menu"
      aria-label={t("tableMenu.rowActions")}
    >
      <div className="border-b border-border px-2.5 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search actions..."
          className="h-9 w-full rounded-md border border-border/60 bg-background/50 px-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
          autoFocus
        />
      </div>

      <div className="p-1.5">
        {filteredItems.map((item, idx) => {
          const prev = filteredItems[idx - 1];
          const showDivider = idx > 0 && prev && prev.group !== item.group;

          return (
            <div key={item.id}>
              {showDivider && <div className="mx-1 my-1.5 h-px bg-border" />}
              <MenuItem
                icon={item.icon}
                label={item.label}
                onClick={item.onClick}
                active={item.active}
                destructive={item.destructive}
                disabled={item.disabled}
              />
            </div>
          );
        })}
        {filteredItems.length === 0 && (
          <div className="px-3 py-2 text-sm text-muted-foreground">No actions found</div>
        )}
      </div>
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
