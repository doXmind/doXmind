"use client";

import { useState, useEffect, useCallback, RefObject } from "react";

interface Position {
  x: number;
  y: number;
}

interface UseMenuPositionOptions {
  /** Whether the menu is currently open */
  isOpen: boolean;
  /** Initial position from selection or trigger */
  initialPosition: Position | null;
  /** Ref to the menu element for measuring */
  menuRef: RefObject<HTMLDivElement>;
  /** Padding from viewport edges (default: 20) */
  viewportPadding?: number;
}

interface UseMenuPositionReturn {
  /** Adjusted position that keeps menu in viewport */
  adjustedPosition: Position | null;
  /** Position to use for display (falls back to initial) */
  displayPosition: Position | null;
}

/**
 * Hook for calculating menu position that keeps it within viewport bounds.
 * Adjusts position to prevent overflow on all sides.
 */
export function useMenuPosition({
  isOpen,
  initialPosition,
  menuRef,
  viewportPadding = 20,
}: UseMenuPositionOptions): UseMenuPositionReturn {
  const [adjustedPosition, setAdjustedPosition] = useState<Position | null>(null);

  const calculatePosition = useCallback(() => {
    if (!menuRef.current || !initialPosition) return;

    const menu = menuRef.current;
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = initialPosition.x;
    let y = initialPosition.y;

    // Adjust horizontal position if menu goes off right edge
    if (x + menuRect.width > viewportWidth - viewportPadding) {
      x = viewportWidth - menuRect.width - viewportPadding;
    }

    // Adjust horizontal position if menu goes off left edge
    if (x < viewportPadding) {
      x = viewportPadding;
    }

    // Adjust vertical position if menu goes off bottom edge
    if (y + menuRect.height > viewportHeight - viewportPadding) {
      y = initialPosition.y - menuRect.height - viewportPadding; // Show above selection
    }

    // Adjust vertical position if menu goes off top edge
    if (y < viewportPadding) {
      y = viewportPadding;
    }

    setAdjustedPosition({ x, y });
  }, [initialPosition, menuRef, viewportPadding]);

  useEffect(() => {
    if (!isOpen || !initialPosition) {
      setAdjustedPosition(null);
      return;
    }

    // Use requestAnimationFrame to ensure DOM is rendered before measuring
    requestAnimationFrame(calculatePosition);
  }, [isOpen, initialPosition, calculatePosition]);

  return {
    adjustedPosition,
    displayPosition: adjustedPosition || initialPosition,
  };
}

interface SubmenuPosition {
  top: number;
  left: number;
}

interface UseSubmenuPositionOptions {
  /** ID of the active submenu item */
  activeSubmenu: string | null;
  /** Ref to the parent menu */
  menuRef: RefObject<HTMLDivElement>;
  /** Ref to the submenu element */
  submenuRef: RefObject<HTMLDivElement>;
  /** Estimated item count for height calculation (fallback) */
  estimatedItemCount?: number;
}

/**
 * Calculate submenu position based on trigger element.
 */
export function getSubmenuPosition(
  optionId: string,
  menuRef: RefObject<HTMLDivElement>,
  submenuRef: RefObject<HTMLDivElement>,
  submenuItemCount: number
): SubmenuPosition {
  const itemElement = document.querySelector(`[data-submenu-trigger="${optionId}"]`);
  if (!itemElement || !menuRef.current) return { top: 0, left: 0 };

  const itemRect = itemElement.getBoundingClientRect();
  const menuRect = menuRef.current.getBoundingClientRect();
  const viewportHeight = window.innerHeight;

  // Default: align submenu top with trigger item top
  let top = itemRect.top;

  // Get actual submenu element if it exists, otherwise estimate
  let submenuHeight: number;

  if (submenuRef.current) {
    submenuHeight = submenuRef.current.getBoundingClientRect().height;
  } else {
    // Estimate: each item ~32px + padding 8px
    submenuHeight = submenuItemCount * 32 + 8;
  }

  // Check if submenu would go below viewport
  if (top + submenuHeight > viewportHeight - 10) {
    // Align submenu bottom with viewport bottom (with padding)
    top = viewportHeight - submenuHeight - 10;
  }

  // Ensure submenu doesn't go above viewport
  if (top < 10) {
    top = 10;
  }

  return {
    top,
    left: menuRect.right + 4,
  };
}
