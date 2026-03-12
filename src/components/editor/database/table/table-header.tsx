"use client";

import { useState, useRef, useCallback } from "react";
import {
  Type,
  Hash,
  List,
  Tags,
  Calendar,
  CheckSquare,
  Link,
  ArrowUp,
  ArrowDown,
  CircleDot,
  Mail,
  Phone,
  Clock,
  Plus,
  GripVertical,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import type {
  PropertyDef,
  PropertyType,
  SortCondition,
} from "@/extensions/database/database-types";
import {
  DEFAULT_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
} from "@/extensions/database/database-types";
import { ColumnHeaderMenu } from "./column-header-menu";

export const PROPERTY_ICONS: Record<PropertyType, React.ReactNode> = {
  text: <Type className="h-3.5 w-3.5" />,
  number: <Hash className="h-3.5 w-3.5" />,
  select: <List className="h-3.5 w-3.5" />,
  multi_select: <Tags className="h-3.5 w-3.5" />,
  status: <CircleDot className="h-3.5 w-3.5" />,
  date: <Calendar className="h-3.5 w-3.5" />,
  checkbox: <CheckSquare className="h-3.5 w-3.5" />,
  url: <Link className="h-3.5 w-3.5" />,
  email: <Mail className="h-3.5 w-3.5" />,
  phone: <Phone className="h-3.5 w-3.5" />,
  created_time: <Clock className="h-3.5 w-3.5" />,
  updated_time: <Clock className="h-3.5 w-3.5" />,
};

interface TableHeaderProps {
  properties: PropertyDef[];
  widths: Record<string, number>;
  sorts: SortCondition[];
  onWidthChange: (propId: string, width: number) => void;
  onSort: (propId: string, direction: "asc" | "desc") => void;
  onEditProperty: (propId: string, position?: { top: number; left: number }) => void;
  onAddFilter: (propId: string) => void;
  onInsertProperty: (position: "left" | "right", refPropId: string) => void;
  onHideProperty: (propId: string) => void;
  onDeleteProperty: (propId: string) => void;
  onAddProperty: (position?: { top: number; left: number }) => void;
  onReorderProperties?: (propertyIds: string[]) => void;
}

interface SortableHeaderCellProps {
  prop: PropertyDef;
  width: number;
  sortDir: "asc" | "desc" | null;
  isMenuOpen: boolean;
  resizing: string | null;
  onHeaderClick: (e: React.MouseEvent, propId: string) => void;
  onResizeStart: (e: React.MouseEvent, propId: string) => void;
}

function SortableHeaderCell({
  prop,
  width,
  sortDir,
  isMenuOpen,
  resizing,
  onHeaderClick,
  onResizeStart,
}: SortableHeaderCellProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: prop.id,
  });

  const style = {
    width,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative flex shrink-0 items-center border-r border-border/50"
    >
      {/* Drag handle */}
      <div
        className="flex h-full shrink-0 cursor-grab items-center px-0.5 opacity-0 transition-opacity hover:!opacity-100 active:cursor-grabbing group-hover:opacity-60"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3 w-3 text-muted-foreground" />
      </div>

      <button
        className={cn(
          "flex flex-1 items-center gap-1.5 truncate py-2 pr-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
          isMenuOpen && "bg-accent/50 text-foreground"
        )}
        onClick={(e) => onHeaderClick(e, prop.id)}
      >
        <span className="shrink-0 text-muted-foreground/60">{PROPERTY_ICONS[prop.type]}</span>
        <span className="truncate">{prop.name}</span>
        {sortDir === "asc" && <ArrowUp className="ml-auto h-3 w-3 shrink-0 text-primary" />}
        {sortDir === "desc" && <ArrowDown className="ml-auto h-3 w-3 shrink-0 text-primary" />}
      </button>

      {/* Resize handle */}
      <div
        className={cn(
          "absolute -right-px top-0 z-10 h-full w-1 cursor-col-resize transition-opacity duration-150",
          "opacity-0 hover:opacity-100 group-hover:opacity-100",
          resizing === prop.id ? "bg-primary opacity-100" : "bg-border hover:bg-primary/50"
        )}
        onMouseDown={(e) => onResizeStart(e, prop.id)}
      />
    </div>
  );
}

export function TableHeader({
  properties,
  widths,
  sorts,
  onWidthChange,
  onSort,
  onEditProperty,
  onAddFilter,
  onInsertProperty,
  onHideProperty,
  onDeleteProperty,
  onAddProperty,
  onReorderProperties,
}: TableHeaderProps) {
  const [resizing, setResizing] = useState<string | null>(null);
  const [menuPropId, setMenuPropId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, propId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setResizing(propId);
      startXRef.current = e.clientX;
      startWidthRef.current = widths[propId] ?? DEFAULT_COLUMN_WIDTH;

      const handleMove = (me: MouseEvent) => {
        const delta = me.clientX - startXRef.current;
        const newWidth = Math.max(
          MIN_COLUMN_WIDTH,
          Math.min(MAX_COLUMN_WIDTH, startWidthRef.current + delta)
        );
        onWidthChange(propId, newWidth);
      };

      const handleUp = () => {
        setResizing(null);
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };

      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [widths, onWidthChange]
  );

  const handleHeaderClick = useCallback((e: React.MouseEvent, propId: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuPosition({ top: rect.bottom + 4, left: rect.left });
    setMenuPropId(propId);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !onReorderProperties) return;

      const oldIndex = properties.findIndex((p) => p.id === active.id);
      const newIndex = properties.findIndex((p) => p.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const newOrder = [...properties.map((p) => p.id)];
      newOrder.splice(oldIndex, 1);
      newOrder.splice(newIndex, 0, active.id as string);
      onReorderProperties(newOrder);
    },
    [properties, onReorderProperties]
  );

  const getSortDir = (propId: string) => {
    const sort = sorts.find((s) => s.propertyId === propId);
    return sort?.direction ?? null;
  };

  const menuProperty = menuPropId ? properties.find((p) => p.id === menuPropId) : null;

  const propertyIds = properties.map((p) => p.id);

  return (
    <div className="flex border-b border-border bg-muted/80">
      {/* Row number column */}
      <div className="flex w-10 shrink-0 items-center justify-center border-r border-border/50 text-xs text-muted-foreground/60">
        #
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={propertyIds} strategy={horizontalListSortingStrategy}>
          {properties.map((prop) => (
            <SortableHeaderCell
              key={prop.id}
              prop={prop}
              width={widths[prop.id] ?? DEFAULT_COLUMN_WIDTH}
              sortDir={getSortDir(prop.id)}
              isMenuOpen={menuPropId === prop.id}
              resizing={resizing}
              onHeaderClick={handleHeaderClick}
              onResizeStart={handleResizeStart}
            />
          ))}
        </SortableContext>
      </DndContext>

      {/* Add property column */}
      <button
        type="button"
        className="flex w-10 shrink-0 cursor-pointer items-center justify-center text-muted-foreground/40 transition-colors hover:bg-accent/50 hover:text-muted-foreground"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onAddProperty({ top: rect.bottom + 4, left: rect.left });
        }}
        aria-label="Add property"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>

      {/* Column header menu */}
      {menuPropId && menuProperty && (
        <ColumnHeaderMenu
          property={menuProperty}
          position={menuPosition}
          currentSort={getSortDir(menuPropId)}
          onEditProperty={() => onEditProperty(menuPropId, menuPosition)}
          onSortAsc={() => onSort(menuPropId, "asc")}
          onSortDesc={() => onSort(menuPropId, "desc")}
          onAddFilter={() => onAddFilter(menuPropId)}
          onInsertLeft={() => onInsertProperty("left", menuPropId)}
          onInsertRight={() => onInsertProperty("right", menuPropId)}
          onHide={() => onHideProperty(menuPropId)}
          onDelete={() => onDeleteProperty(menuPropId)}
          onClose={() => setMenuPropId(null)}
        />
      )}
    </div>
  );
}
