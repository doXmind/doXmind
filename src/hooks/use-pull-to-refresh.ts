"use client";

import { useCallback, useRef, useState } from "react";
import { haptics } from "@/lib/haptics";

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  resistance?: number;
}

interface PullToRefreshState {
  isPulling: boolean;
  isRefreshing: boolean;
  pullDistance: number;
}

export function usePullToRefresh({
  onRefresh,
  threshold = 60,
  resistance = 0.5,
}: UsePullToRefreshOptions) {
  const [state, setState] = useState<PullToRefreshState>({
    isPulling: false,
    isRefreshing: false,
    pullDistance: 0,
  });

  const startY = useRef(0);
  const isTracking = useRef(false);
  const hasTriggered = useRef(false);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (state.isRefreshing) return;
      // Only activate when scroll is at top
      const scrollEl = e.currentTarget;
      if (scrollEl.scrollTop > 0) return;

      startY.current = e.touches[0].clientY;
      isTracking.current = true;
      hasTriggered.current = false;
    },
    [state.isRefreshing]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isTracking.current || state.isRefreshing) return;

      const scrollEl = e.currentTarget;
      if (scrollEl.scrollTop > 0) {
        isTracking.current = false;
        setState((s) => ({ ...s, isPulling: false, pullDistance: 0 }));
        return;
      }

      const currentY = e.touches[0].clientY;
      const diff = (currentY - startY.current) * resistance;

      if (diff <= 0) {
        setState((s) => ({ ...s, isPulling: false, pullDistance: 0 }));
        return;
      }

      setState((s) => ({ ...s, isPulling: true, pullDistance: diff }));

      if (diff >= threshold && !hasTriggered.current) {
        hasTriggered.current = true;
        haptics.light();
      }
    },
    [state.isRefreshing, threshold, resistance]
  );

  const onTouchEnd = useCallback(async () => {
    if (!isTracking.current) return;
    isTracking.current = false;

    if (hasTriggered.current && state.pullDistance >= threshold) {
      setState({ isPulling: false, isRefreshing: true, pullDistance: 0 });
      try {
        await onRefresh();
      } finally {
        setState({ isPulling: false, isRefreshing: false, pullDistance: 0 });
      }
    } else {
      setState({ isPulling: false, isRefreshing: false, pullDistance: 0 });
    }
  }, [state.pullDistance, threshold, onRefresh]);

  return {
    ...state,
    touchHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
  };
}
