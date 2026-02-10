"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// --- Constants ---
const EDGE_ZONE_WIDTH = 60; // px from grid edge to trigger zone
const INITIAL_DWELL_MS = 400; // first page change delay
const REPEAT_DWELL_MS = 600; // subsequent page changes
const PAGE_BUTTON_DWELL_MS = 300; // hover over page number button

interface UseDragPageTransitionOptions {
  page: number;
  totalPages: number;
  setPage: (page: number | ((prev: number) => number)) => void;
  enabled: boolean;
}

interface UseDragPageTransitionResult {
  /** Whether a drag is currently active over the grid */
  isDragActive: boolean;
  /** Which edge the cursor is near during drag */
  activeEdge: "left" | "right" | null;
  /** Dwell timer progress 0→1 for visual feedback */
  dwellProgress: number;
  /** Which pagination button is being drag-hovered */
  dragHoveredPage: number | null;
  /** Ref to attach to the grid wrapper container */
  gridRef: React.RefObject<HTMLDivElement | null>;
  /** Handlers for the grid wrapper */
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  /** Returns drag handlers for a pagination button */
  getPageButtonDragProps: (pageIndex: number) => {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
}

export function useDragPageTransition({
  page,
  totalPages,
  setPage,
  enabled,
}: UseDragPageTransitionOptions): UseDragPageTransitionResult {
  const gridRef = useRef<HTMLDivElement | null>(null);

  const [isDragActive, setIsDragActive] = useState(false);
  const [activeEdge, setActiveEdge] = useState<"left" | "right" | null>(null);
  const [dwellProgress, setDwellProgress] = useState(0);
  const [dragHoveredPage, setDragHoveredPage] = useState<number | null>(null);

  // Refs for timer management
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  const dwellStartRef = useRef<number>(0);
  const dwellDurationRef = useRef<number>(INITIAL_DWELL_MS);
  const isFirstTransitionRef = useRef(true);
  const pageButtonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep page/totalPages in refs so callbacks don't go stale
  const pageRef = useRef(page);
  const totalPagesRef = useRef(totalPages);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);
  useEffect(() => {
    totalPagesRef.current = totalPages;
  }, [totalPages]);

  // --- Cleanup helpers ---
  const clearDwellTimer = useCallback(() => {
    if (dwellTimerRef.current) {
      clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setDwellProgress(0);
  }, []);

  const clearPageButtonTimer = useCallback(() => {
    if (pageButtonTimerRef.current) {
      clearTimeout(pageButtonTimerRef.current);
      pageButtonTimerRef.current = null;
    }
  }, []);

  const resetAll = useCallback(() => {
    clearDwellTimer();
    clearPageButtonTimer();
    setIsDragActive(false);
    setActiveEdge(null);
    setDwellProgress(0);
    setDragHoveredPage(null);
    isFirstTransitionRef.current = true;
  }, [clearDwellTimer, clearPageButtonTimer]);

  // --- RAF progress animation ---
  const animateProgress = useCallback((duration: number) => {
    dwellStartRef.current = performance.now();
    dwellDurationRef.current = duration;

    const tick = (now: number) => {
      const elapsed = now - dwellStartRef.current;
      const progress = Math.min(elapsed / duration, 1);
      setDwellProgress(progress);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // --- Start dwell timer for an edge ---
  const startEdgeDwell = useCallback(
    (edge: "left" | "right") => {
      clearDwellTimer();

      const duration = isFirstTransitionRef.current ? INITIAL_DWELL_MS : REPEAT_DWELL_MS;

      animateProgress(duration);

      dwellTimerRef.current = setTimeout(() => {
        const currentPage = pageRef.current;
        const total = totalPagesRef.current;

        if (edge === "left" && currentPage > 0) {
          setPage((p: number) => Math.max(0, p - 1));
          isFirstTransitionRef.current = false;
          // Start repeat timer if still at edge
          startEdgeDwell(edge);
        } else if (edge === "right" && currentPage < total - 1) {
          setPage((p: number) => Math.min(total - 1, p + 1));
          isFirstTransitionRef.current = false;
          startEdgeDwell(edge);
        } else {
          clearDwellTimer();
        }
      }, duration);
    },
    [clearDwellTimer, animateProgress, setPage]
  );

  // --- Grid container handlers ---
  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!enabled) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      setIsDragActive(true);

      const grid = gridRef.current;
      if (!grid) return;

      const rect = grid.getBoundingClientRect();
      const x = e.clientX;

      const inLeftZone = x < rect.left + EDGE_ZONE_WIDTH && pageRef.current > 0;
      const inRightZone =
        x > rect.right - EDGE_ZONE_WIDTH && pageRef.current < totalPagesRef.current - 1;

      let newEdge: "left" | "right" | null = null;
      if (inLeftZone) newEdge = "left";
      else if (inRightZone) newEdge = "right";

      setActiveEdge((prev) => {
        if (prev !== newEdge) {
          // Edge changed — restart or clear dwell
          if (newEdge) {
            startEdgeDwell(newEdge);
          } else {
            clearDwellTimer();
            isFirstTransitionRef.current = true;
          }
        }
        return newEdge;
      });
    },
    [enabled, startEdgeDwell, clearDwellTimer]
  );

  const onDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!enabled) return;
      const grid = gridRef.current;
      if (!grid) return;

      // Only reset if truly leaving the container (not entering a child)
      const relatedTarget = e.relatedTarget as Node | null;
      if (relatedTarget && grid.contains(relatedTarget)) return;

      clearDwellTimer();
      setActiveEdge(null);
      isFirstTransitionRef.current = true;
      // Don't reset isDragActive here — the drag is still active, just outside our container
    },
    [enabled, clearDwellTimer]
  );

  const onDrop = useCallback(
    (_e: React.DragEvent) => {
      // Let child drop handlers handle the actual drop
      // We just clean up our state
      resetAll();
    },
    [resetAll]
  );

  // --- Page button handlers ---
  const getPageButtonDragProps = useCallback(
    (pageIndex: number) => ({
      onDragOver: (e: React.DragEvent) => {
        if (!enabled) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";

        setDragHoveredPage((prev) => {
          if (prev !== pageIndex) {
            clearPageButtonTimer();
            pageButtonTimerRef.current = setTimeout(() => {
              setPage(pageIndex);
              setDragHoveredPage(null);
            }, PAGE_BUTTON_DWELL_MS);
          }
          return pageIndex;
        });
      },
      onDragLeave: () => {
        clearPageButtonTimer();
        setDragHoveredPage(null);
      },
      onDrop: (_e: React.DragEvent) => {
        clearPageButtonTimer();
        setDragHoveredPage(null);
        // Don't prevent default — let the drop fall through or be ignored
      },
    }),
    [enabled, setPage, clearPageButtonTimer]
  );

  // --- Global dragend listener to clean up ---
  useEffect(() => {
    const handleDragEnd = () => resetAll();
    window.addEventListener("dragend", handleDragEnd);
    return () => {
      window.removeEventListener("dragend", handleDragEnd);
      resetAll();
    };
  }, [resetAll]);

  // Disabled — return inert values
  if (!enabled) {
    return {
      isDragActive: false,
      activeEdge: null,
      dwellProgress: 0,
      dragHoveredPage: null,
      gridRef,
      onDragOver: () => {},
      onDragLeave: () => {},
      onDrop: () => {},
      getPageButtonDragProps: () => ({
        onDragOver: () => {},
        onDragLeave: () => {},
        onDrop: () => {},
      }),
    };
  }

  return {
    isDragActive,
    activeEdge,
    dwellProgress,
    dragHoveredPage,
    gridRef,
    onDragOver,
    onDragLeave,
    onDrop,
    getPageButtonDragProps,
  };
}
