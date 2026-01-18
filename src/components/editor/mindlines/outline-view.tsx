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

  // Scroll selected item into view
  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isSelected]);

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      toggleCollapse(documentId, node.id);
    },
    [documentId, node.id, toggleCollapse]
  );

  const handleClick = useCallback(() => {
    onSelect(node.id);
  }, [node.id, onSelect]);

  const handleDoubleClick = useCallback(() => {
    onNavigate(node);
  }, [node, onNavigate]);

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
          "group flex items-start gap-1 py-1.5 px-2 rounded-md cursor-pointer transition-colors",
          "hover:bg-accent/50",
          isActive && "bg-accent/30 border-l-2 border-primary",
          isSelected && "ring-2 ring-primary/50 ring-inset"
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
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
              "flex-shrink-0 p-0.5 rounded transition-colors mt-0.5",
              "hover:bg-accent focus:outline-none focus:ring-1 focus:ring-primary"
            )}
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            <motion.div
              animate={{ rotate: collapsed ? 0 : 90 }}
              transition={{ duration: 0.15 }}
            >
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            </motion.div>
          </button>
        ) : (
          <div className="w-4 flex-shrink-0" />
        )}

        {/* Heading text - allow 2 lines before truncating */}
        <span
          className={cn(
            "flex-1 min-w-0 line-clamp-2 break-words text-sm leading-snug",
            node.level === 1 && "font-semibold",
            node.level === 2 && "font-medium",
            node.level === 3 && "text-muted-foreground"
          )}
        >
          {node.text || "Untitled"}
        </span>

        {/* Child count badge when collapsed */}
        {hasChildren && collapsed && (
          <span className="flex-shrink-0 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full mt-0.5">
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
export function OutlineView({
  headings,
  activeId,
  onNavigate,
}: OutlineViewProps) {
  const { currentFileId } = useFileStore();
  const { selectedNodeId, setSelectedNode } = useOutlineStore();
  const documentId = currentFileId || "default";

  // Build tree structure from flat headings
  const tree = useMemo(() => buildTree(headings), [headings]);

  // Handle selection
  const handleSelect = useCallback(
    (id: string) => {
      setSelectedNode(id);
    },
    [setSelectedNode]
  );

  if (headings.length === 0) {
    return (
      <div className="py-4 px-3 text-sm text-muted-foreground">
        Add headings to see outline
      </div>
    );
  }

  return (
    <div className="py-2 px-1 flex flex-col min-w-0">
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
