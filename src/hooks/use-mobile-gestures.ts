"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { MOBILE_V2 } from "@/lib/constants";
import { haptics } from "@/lib/haptics";

export interface SwipeDirection {
  direction: "left" | "right" | "up" | "down" | null;
  distance: number;
  velocity: number;
}

export interface EdgeSwipeEvent {
  edge: "left" | "right" | "top" | "bottom";
  progress: number; // 0-1
  velocity: number;
  completed: boolean;
}

export interface GestureState {
  isSwipingFromEdge: boolean;
  edgeSwipeProgress: number;
  activeEdge: "left" | "right" | "top" | "bottom" | null;
  isLongPressing: boolean;
  longPressPosition: { x: number; y: number } | null;
}

interface UseMobileGesturesOptions {
  onEdgeSwipe?: (event: EdgeSwipeEvent) => void;
  onLongPress?: (position: { x: number; y: number }) => void;
  onSwipe?: (direction: SwipeDirection) => void;
  enabled?: boolean;
  edgeSwipeThreshold?: number;
  longPressDuration?: number;
}

export function useMobileGestures(options: UseMobileGesturesOptions = {}) {
  const {
    onEdgeSwipe,
    onLongPress,
    onSwipe,
    enabled = true,
    edgeSwipeThreshold = MOBILE_V2.MIN_SWIPE_DISTANCE,
    longPressDuration = MOBILE_V2.LONG_PRESS_DURATION,
  } = options;

  const [gestureState, setGestureState] = useState<GestureState>({
    isSwipingFromEdge: false,
    edgeSwipeProgress: 0,
    activeEdge: null,
    isLongPressing: false,
    longPressPosition: null,
  });

  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isEdgeSwipeRef = useRef(false);
  const activeEdgeRef = useRef<"left" | "right" | "top" | "bottom" | null>(null);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const detectEdge = useCallback(
    (x: number, y: number): "left" | "right" | "top" | "bottom" | null => {
      const { innerWidth, innerHeight } = window;
      const edgeZone = MOBILE_V2.EDGE_SWIPE_ZONE;

      if (x <= edgeZone) return "left";
      if (x >= innerWidth - edgeZone) return "right";
      if (y <= edgeZone) return "top";
      if (y >= innerHeight - edgeZone) return "bottom";

      return null;
    },
    []
  );

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!enabled) return;

      const touch = e.touches[0];
      const { clientX: x, clientY: y } = touch;

      touchStartRef.current = { x, y, time: Date.now() };

      // Check if starting from edge
      const edge = detectEdge(x, y);
      if (edge) {
        isEdgeSwipeRef.current = true;
        activeEdgeRef.current = edge;
        setGestureState((prev) => ({
          ...prev,
          isSwipingFromEdge: true,
          activeEdge: edge,
          edgeSwipeProgress: 0,
        }));
      }

      // Start long press timer
      clearLongPressTimer();
      longPressTimerRef.current = setTimeout(() => {
        if (touchStartRef.current) {
          haptics.medium();
          setGestureState((prev) => ({
            ...prev,
            isLongPressing: true,
            longPressPosition: { x, y },
          }));
          onLongPress?.({ x, y });
        }
      }, longPressDuration);
    },
    [enabled, detectEdge, clearLongPressTimer, longPressDuration, onLongPress]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!enabled || !touchStartRef.current) return;

      const touch = e.touches[0];
      const { clientX: x, clientY: y } = touch;
      const start = touchStartRef.current;

      const deltaX = x - start.x;
      const deltaY = y - start.y;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      // Cancel long press if moved too much
      if (distance > 10) {
        clearLongPressTimer();
        setGestureState((prev) => ({
          ...prev,
          isLongPressing: false,
          longPressPosition: null,
        }));
      }

      // Handle edge swipe progress
      if (isEdgeSwipeRef.current && activeEdgeRef.current) {
        const edge = activeEdgeRef.current;
        let progress = 0;

        switch (edge) {
          case "left":
            progress = Math.min(1, Math.max(0, deltaX / edgeSwipeThreshold));
            break;
          case "right":
            progress = Math.min(1, Math.max(0, -deltaX / edgeSwipeThreshold));
            break;
          case "top":
            progress = Math.min(1, Math.max(0, deltaY / edgeSwipeThreshold));
            break;
          case "bottom":
            progress = Math.min(1, Math.max(0, -deltaY / edgeSwipeThreshold));
            break;
        }

        setGestureState((prev) => ({
          ...prev,
          edgeSwipeProgress: progress,
        }));

        // Emit progress event
        const elapsed = Date.now() - start.time;
        const velocity = distance / (elapsed / 1000);

        onEdgeSwipe?.({
          edge,
          progress,
          velocity,
          completed: false,
        });
      }
    },
    [enabled, clearLongPressTimer, edgeSwipeThreshold, onEdgeSwipe]
  );

  const handleTouchEnd = useCallback(
    (e: TouchEvent) => {
      if (!enabled || !touchStartRef.current) return;

      const touch = e.changedTouches[0];
      const { clientX: x, clientY: y } = touch;
      const start = touchStartRef.current;

      const deltaX = x - start.x;
      const deltaY = y - start.y;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      const elapsed = Date.now() - start.time;
      const velocity = distance / (elapsed / 1000);

      clearLongPressTimer();

      // Handle edge swipe completion
      if (isEdgeSwipeRef.current && activeEdgeRef.current) {
        const edge = activeEdgeRef.current;
        let swipeDistance = 0;

        switch (edge) {
          case "left":
            swipeDistance = deltaX;
            break;
          case "right":
            swipeDistance = -deltaX;
            break;
          case "top":
            swipeDistance = deltaY;
            break;
          case "bottom":
            swipeDistance = -deltaY;
            break;
        }

        const completed =
          swipeDistance >= edgeSwipeThreshold || velocity >= MOBILE_V2.SWIPE_VELOCITY_THRESHOLD;

        if (completed) {
          haptics.tick();
        }

        onEdgeSwipe?.({
          edge,
          progress: completed ? 1 : 0,
          velocity,
          completed,
        });
      } else if (distance >= edgeSwipeThreshold) {
        // Regular swipe detection
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        let direction: "left" | "right" | "up" | "down" | null = null;

        if (absX > absY) {
          direction = deltaX > 0 ? "right" : "left";
        } else {
          direction = deltaY > 0 ? "down" : "up";
        }

        onSwipe?.({
          direction,
          distance,
          velocity,
        });
      }

      // Reset state
      touchStartRef.current = null;
      isEdgeSwipeRef.current = false;
      activeEdgeRef.current = null;
      setGestureState({
        isSwipingFromEdge: false,
        edgeSwipeProgress: 0,
        activeEdge: null,
        isLongPressing: false,
        longPressPosition: null,
      });
    },
    [enabled, clearLongPressTimer, edgeSwipeThreshold, onEdgeSwipe, onSwipe]
  );

  const handleTouchCancel = useCallback(() => {
    clearLongPressTimer();
    touchStartRef.current = null;
    isEdgeSwipeRef.current = false;
    activeEdgeRef.current = null;
    setGestureState({
      isSwipingFromEdge: false,
      edgeSwipeProgress: 0,
      activeEdge: null,
      isLongPressing: false,
      longPressPosition: null,
    });
  }, [clearLongPressTimer]);

  useEffect(() => {
    if (!enabled) return;

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: true });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });
    document.addEventListener("touchcancel", handleTouchCancel, { passive: true });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("touchcancel", handleTouchCancel);
      clearLongPressTimer();
    };
  }, [
    enabled,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
    clearLongPressTimer,
  ]);

  return gestureState;
}

/**
 * Keyboard state with height information for precise toolbar positioning
 */
export interface KeyboardState {
  isVisible: boolean;
  keyboardHeight: number; // pixels, 0 when hidden
}

/**
 * Hook to detect keyboard visibility and height using visualViewport API.
 * Returns both visibility and keyboard height for toolbar positioning.
 */
export function useKeyboardState(): KeyboardState {
  const [state, setState] = useState<KeyboardState>({
    isVisible: false,
    keyboardHeight: 0,
  });

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const handleResize = () => {
      const keyboardVisible = viewport.height < window.innerHeight * 0.75;
      const keyboardHeight = keyboardVisible ? window.innerHeight - viewport.height : 0;

      setState({
        isVisible: keyboardVisible,
        keyboardHeight,
      });
    };

    viewport.addEventListener("resize", handleResize);
    viewport.addEventListener("scroll", handleResize);
    handleResize();

    return () => {
      viewport.removeEventListener("resize", handleResize);
      viewport.removeEventListener("scroll", handleResize);
    };
  }, []);

  return state;
}

/**
 * Hook to detect if user is currently editing (keyboard visible).
 * Simple wrapper around useKeyboardState for backwards compatibility.
 */
export function useKeyboardVisible() {
  const { isVisible } = useKeyboardState();
  return isVisible;
}

/**
 * Hook to detect text selection
 */
export function useTextSelection() {
  const [selection, setSelection] = useState<{
    text: string;
    rect: DOMRect | null;
  }>({
    text: "",
    rect: null,
  });

  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (sel && sel.toString().trim()) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setSelection({
          text: sel.toString(),
          rect,
        });
      } else {
        setSelection({ text: "", rect: null });
      }
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, []);

  return selection;
}
