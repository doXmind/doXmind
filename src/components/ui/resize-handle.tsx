"use client";

import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  side: "left" | "right";
  onResize: (delta: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  onDoubleClick?: () => void;
  className?: string;
}

export function ResizeHandle({
  side,
  onResize,
  onResizeStart,
  onResizeEnd,
  onDoubleClick,
  className,
}: ResizeHandleProps) {
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const pendingDeltaRef = useRef(0);

  // Keep refs to latest callbacks to avoid stale closures in document event listeners
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const onResizeStartRef = useRef(onResizeStart);
  onResizeStartRef.current = onResizeStart;
  const onResizeEndRef = useRef(onResizeEnd);
  onResizeEndRef.current = onResizeEnd;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      startXRef.current = e.clientX;
      onResizeStartRef.current?.();

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const delta = moveEvent.clientX - startXRef.current;
        startXRef.current = moveEvent.clientX;
        const adjustedDelta = side === "right" ? -delta : delta;
        pendingDeltaRef.current += adjustedDelta;

        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          const nextDelta = pendingDeltaRef.current;
          pendingDeltaRef.current = 0;
          if (nextDelta !== 0) {
            onResizeRef.current(nextDelta);
          }
        });
      };

      const handleMouseUp = () => {
        isDraggingRef.current = false;
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
        if (pendingDeltaRef.current !== 0) {
          onResizeRef.current(pendingDeltaRef.current);
          pendingDeltaRef.current = 0;
        }
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        onResizeEndRef.current?.();
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [side]
  );

  return (
    <div className={cn("relative z-10 w-0 flex-shrink-0", className)}>
      {/* Invisible wide hit area for easy grabbing */}
      <div
        onMouseDown={handleMouseDown}
        onDoubleClick={onDoubleClick}
        className="absolute inset-y-0 -left-[4px] -right-[4px] cursor-col-resize"
      />
      {/* Visible 1px separator — Notion style */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-border/40" />
    </div>
  );
}
