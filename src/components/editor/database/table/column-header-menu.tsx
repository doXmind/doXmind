"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import {
  Pencil,
  ArrowUpAZ,
  ArrowDownZA,
  Filter,
  PanelLeftOpen,
  PanelRightOpen,
  EyeOff,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PropertyDef } from "@/extensions/database/database-types";
import { READONLY_PROPERTY_TYPES } from "@/extensions/database/database-types";

interface ColumnHeaderMenuProps {
  property: PropertyDef;
  position: { top: number; left: number };
  currentSort: "asc" | "desc" | null;
  onEditProperty: () => void;
  onSortAsc: () => void;
  onSortDesc: () => void;
  onAddFilter: () => void;
  onInsertLeft: () => void;
  onInsertRight: () => void;
  onHide: () => void;
  onDelete: () => void;
  onClose: () => void;
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}

function MenuItem({ icon, label, onClick, active, danger }: MenuItemProps) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
        danger
          ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
          : "hover:bg-accent",
        active && "text-primary"
      )}
      onClick={onClick}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {active && <span className="ml-auto text-xs font-medium text-primary">On</span>}
    </button>
  );
}

export function ColumnHeaderMenu({
  property,
  position,
  currentSort,
  onEditProperty,
  onSortAsc,
  onSortDesc,
  onAddFilter,
  onInsertLeft,
  onInsertRight,
  onHide,
  onDelete,
  onClose,
}: ColumnHeaderMenuProps) {
  const t = useTranslations("database.columnMenu");
  const menuRef = useRef<HTMLDivElement>(null);
  const isReadonly = READONLY_PROPERTY_TYPES.includes(property.type);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Adjust position to stay within viewport
  const adjustedPos = { ...position };
  const menuWidth = 220;
  const menuHeight = 340;
  if (adjustedPos.left + menuWidth > window.innerWidth) {
    adjustedPos.left = window.innerWidth - menuWidth - 8;
  }
  if (adjustedPos.top + menuHeight > window.innerHeight) {
    adjustedPos.top = window.innerHeight - menuHeight - 8;
  }

  return createPortal(
    <div
      ref={menuRef}
      className="animate-in fade-in-0 zoom-in-95 fixed z-[100] w-52 rounded-lg border border-border bg-popover p-1 shadow-lg duration-100"
      style={{ top: adjustedPos.top, left: adjustedPos.left }}
    >
      {/* Edit property */}
      {!isReadonly && (
        <MenuItem
          icon={<Pencil className="h-4 w-4" />}
          label={t("editProperty")}
          onClick={() => {
            onEditProperty();
            onClose();
          }}
        />
      )}

      <div className="my-1 border-b border-border" />

      {/* Sort */}
      <MenuItem
        icon={<ArrowUpAZ className="h-4 w-4" />}
        label={t("sortAsc")}
        active={currentSort === "asc"}
        onClick={() => {
          onSortAsc();
          onClose();
        }}
      />
      <MenuItem
        icon={<ArrowDownZA className="h-4 w-4" />}
        label={t("sortDesc")}
        active={currentSort === "desc"}
        onClick={() => {
          onSortDesc();
          onClose();
        }}
      />

      {/* Filter */}
      <MenuItem
        icon={<Filter className="h-4 w-4" />}
        label={t("filter")}
        onClick={() => {
          onAddFilter();
          onClose();
        }}
      />

      <div className="my-1 border-b border-border" />

      {/* Insert left / right */}
      <MenuItem
        icon={<PanelLeftOpen className="h-4 w-4" />}
        label={t("insertLeft")}
        onClick={() => {
          onInsertLeft();
          onClose();
        }}
      />
      <MenuItem
        icon={<PanelRightOpen className="h-4 w-4" />}
        label={t("insertRight")}
        onClick={() => {
          onInsertRight();
          onClose();
        }}
      />

      {/* Hide */}
      <MenuItem
        icon={<EyeOff className="h-4 w-4" />}
        label={t("hide")}
        onClick={() => {
          onHide();
          onClose();
        }}
      />

      {!isReadonly && (
        <>
          <div className="my-1 border-b border-border" />
          <MenuItem
            icon={<Trash2 className="h-4 w-4" />}
            label={t("delete")}
            danger
            onClick={() => {
              onDelete();
              onClose();
            }}
          />
        </>
      )}
    </div>,
    document.body
  );
}
