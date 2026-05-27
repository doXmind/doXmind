import { describe, expect, it } from "vitest";
import { aggregateMarkers } from "@/components/editor/mindlines/aggregate-markers";
import type { Heading } from "@/components/editor/mindlines/types";

function makeHeadings(
  count: number,
  posStride = 10,
  levelPattern: number[] = [1, 2, 3]
): Heading[] {
  const out: Heading[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: `h-${i}`,
      level: levelPattern[i % levelPattern.length],
      text: `Heading ${i}`,
      pos: i * posStride,
    });
  }
  return out;
}

describe("aggregateMarkers", () => {
  it("returns an empty array for empty input", () => {
    expect(aggregateMarkers([], null, 120)).toEqual([]);
  });

  it("returns one marker per heading when input fits under the cap", () => {
    const headings = makeHeadings(5);
    const markers = aggregateMarkers(headings, "h-2", 10);

    expect(markers).toHaveLength(5);
    expect(markers.map((m) => m.id)).toEqual(["h-0", "h-1", "h-2", "h-3", "h-4"]);
    expect(markers[0].positionFraction).toBe(0);
    expect(markers[markers.length - 1].positionFraction).toBe(1);

    const activeMarkers = markers.filter((m) => m.isActive);
    expect(activeMarkers).toHaveLength(1);
    expect(activeMarkers[0].id).toBe("h-2");
  });

  it("never exceeds maxMarkers when input is over the cap", () => {
    const headings = makeHeadings(200);
    const markers = aggregateMarkers(headings, null, 120);

    expect(markers.length).toBeGreaterThan(0);
    expect(markers.length).toBeLessThanOrEqual(120);
  });

  it("always represents the active heading exactly, never aggregated into a bucket marker", () => {
    const headings = makeHeadings(200);
    const active = headings[87];

    const markers = aggregateMarkers(headings, active.id, 120);
    const activeMarker = markers.find((m) => m.id === active.id);

    expect(activeMarker).toBeDefined();
    expect(activeMarker?.isActive).toBe(true);
    expect(activeMarker?.level).toBe(active.level);

    const firstPos = headings[0].pos;
    const lastPos = headings[headings.length - 1].pos;
    const expectedFraction = (active.pos - firstPos) / (lastPos - firstPos);
    expect(activeMarker?.positionFraction).toBeCloseTo(expectedFraction, 10);
  });

  it("marks exactly one marker as active and leaves the rest inactive", () => {
    const headings = makeHeadings(200);
    const markers = aggregateMarkers(headings, headings[87].id, 120);

    const activeCount = markers.filter((m) => m.isActive).length;
    expect(activeCount).toBe(1);
    expect(markers.filter((m) => !m.isActive).every((m) => m.isActive === false)).toBe(true);
  });

  it("handles the degenerate case where every heading shares the same position", () => {
    const headings: Heading[] = Array.from({ length: 200 }, (_, i) => ({
      id: `h-${i}`,
      level: ((i % 3) + 1) as 1 | 2 | 3,
      text: `Heading ${i}`,
      pos: 42,
    }));

    const markers = aggregateMarkers(headings, null, 120);

    expect(markers.length).toBeGreaterThan(0);
    expect(markers.length).toBeLessThanOrEqual(120);
    for (const m of markers) {
      expect(Number.isFinite(m.positionFraction)).toBe(true);
      expect(m.positionFraction).toBe(0);
    }
  });

  it("sorts output by positionFraction ascending", () => {
    const headings = makeHeadings(200);
    const markers = aggregateMarkers(headings, headings[50].id, 120);

    for (let i = 1; i < markers.length; i++) {
      expect(markers[i].positionFraction).toBeGreaterThanOrEqual(markers[i - 1].positionFraction);
    }
  });

  it("returns structurally-equal output when called twice with the same input", () => {
    const headings = makeHeadings(200);
    const a = aggregateMarkers(headings, headings[42].id, 120);
    const b = aggregateMarkers(headings, headings[42].id, 120);
    expect(a).toEqual(b);
  });
});
