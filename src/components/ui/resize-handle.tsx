"use client";

import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  side: "left" | "right";
  onResize: (delta: number) => void;
  onDoubleClick?: () => void;
  className?: string;
}

export function ResizeHandle({ side, onResize, onDoubleClick, className }: ResizeHandleProps) {
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      startXRef.current = e.clientX;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const delta = moveEvent.clientX - startXRef.current;
        startXRef.current = moveEvent.clientX;
        // For right-side handles (like chat panel left edge), dragging left = wider
        const adjustedDelta = side === "right" ? -delta : delta;
        onResize(adjustedDelta);
      };

      const handleMouseUp = () => {
        isDraggingRef.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [onResize, side]
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      onDoubleClick={onDoubleClick}
      className={cn(
        "group relative z-10 flex w-1 flex-shrink-0 cursor-col-resize items-center justify-center",
        "hover:bg-primary/20 active:bg-primary/30",
        "transition-colors duration-150",
        className
      )}
    >
      <div className="h-8 w-0.5 rounded-full bg-border opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}
