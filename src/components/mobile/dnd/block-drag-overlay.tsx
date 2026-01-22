"use client";

/**
 * Block Drag Overlay
 *
 * Renders a ghost preview of the block being dragged.
 * Uses @dnd-kit's DragOverlay for portal rendering.
 */

import { DragOverlay, defaultDropAnimationSideEffects } from "@dnd-kit/core";
import type { DropAnimation } from "@dnd-kit/core";
import { motion } from "framer-motion";
import type { SelectableBlock } from "@/types/block-selection";

interface BlockDragOverlayProps {
  activeBlock: SelectableBlock | null;
}

const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: "0.5",
      },
    },
  }),
};

export function BlockDragOverlay({ activeBlock }: BlockDragOverlayProps) {
  return (
    <DragOverlay dropAnimation={dropAnimation}>
      {activeBlock ? (
        <motion.div
          initial={{ scale: 1, opacity: 0.8 }}
          animate={{ scale: 1.02, opacity: 0.9 }}
          className="rounded-lg border-2 border-primary bg-background/95 px-4 py-3 shadow-2xl backdrop-blur-sm"
        >
          <div className="line-clamp-3 text-sm text-foreground">
            {activeBlock.text || <em className="text-muted-foreground">Empty block</em>}
          </div>
        </motion.div>
      ) : null}
    </DragOverlay>
  );
}
