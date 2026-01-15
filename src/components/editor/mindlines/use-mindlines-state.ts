"use client";

import { useState, useCallback, useEffect } from "react";

export type MindlinesMode = "collapsed" | "expanded";

interface UseMindlinesStateOptions {
  defaultMode?: MindlinesMode;
  onModeChange?: (mode: MindlinesMode) => void;
}

interface UseMindlinesStateReturn {
  mode: MindlinesMode;
  handleToggleExpand: () => void;
  handleClose: () => void;
  setMode: (mode: MindlinesMode) => void;
}

/**
 * State machine hook for Mindlines component
 * Manages transitions between collapsed and expanded states
 */
export function useMindlinesState(
  options: UseMindlinesStateOptions = {}
): UseMindlinesStateReturn {
  const { defaultMode = "collapsed", onModeChange } = options;

  const [mode, setModeInternal] = useState<MindlinesMode>(defaultMode);

  const setMode = useCallback(
    (newMode: MindlinesMode) => {
      setModeInternal(newMode);
      onModeChange?.(newMode);
    },
    [onModeChange]
  );

  // Toggle between collapsed and expanded
  const handleToggleExpand = useCallback(() => {
    setMode(mode === "expanded" ? "collapsed" : "expanded");
  }, [mode, setMode]);

  // Close expanded view
  const handleClose = useCallback(() => {
    setMode("collapsed");
  }, [setMode]);

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

  return {
    mode,
    handleToggleExpand,
    handleClose,
    setMode,
  };
}
