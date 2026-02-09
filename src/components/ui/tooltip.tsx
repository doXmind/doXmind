"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface TooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
}

export function Tooltip({ children, content, side = "top", delayDuration = 200 }: TooltipProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const [position, setPosition] = React.useState<{ top: number; left: number } | null>(null);
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const tooltipRef = React.useRef<HTMLDivElement>(null);
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const calculatePosition = React.useCallback(() => {
    if (!triggerRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipHeight = tooltipRef.current?.offsetHeight || 32;
    const tooltipWidth = tooltipRef.current?.offsetWidth || 100;
    const gap = 8;

    let top = 0;
    let left = 0;

    switch (side) {
      case "top":
        top = triggerRect.top - tooltipHeight - gap;
        left = triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2;
        break;
      case "bottom":
        top = triggerRect.bottom + gap;
        left = triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2;
        break;
      case "left":
        top = triggerRect.top + triggerRect.height / 2 - tooltipHeight / 2;
        left = triggerRect.left - tooltipWidth - gap;
        break;
      case "right":
        top = triggerRect.top + triggerRect.height / 2 - tooltipHeight / 2;
        left = triggerRect.right + gap;
        break;
    }

    // Viewport boundary checks
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Prevent overflow on left/right
    if (left < 8) left = 8;
    if (left + tooltipWidth > viewportWidth - 8) {
      left = viewportWidth - tooltipWidth - 8;
    }

    // Prevent overflow on top/bottom
    if (top < 8) top = 8;
    if (top + tooltipHeight > viewportHeight - 8) {
      top = viewportHeight - tooltipHeight - 8;
    }

    setPosition({ top, left });
  }, [side]);

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => {
      setIsOpen(true);
      // Calculate position after state update
      requestAnimationFrame(calculatePosition);
    }, delayDuration);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsOpen(false);
    setPosition(null);
  };

  // Hide tooltip on click (prevents annoying tooltip staying after button click)
  const handleClick = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsOpen(false);
    setPosition(null);
  };

  // Recalculate position when tooltip becomes visible
  React.useEffect(() => {
    if (isOpen && tooltipRef.current) {
      calculatePosition();
    }
  }, [isOpen, calculatePosition]);

  return (
    <div
      ref={triggerRef}
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleClick}
    >
      {children}
      {mounted &&
        isOpen &&
        createPortal(
          <div
            ref={tooltipRef}
            style={{
              position: "fixed",
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
              visibility: position ? "visible" : "hidden",
            }}
            className={cn(
              "animate-in fade-in-0 zoom-in-95 pointer-events-none z-[9999] overflow-hidden whitespace-nowrap rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
            )}
          >
            {content}
          </div>,
          document.body
        )}
    </div>
  );
}
