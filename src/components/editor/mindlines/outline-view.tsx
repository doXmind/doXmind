"use client";

import { useCallback, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOutlineStore } from "@/stores/outline-store";
import { useFileStore } from "@/stores/file-store";
import { buildTree } from "./use-tree";
import type { Heading, HeadingNode } from "./types";

interface OutlineViewProps {
  headings: Heading[];
  activeId: string | null;
  onNavigate: (heading: Heading) => void;
}

interface OutlineItemProps {
  node: HeadingNode;
  depth: number;
  activeId: string | null;
  selectedId: string | null;
  documentId: string;
  onNavigate: (heading: Heading) => void;
  onSelect: (id: string) => void;
}

/**
 * Single outline item with collapse/expand support
 */
function OutlineItem({
  node,
  depth,
  activeId,
  selectedId,
  documentId,
  onNavigate,
  onSelect,
}: OutlineItemProps) {
  const { toggleCollapse, isCollapsed } = useOutlineStore();
  const hasChildren = node.children.length > 0;
  const collapsed = isCollapsed(documentId, node.id);
  const isActive = node.id === activeId;
  const isSelected = node.id === selectedId;
  const itemRef = useRef<HTMLDivElement>(null);

  // Scroll active or selected item into view within the outline panel.
  // Uses manual scroll on the nearest scroll container only, avoiding
  // scrollIntoView which cascades to all ancestors and can interfere
  // with page scroll in sticky outline layouts.
  useEffect(() => {
    if (!(isActive || isSelected) || !itemRef.current) return;

    const el = itemRef.current;
    let scrollParent: HTMLElement | null = el.parentElement;
    while (scrollParent) {
      const { overflowY } = getComputedStyle(scrollParent);
      if (overflowY === "auto" || overflowY === "scroll") break;
      scrollParent = scrollParent.parentElement;
    }
    if (!scrollParent) return;

    const elRect = el.getBoundingClientRect();
    const parentRect = scrollParent.getBoundingClientRect();
    if (elRect.top < parentRect.top) {
      scrollParent.scrollTop += elRect.top - parentRect.top - 8;
    } else if (elRect.bottom > parentRect.bottom) {
      scrollParent.scrollTop += elRect.bottom - parentRect.bottom + 8;
    }
  }, [isActive, isSelected]);

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      toggleCollapse(documentId, node.id);
    },
    [documentId, node.id, toggleCollapse]
  );

  const handleClick = useCallback(() => {
    onSelect(node.id);
    onNavigate(node);
  }, [node, onSelect, onNavigate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onNavigate(node);
      }
    },
    [node, onNavigate]
  );

  return (
    <>
      <div
        ref={itemRef}
        className={cn(
          "group flex cursor-pointer items-start gap-1 rounded-md px-2 py-1.5 transition-colors",
          "hover:bg-accent/50",
          isActive && "bg-accent text-accent-foreground",
          isSelected && "ring-2 ring-inset ring-primary/50"
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="treeitem"
        aria-expanded={hasChildren ? !collapsed : undefined}
        aria-selected={isSelected}
      >
        {/* Chevron toggle - only show for nodes with children */}
        {hasChildren ? (
          <button
            onClick={handleToggle}
            className={cn(
              "mt-0.5 flex-shrink-0 rounded p-0.5 transition-colors",
              "hover:bg-accent focus:outline-none focus:ring-1 focus:ring-primary"
            )}
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            <motion.div animate={{ rotate: collapsed ? 0 : 90 }} transition={{ duration: 0.15 }}>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            </motion.div>
          </button>
        ) : (
          <div className="w-4 flex-shrink-0" />
        )}

        {/* Heading text - allow 2 lines before truncating */}
        <span
          className={cn(
            "line-clamp-2 min-w-0 flex-1 break-words text-sm leading-snug",
            node.level === 1 && "font-semibold",
            node.level === 2 && "font-medium",
            node.level === 3 && "text-muted-foreground",
            node.level >= 4 && "text-xs text-muted-foreground"
          )}
        >
          {node.text || "Untitled"}
        </span>

        {/* Child count badge when collapsed */}
        {hasChildren && collapsed && (
          <span className="mt-0.5 flex-shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {node.children.length}
          </span>
        )}
      </div>

      {/* Children - animated collapse */}
      <AnimatePresence initial={false}>
        {hasChildren && !collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {node.children.map((child) => (
              <OutlineItem
                key={child.id}
                node={child}
                depth={depth + 1}
                activeId={activeId}
                selectedId={selectedId}
                documentId={documentId}
                onNavigate={onNavigate}
                onSelect={onSelect}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * Outline view - hierarchical collapsible tree of headings
 * Features:
 * - Multi-line text display (line-clamp-2)
 * - Collapsible sections with animation
 * - Keyboard navigation support
 * - Shared collapse state with Mindmap
 */
export function OutlineView({ headings, activeId, onNavigate }: OutlineViewProps) {
  const { currentFileId } = useFileStore();
  const { selectedNodeId, setSelectedNode } = useOutlineStore();
  const documentId = currentFileId || "default";

  // Build tree structure from flat headings
  const tree = useMemo(() => buildTree(headings), [headings]);

  // Clear selected state when activeId changes (user scrolled away)
  useEffect(() => {
    if (activeId && selectedNodeId && activeId !== selectedNodeId) {
      setSelectedNode(null);
    }
  }, [activeId, selectedNodeId, setSelectedNode]);

  // Handle selection
  const handleSelect = useCallback(
    (id: string) => {
      setSelectedNode(id);
    },
    [setSelectedNode]
  );

  if (headings.length === 0) {
    return (
      <div className="px-3 py-4 text-sm text-muted-foreground">Add headings to see outline</div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col px-1 py-2">
      <nav className="flex flex-col" role="tree" aria-label="Document outline">
        {tree.map((node) => (
          <OutlineItem
            key={node.id}
            node={node}
            depth={0}
            activeId={activeId}
            selectedId={selectedNodeId}
            documentId={documentId}
            onNavigate={onNavigate}
            onSelect={handleSelect}
          />
        ))}
      </nav>
    </div>
  );
}
