"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

interface HeadingNodeData {
  label: string;
  level: number;
  pos: number;
  isActive?: boolean;
}

/**
 * Custom React Flow node for displaying heading elements
 * Styled based on heading level (H1, H2, H3)
 */
export const HeadingNode = memo(function HeadingNode({
  data,
}: NodeProps<HeadingNodeData>) {
  return (
    <div
      className={cn(
        "px-4 py-2.5 rounded-lg border shadow-sm transition-all",
        "hover:shadow-md cursor-pointer select-none",
        // Level-based styling
        data.level === 1 &&
          "bg-primary text-primary-foreground font-semibold text-base min-w-[180px]",
        data.level === 2 &&
          "bg-accent font-medium text-sm min-w-[140px]",
        data.level === 3 &&
          "bg-muted text-muted-foreground text-sm min-w-[120px]",
        // Active state
        data.isActive && "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-lg"
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-2 !h-2 !bg-border !border-0 opacity-0"
      />
      <span className="block max-w-[200px] truncate text-center">{data.label}</span>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-2 !h-2 !bg-border !border-0 opacity-0"
      />
    </div>
  );
});
