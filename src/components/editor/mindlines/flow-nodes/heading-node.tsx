"use client";

import { memo, useCallback, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FlowNodeData } from "../types";

/**
 * Custom React Flow node for displaying heading elements
 * Styled based on heading level (H1, H2, H3)
 * Supports expand/collapse for nodes with children
 */
export const HeadingNode = memo(function HeadingNode({ id, data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData;
  const [hasAnimated, setHasAnimated] = useState(false);

  // Track if this node has already animated (to prevent re-animation on re-renders)
  useEffect(() => {
    const timer = setTimeout(() => setHasAnimated(true), 500);
    return () => clearTimeout(timer);
  }, []);

  // Handle collapse toggle
  const handleCollapseClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      // Dispatch custom event to parent
      window.dispatchEvent(new CustomEvent("mindmap-toggle-collapse", { detail: { nodeId: id } }));
    },
    [id]
  );

  const levelStyles: Record<number, string> = {
    1: "bg-primary text-primary-foreground font-semibold text-base min-w-[180px] border-primary/20",
    2: "bg-accent text-accent-foreground font-medium text-sm min-w-[150px] border-accent/30",
    3: "bg-muted text-muted-foreground text-sm min-w-[130px] border-muted-foreground/20",
  };

  // Calculate stagger delay based on node index (extracted from id)
  const nodeIndex = parseInt(id.replace(/\D/g, "")) || 0;
  const staggerDelay = Math.min(nodeIndex * 0.05, 0.5); // Cap at 0.5s

  return (
    <motion.div
      initial={hasAnimated ? false : { scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 20,
        delay: hasAnimated ? 0 : staggerDelay,
      }}
      whileHover={{ scale: 1.03, y: -2 }}
      className={cn(
        "group relative rounded-lg border px-4 py-2.5 shadow-sm",
        "cursor-pointer select-none",
        // Level-based styling
        levelStyles[nodeData.level] || levelStyles[3],
        // Active state
        nodeData.isActive && "shadow-lg ring-2 ring-primary ring-offset-2 ring-offset-background",
        // Selected state (keyboard navigation)
        selected && "ring-2 ring-blue-500 ring-offset-2"
      )}
    >
      {/* Target handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !border-0 !bg-border opacity-0"
      />

      {/* Content */}
      <div className="flex items-center gap-2">
        {/* Collapse/Expand button */}
        {nodeData.hasChildren && (
          <motion.button
            onClick={handleCollapseClick}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className={cn(
              "flex-shrink-0 rounded p-0.5 transition-colors",
              "hover:bg-black/10 dark:hover:bg-white/10",
              "focus:outline-none focus:ring-1 focus:ring-primary"
            )}
            aria-label={nodeData.isCollapsed ? "Expand children" : "Collapse children"}
          >
            <motion.span
              animate={{ rotate: nodeData.isCollapsed ? 0 : 90 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronRight className="h-4 w-4" />
            </motion.span>
          </motion.button>
        )}

        {/* Label */}
        <span className="block max-w-[180px] truncate">{nodeData.label}</span>

        {/* Child count badge when collapsed */}
        <AnimatePresence>
          {nodeData.isCollapsed && nodeData.childCount && nodeData.childCount > 0 && (
            <motion.span
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
              className={cn(
                "flex-shrink-0 rounded-full px-1.5 py-0.5 text-xs",
                "bg-black/10 dark:bg-white/10"
              )}
            >
              +{nodeData.childCount}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Source handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !border-0 !bg-border opacity-0"
      />

      {/* Hover tooltip with full text */}
      {nodeData.label && nodeData.label.length > 25 && (
        <div
          className={cn(
            "absolute -bottom-10 left-1/2 z-50 -translate-x-1/2",
            "rounded bg-popover px-2 py-1 text-xs text-popover-foreground shadow-lg",
            "pointer-events-none opacity-0 transition-opacity group-hover:opacity-100",
            "max-w-[300px] truncate whitespace-nowrap"
          )}
        >
          {nodeData.label}
        </div>
      )}
    </motion.div>
  );
});
