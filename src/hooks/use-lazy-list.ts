import { useState, useRef, useEffect, useCallback } from "react";

const DEFAULT_BATCH = 20;

/**
 * Incremental rendering hook for long lists on mobile.
 * Shows `batchSize` items initially, then loads more batches
 * as the user scrolls a sentinel element into view.
 *
 * @returns visibleItems — the slice to render
 * @returns sentinelRef — attach to a sentinel element below the list
 * @returns hasMore — whether more items remain
 */
export function useLazyList<T>(items: T[], batchSize = DEFAULT_BATCH) {
  const [visibleCount, setVisibleCount] = useState(batchSize);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset when the source list changes (search, sort, filter)
  useEffect(() => {
    setVisibleCount(batchSize);
  }, [items.length, batchSize]);

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + batchSize, items.length));
  }, [items.length, batchSize]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "200px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const visibleItems = items.slice(0, visibleCount);
  const hasMore = visibleCount < items.length;

  return { visibleItems, sentinelRef, hasMore } as const;
}
