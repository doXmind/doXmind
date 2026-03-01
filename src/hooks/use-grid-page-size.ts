import { useState, useEffect, useCallback } from "react";

// Overhead: header(48) + hero(~220) + tabs(48) + section-padding(48) + pagination(60) + bottom(48)
const LAYOUT_OVERHEAD = 472;
const DEFAULT_ROW_HEIGHT = 80; // card ~68px + gap-4(16px)
const DEFAULT_COLS = 2;

/**
 * Calculate how many items fit in a 2-col grid on desktop.
 * Returns Infinity on mobile (< 640px) so useLazyList handles it instead.
 */
export function useGridPageSize(rowHeight = DEFAULT_ROW_HEIGHT, cols = DEFAULT_COLS) {
  const calc = useCallback(() => {
    if (typeof window === "undefined") return 6;
    const vw = window.innerWidth;

    // Mobile: delegate to useLazyList (infinite scroll)
    if (vw < 640) return Infinity;

    const available = Math.max(window.innerHeight - LAYOUT_OVERHEAD, rowHeight);
    const rows = Math.max(2, Math.floor(available / rowHeight));
    return rows * cols;
  }, [rowHeight, cols]);

  const [pageSize, setPageSize] = useState(calc);

  useEffect(() => {
    const onResize = () => setPageSize(calc());
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [calc]);

  return pageSize;
}
