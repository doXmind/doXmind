"use client";

/**
 * Block Drag Handle Component
 *
 * Shows a floating indicator above the selected block on mobile.
 * The actual drag functionality is handled by @dnd-kit in BlockDndContext.
 * This component only provides visual feedback for the selection.
 */

import { useEffect, useState, useCallback } from "react";
import { Move } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useBlockSelectionStore } from "@/stores/block-selection-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { cn } from "@/lib/utils";

interface BlockDragHandleProps {
  containerRef: React.RefObject<HTMLElement | null>;
}

export function BlockDragHandle({ containerRef }: BlockDragHandleProps) {
  const { selectedBlocks, isSelectionActive, drag } = useBlockSelectionStore();
  const { editor } = useEditorRefStore();
  const [handlePosition, setHandlePosition] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  // Calculate handle position based on selected block
  const updateHandlePosition = useCallback(() => {
    if (!editor || selectedBlocks.length === 0 || !containerRef.current) {
      setHandlePosition(null);
      return;
    }

    const firstBlock = selectedBlocks[0];
    try {
      const domNode = editor.view.nodeDOM(firstBlock.from);
      if (domNode && domNode instanceof HTMLElement) {
        const rect = domNode.getBoundingClientRect();
        const containerRect = containerRef.current.getBoundingClientRect();
        setHandlePosition({
          top: rect.top - containerRect.top - 40,
          left: rect.left - containerRect.left,
          width: rect.width,
        });
      }
    } catch {
      setHandlePosition(null);
    }
  }, [editor, selectedBlocks, containerRef]);

  // Update position when selection changes or on scroll
  useEffect(() => {
    updateHandlePosition();

    const container = containerRef.current;
    if (container) {
      container.addEventListener("scroll", updateHandlePosition);
      return () => container.removeEventListener("scroll", updateHandlePosition);
    }
  }, [updateHandlePosition, containerRef]);

  const showHandle = isSelectionActive && selectedBlocks.length > 0 && handlePosition && !drag.isDragging;

  return (
    <AnimatePresence>
      {showHandle && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.9 }}
          transition={{ duration: 0.15 }}
          className={cn(
            "absolute z-50 pointer-events-none",
            "flex items-center justify-center gap-1.5",
            "h-8 px-3 rounded-full",
            "bg-primary/90 text-primary-foreground",
            "shadow-lg backdrop-blur-sm"
          )}
          style={{
            top: Math.max(8, handlePosition.top),
            left: handlePosition.left + handlePosition.width / 2 - 60,
          }}
        >
          <Move className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Hold to drag</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
