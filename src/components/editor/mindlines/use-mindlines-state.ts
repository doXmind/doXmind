"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { MINDLINES_HOVER_TIMING } from "@/lib/constants";

export type MindlinesMode = "collapsed" | "preview" | "expanded";

interface UseMindlinesStateOptions {
  defaultMode?: MindlinesMode;
  hoverEnterDelay?: number; // Default: 150ms
  hoverLeaveDelay?: number; // Default: 300ms
  onModeChange?: (mode: MindlinesMode) => void;
}

interface UseMindlinesStateReturn {
  mode: MindlinesMode;
  isHovering: boolean;

  // Event handlers
  handleMouseEnter: () => void;
  handleMouseLeave: () => void;
  handleToggleExpand: () => void;
  handleClose: () => void;

  // Direct setters
  setMode: (mode: MindlinesMode) => void;
}

/**
 * State machine hook for Mindlines component
 * Manages transitions between collapsed, preview, and expanded states
 */
export function useMindlinesState(
  options: UseMindlinesStateOptions = {}
): UseMindlinesStateReturn {
  const {
    defaultMode = "collapsed",
    hoverEnterDelay = MINDLINES_HOVER_TIMING.ENTER_DELAY,
    hoverLeaveDelay = MINDLINES_HOVER_TIMING.LEAVE_DELAY,
    onModeChange,
  } = options;

  const [mode, setModeInternal] = useState<MindlinesMode>(defaultMode);
  const [isHovering, setIsHovering] = useState(false);
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const setMode = useCallback(
    (newMode: MindlinesMode) => {
      setModeInternal(newMode);
      onModeChange?.(newMode);
    },
    [onModeChange]
  );

  // Mouse enter: transition to preview after delay (only if collapsed)
  const handleMouseEnter = useCallback(() => {
    setIsHovering(true);
    clearHoverTimer();

    // Only transition to preview if currently collapsed
    if (mode === "collapsed") {
      hoverTimerRef.current = setTimeout(() => {
        setMode("preview");
      }, hoverEnterDelay);
    }
  }, [mode, hoverEnterDelay, clearHoverTimer, setMode]);

  // Mouse leave: transition back to collapsed after delay (only if in preview)
  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    clearHoverTimer();

    // Only transition back if in preview mode (not expanded)
    if (mode === "preview") {
      hoverTimerRef.current = setTimeout(() => {
        setMode("collapsed");
      }, hoverLeaveDelay);
    }
  }, [mode, hoverLeaveDelay, clearHoverTimer, setMode]);

  // Toggle between collapsed and expanded
  const handleToggleExpand = useCallback(() => {
    clearHoverTimer();
    setMode(mode === "expanded" ? "collapsed" : "expanded");
  }, [mode, clearHoverTimer, setMode]);

  // Close expanded view
  const handleClose = useCallback(() => {
    clearHoverTimer();
    setMode("collapsed");
  }, [clearHoverTimer, setMode]);

  // Keyboard handler for Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mode === "expanded") {
        e.preventDefault();
        handleClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mode, handleClose]);

  // Cleanup timers on unmount
  useEffect(() => clearHoverTimer, [clearHoverTimer]);

  return {
    mode,
    isHovering,
    handleMouseEnter,
    handleMouseLeave,
    handleToggleExpand,
    handleClose,
    setMode,
  };
}
