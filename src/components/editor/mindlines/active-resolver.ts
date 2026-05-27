/**
 * Resolve the active heading id from a single viewport-probe ProseMirror
 * position. Uses binary search against the canonical heading list to find
 * the nearest heading whose `.pos` is ≤ `probePos`.
 *
 * Why: the prior scroll-spy did `editor.view.nodeDOM(...).getBoundingClientRect()`
 * per heading on every RAF tick — O(N) per scroll. Headings are already sorted
 * by `.pos`, so a single `posAtCoords` + binary search gives O(log N).
 *
 * Fallback semantics: when `probePos` is `null` (e.g. `posAtCoords` returned
 * null on a stale layout), keep the previous active heading rather than
 * snapping the indicator to the first heading. The first-heading fallback
 * applies only when there is no previous active to keep.
 */
interface PositionedHeading {
  id: string;
  pos: number;
}

export function findActiveByPosition(
  headings: PositionedHeading[],
  probePos: number | null,
  previousActiveId: string | null
): string | null {
  if (headings.length === 0) return null;

  if (probePos === null || !Number.isFinite(probePos)) {
    return previousActiveId;
  }

  const firstPos = headings[0].pos;
  if (probePos < firstPos) {
    return previousActiveId;
  }

  // Binary search for the rightmost heading with pos ≤ probePos.
  let low = 0;
  let high = headings.length - 1;
  let bestIndex = 0;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (headings[mid].pos <= probePos) {
      bestIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return headings[bestIndex].id;
}
