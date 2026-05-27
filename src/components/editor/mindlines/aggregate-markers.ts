import type { Heading } from "./types";

export interface Marker {
  id: string;
  level: 1 | 2 | 3;
  positionFraction: number;
  isActive: boolean;
}

type MarkerLevel = Marker["level"];

function clampLevel(level: number): MarkerLevel {
  if (level <= 1) return 1;
  if (level >= 3) return 3;
  return 2;
}

function makeHeadingMarker(heading: Heading, positionFraction: number, isActive: boolean): Marker {
  return {
    id: heading.id,
    level: clampLevel(heading.level),
    positionFraction,
    isActive,
  };
}

export function aggregateMarkers(
  headings: Heading[],
  activeId: string | null,
  maxMarkers: number
): Marker[] {
  if (headings.length === 0) return [];
  if (maxMarkers <= 0) return [];

  const firstPos = headings[0].pos;
  const lastPos = headings[headings.length - 1].pos;
  const span = lastPos - firstPos;

  if (headings.length <= maxMarkers) {
    return headings.map((heading) => {
      const fraction = span === 0 ? 0 : (heading.pos - firstPos) / span;
      return makeHeadingMarker(heading, fraction, heading.id === activeId);
    });
  }

  if (span === 0) {
    const stride = headings.length / maxMarkers;
    const sampled: Marker[] = [];
    for (let i = 0; i < maxMarkers; i++) {
      const index = Math.min(headings.length - 1, Math.floor(i * stride));
      const heading = headings[index];
      sampled.push(makeHeadingMarker(heading, 0, heading.id === activeId));
    }
    return sampled;
  }

  const bucketSize = span / maxMarkers;
  const bucketShallowestLevel: (MarkerLevel | null)[] = new Array(maxMarkers).fill(null);

  const bucketIndexFor = (pos: number): number => {
    if (pos >= lastPos) return maxMarkers - 1;
    const raw = Math.floor((pos - firstPos) / bucketSize);
    if (raw < 0) return 0;
    if (raw >= maxMarkers) return maxMarkers - 1;
    return raw;
  };

  for (const heading of headings) {
    const idx = bucketIndexFor(heading.pos);
    const current = bucketShallowestLevel[idx];
    const level = clampLevel(heading.level);
    if (current === null || level < current) {
      bucketShallowestLevel[idx] = level;
    }
  }

  const activeHeading =
    activeId === null ? null : (headings.find((heading) => heading.id === activeId) ?? null);
  const activeBucket = activeHeading === null ? -1 : bucketIndexFor(activeHeading.pos);

  const markers: Marker[] = [];
  for (let i = 0; i < maxMarkers; i++) {
    const level = bucketShallowestLevel[i];
    if (level === null) continue;
    if (i === activeBucket && activeHeading !== null) {
      const fraction = (activeHeading.pos - firstPos) / span;
      markers.push(makeHeadingMarker(activeHeading, fraction, true));
      continue;
    }
    const midpoint = (i + 0.5) * bucketSize;
    const fraction = midpoint / span;
    markers.push({
      id: `bucket-${i}`,
      level,
      positionFraction: fraction,
      isActive: false,
    });
  }

  markers.sort((a, b) => a.positionFraction - b.positionFraction);
  return markers;
}
