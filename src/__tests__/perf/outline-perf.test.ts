/**
 * Wave F2 — Outline perf acceptance harness for PRD #108.
 *
 * Locks the quantitative Definition of Done by exercising the real outline
 * stack (`useHeadings`, `subscribeOutline`, `aggregateMarkers`,
 * `findActiveByPosition`) against the 900-heading stress fixture and
 * asserting six measurable invariants.
 *
 * Mocking is intentionally narrow:
 *  - `@tanstack/react-virtual` is replaced with the WINDOWED shim copied from
 *    Wave C's `outline-collapsed-virtual.test.tsx`. jsdom reports zero
 *    element sizes so the live virtualizer would render no rows; the
 *    windowed shim approximates a real viewport (`visible + overscan`).
 *  - `framer-motion` is replaced with a passthrough so the popover mounts
 *    synchronously without animation timers.
 *  - TipTap editor construction is replaced with a minimal fake (same
 *    pattern as Wave A and Wave B tests) — happy-path TipTap mounting in
 *    jsdom is heavyweight and unnecessary for measuring the outline stack.
 *
 * happy-dom and jsdom do not expose the Long Task API. Invariant 2 measures
 * synchronous render work via `performance.now()` deltas as a proxy.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { type HTMLAttributes, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";

const VISIBLE_ROW_BUDGET = 22; // ~640px / 28px row estimate, mirrors Wave C
const scrollToIndexSpy = vi.fn();

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({
    count,
    estimateSize,
    overscan = 0,
  }: {
    count: number;
    estimateSize: (index: number) => number;
    overscan?: number;
  }) => {
    const size = estimateSize(0);
    const windowSize = Math.min(count, VISIBLE_ROW_BUDGET + overscan);
    return {
      getTotalSize: () => count * size,
      getVirtualItems: () =>
        Array.from({ length: windowSize }, (_, index) => ({
          index,
          key: index,
          size,
          start: index * size,
          end: (index + 1) * size,
          lane: 0,
        })),
      scrollToIndex: scrollToIndexSpy,
      measure: vi.fn(),
    };
  },
}));

vi.mock("framer-motion", () => {
  const motion = new Proxy(
    {},
    {
      get:
        () =>
        ({
          children,
          ...props
        }: HTMLAttributes<HTMLElement> & {
          animate?: unknown;
          children?: ReactNode;
          exit?: unknown;
          initial?: unknown;
        }) => {
          const passthrough = { ...props };
          delete passthrough.animate;
          delete passthrough.exit;
          delete passthrough.initial;
          return React.createElement("div", passthrough, children);
        },
    }
  );
  return {
    motion,
    AnimatePresence: ({ children }: { children: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({ children, className }: { children: ReactNode; className?: string }) =>
    React.createElement("div", { className }, children),
}));

import { OutlineCollapsed } from "@/components/editor/mindlines/outline-collapsed";
import { useHeadings } from "@/components/editor/mindlines/use-headings";
import { TocNodeView } from "@/components/editor/toc-node-view";
import type { Heading } from "@/components/editor/mindlines/canonical-outline";

// -- Fixture loading ---------------------------------------------------------

const FIXTURE_PATH = path.resolve(process.cwd(), "src/__tests__/fixtures/outline-stress.md");

function loadStressFixture(): string {
  return readFileSync(FIXTURE_PATH, "utf-8");
}

interface ParsedHeading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

function parseFixtureHeadings(markdown: string): ParsedHeading[] {
  const lines = markdown.split("\n");
  const out: ParsedHeading[] = [];
  for (const line of lines) {
    const match = /^(#{1,6}) +(.*)$/.exec(line);
    if (!match) continue;
    out.push({
      level: match[1].length as ParsedHeading["level"],
      text: match[2].trim(),
    });
  }
  return out;
}

// -- Fake-editor helpers (Wave A / Wave B pattern) ---------------------------

interface FakeHeadingNode {
  type: "heading";
  level: number;
  text: string;
}

interface FakeOtherNode {
  type: string;
  text?: string;
}

type FakeNode = FakeHeadingNode | FakeOtherNode;

function makeFakeEditor(nodes: FakeNode[]) {
  type UpdateListener = () => void;
  const listeners = new Set<UpdateListener>();

  const buildState = () => ({
    doc: {
      forEach(
        callback: (
          node: {
            type: { name: string };
            attrs: { level?: number };
            textContent: string;
          },
          offset: number
        ) => void
      ) {
        let offset = 0;
        for (const node of nodes) {
          callback(
            {
              type: { name: node.type },
              attrs: node.type === "heading" ? { level: (node as FakeHeadingNode).level } : {},
              textContent:
                node.type === "heading" ? (node as FakeHeadingNode).text : (node.text ?? ""),
            },
            offset
          );
          offset += 10;
        }
      },
    },
  });

  const viewDom = document.createElement("div");
  // Scroll-parent ancestor (`useHeadings` walks up looking for
  // `data-editor-scroll`). Give it a known rect so the scroll-spy probe
  // is deterministic.
  const scrollParent = document.createElement("div");
  scrollParent.setAttribute("data-editor-scroll", "");
  scrollParent.getBoundingClientRect = () =>
    ({
      top: 0,
      left: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  scrollParent.appendChild(viewDom);
  document.body.appendChild(scrollParent);

  const posAtCoords = vi.fn<
    (coords: { left: number; top: number }) => { pos: number; inside: number } | null
  >(() => ({ pos: 0, inside: 0 }));
  const nodeDOM = vi.fn<(pos: number) => Node | null>(() => null);
  const coordsAtPos = vi.fn<
    (pos: number) => { top: number; bottom: number; left: number; right: number }
  >(() => ({ top: 0, bottom: 0, left: 0, right: 0 }));

  const editor = {
    state: buildState(),
    isEditable: false,
    view: {
      dom: viewDom,
      posAtCoords,
      nodeDOM,
      coordsAtPos,
    },
    commands: {
      setTextSelection: vi.fn(),
      focus: vi.fn(),
    },
    on(event: string, listener: UpdateListener) {
      if (event === "update") listeners.add(listener);
    },
    off(event: string, listener: UpdateListener) {
      if (event === "update") listeners.delete(listener);
    },
    cleanup() {
      scrollParent.remove();
    },
    _scrollParent: scrollParent,
  };

  return editor as unknown as Editor & {
    view: Editor["view"] & {
      posAtCoords: typeof posAtCoords;
      nodeDOM: typeof nodeDOM;
      coordsAtPos: typeof coordsAtPos;
    };
    cleanup: () => void;
    _scrollParent: HTMLElement;
  };
}

function fakeNodesFromFixture(): FakeNode[] {
  const parsed = parseFixtureHeadings(loadStressFixture());
  return parsed.map<FakeNode>((heading) => ({
    type: "heading",
    level: heading.level,
    text: heading.text,
  }));
}

// Build the same headings array `useHeadings` would produce for the fixture,
// without paying the renderHook cost. Mirrors `normalizeFromEditor` + the
// `useHeadings` level-≤3 filter. Used by invariants 2-4 which test the
// `OutlineCollapsed` component directly with a heading list prop.
function fixtureHeadingsForRail(): Heading[] {
  const parsed = parseFixtureHeadings(loadStressFixture());
  const out: Heading[] = [];
  let offset = 0;
  for (const heading of parsed) {
    if (heading.level <= 3) {
      out.push({
        id: `h-${offset}`,
        level: heading.level,
        text: heading.text,
        pos: offset,
      });
    }
    offset += 10;
  }
  // Current fixture is 300×H1 + 300×H2 + 300×H3, so the level≤3 filter is a no-op.
  // A future fixture regen that adds H4-H6 would silently drop headings here while
  // the real useHeadings pipeline (consumer-side filter at ≤3) sees them all — so
  // Invariants 2-4 would no longer mirror reality. Fail loud instead of drifting.
  if (out.length !== parsed.length) {
    throw new Error(
      `fixtureHeadingsForRail divergence: produced ${out.length} of ${parsed.length} ` +
        `parsed headings. The level≤3 filter dropped headings — invariants 2-4 would ` +
        `no longer mirror the real useHeadings pipeline. Either widen the filter to ` +
        `match the consumer-side cutoff, or regenerate the fixture without H4-H6 headings.`
    );
  }
  return out;
}

// ---------------------------------------------------------------------------

describe("Outline perf acceptance — PRD #108 cumulative DoD", () => {
  beforeEach(() => {
    scrollToIndexSpy.mockClear();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  // --- Invariant 1 --------------------------------------------------------
  // Scroll path issues ≤ 200 getBoundingClientRect calls on heading nodes.
  // Wave B reshaped scroll-spy from per-heading layout reads to a single
  // posAtCoords probe per RAF tick; this test asserts that shape survives
  // the full 900-heading composition.
  it("Invariant 1: scroll path issues ≤ 200 getBoundingClientRect calls on heading nodes during a 180-frame scroll", () => {
    const nodes = fakeNodesFromFixture();
    const editor = makeFakeEditor(nodes);

    // Tag heading DOM nodes the same way ProseMirror would so we can filter
    // spy calls. We attach 900 marker elements inside the editor's view dom,
    // each with a heading marker attribute. The spy filters calls where
    // `this` is one of these elements.
    const headingDomNodes = new Set<Element>();
    for (let i = 0; i < nodes.length; i++) {
      const headingEl = document.createElement(
        "h" + Math.min(6, Math.max(1, (nodes[i] as FakeHeadingNode).level))
      );
      headingEl.setAttribute("data-perf-heading", "true");
      headingEl.textContent = (nodes[i] as FakeHeadingNode).text;
      editor.view.dom.appendChild(headingEl);
      headingDomNodes.add(headingEl);
    }

    // Drive scroll-spy through the standard RAF cycle. We use a manual RAF
    // queue so we can flush deterministically and so the test does not
    // depend on real timer flushing.
    const rafQueue: Array<FrameRequestCallback> = [];
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    }) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame;

    const flushRaf = () => {
      const batch = rafQueue.splice(0, rafQueue.length);
      for (const cb of batch) cb(0);
    };

    let headingRectCalls = 0;
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    const rectSpy = vi.fn(function (this: Element) {
      if (headingDomNodes.has(this)) headingRectCalls++;
      return {
        top: 0,
        left: 0,
        right: 100,
        bottom: 20,
        width: 100,
        height: 20,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });
    Element.prototype.getBoundingClientRect = rectSpy as typeof originalGetBoundingClientRect;

    try {
      const { unmount } = renderHook(() => useHeadings(editor));

      // Vary the probe position across the document so findActiveByPosition
      // sees realistic motion. The exact mapping does not matter for
      // measuring layout-read cost.
      const docLen = nodes.length * 10;
      const FRAMES = 180;
      for (let frame = 0; frame < FRAMES; frame++) {
        const probePos = Math.floor((frame * 37) % docLen);
        editor.view.posAtCoords.mockReturnValue({ pos: probePos, inside: 0 });
        act(() => {
          editor._scrollParent.dispatchEvent(new Event("scroll"));
        });
        // Flush coalesced RAF every 30 events so the resolver runs as it
        // would on a real scroll, not all at once.
        if (frame % 30 === 29) {
          act(() => {
            flushRaf();
          });
        }
      }
      // Final flush in case a frame is still queued.
      act(() => {
        flushRaf();
      });

      // Contract bound: ≤ 200 over 180 frames. PRD's "two orders of
      // magnitude below 81,000" target is ≤ 810; this assertion is tighter
      // to catch any regression to per-heading layout reads.
      console.log(`[perf] Invariant 1 — heading getBoundingClientRect calls: ${headingRectCalls}`);
      expect(headingRectCalls).toBeLessThanOrEqual(200);

      unmount();
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCaf;
      editor.cleanup();
    }
  });

  // --- Invariant 2 --------------------------------------------------------
  // Synchronous popover-open work block is < 50 ms.
  // happy-dom and jsdom don't expose the Long Task API; we measure
  // synchronous render work via performance.now() deltas as a proxy.
  it("Invariant 2: synchronous popover-open work block is < 50 ms with a 900-heading outline", () => {
    const headings = fixtureHeadingsForRail();
    const { container } = render(
      React.createElement(OutlineCollapsed, {
        headings,
        activeId: headings[Math.floor(headings.length / 2)]?.id ?? null,
        onNavigate: vi.fn(),
      })
    );

    const railSensor = container.querySelector('[data-testid="outline-rail-hover-sensor"]');
    expect(railSensor).toBeTruthy();

    const start = performance.now();
    act(() => {
      fireEvent.mouseEnter(railSensor as Element);
    });
    const elapsed = performance.now() - start;

    console.log(`[perf] Invariant 2 — popover-open synchronous work: ${elapsed.toFixed(2)} ms`);
    expect(elapsed).toBeLessThan(50);
  });

  // --- Invariant 3 --------------------------------------------------------
  // Mounted popover row DOM count is ≤ 80.
  // Uses the windowed `useVirtualizer` shim above (NOT the all-rows shim)
  // so the cap reflects the production virtualizer's behavior at runtime.
  it("Invariant 3: mounted popover row DOM count is ≤ 80 with a 900-heading outline", () => {
    const headings = fixtureHeadingsForRail();
    const { container } = render(
      React.createElement(OutlineCollapsed, {
        headings,
        activeId: headings[0]?.id ?? null,
        onNavigate: vi.fn(),
      })
    );

    const railSensor = container.querySelector('[data-testid="outline-rail-hover-sensor"]');
    expect(railSensor).toBeTruthy();
    fireEvent.mouseEnter(railSensor as Element);

    // `framer-motion` is mocked to a passthrough `<div>` so the popover's
    // `motion.nav` flattens to a div with `aria-label="Document outline"` —
    // select by aria-label rather than the `nav` tag.
    const popover = container.querySelector('[aria-label="Document outline"]');
    expect(popover).toBeTruthy();
    const mountedRows = popover!.querySelectorAll('[data-outline-virtual-row="true"]');

    console.log(`[perf] Invariant 3 — mounted popover rows: ${mountedRows.length}`);
    expect(mountedRows.length).toBeGreaterThan(0);
    expect(mountedRows.length).toBeLessThanOrEqual(80);
  });

  // --- Invariant 4 --------------------------------------------------------
  // Rail marker DOM count is ≤ 120.
  // Wave D's `MAX_RAIL_MARKERS = 120` is the bound; this test verifies it
  // holds end-to-end with the real `aggregateMarkers` consuming a real
  // 900-heading list.
  it("Invariant 4: rail marker DOM count is ≤ 120 with a 900-heading outline", () => {
    const headings = fixtureHeadingsForRail();
    const { container } = render(
      React.createElement(OutlineCollapsed, {
        headings,
        activeId: headings[0]?.id ?? null,
        onNavigate: vi.fn(),
      })
    );

    const railTrigger = container.querySelector('[data-testid="outline-rail-trigger"]');
    expect(railTrigger).toBeTruthy();
    // Rail markers are the buttons inside the rail trigger; each has an
    // `aria-label` of the form `Navigate to: ...`.
    const railMarkers = railTrigger!.querySelectorAll("button");

    console.log(`[perf] Invariant 4 — rail markers: ${railMarkers.length}`);
    expect(railMarkers.length).toBeGreaterThan(0);
    expect(railMarkers.length).toBeLessThanOrEqual(120);
  });

  // --- Invariant 5 --------------------------------------------------------
  // Inline TOC renders ≤ maxShowCount = 50 rows.
  // Mounts the real TocNodeView with the real `subscribeOutline` consuming
  // a fake editor loaded with the 900-heading fixture. The bridge emits an
  // initial snapshot synchronously on attach, so no timer flushing is
  // required.
  it("Invariant 5: inline TOC renders ≤ maxShowCount (50) rows with a 900-heading outline", () => {
    const nodes = fakeNodesFromFixture();
    const editor = makeFakeEditor(nodes);

    const nodeViewProps = {
      editor,
      node: { attrs: {} },
      updateAttributes: vi.fn(),
      deleteNode: vi.fn(),
      getPos: () => 0,
      decorations: [],
      selected: false,
      extension: {} as never,
      innerDecorations: [] as never,
      HTMLAttributes: {},
    } as unknown as Parameters<typeof TocNodeView>[0];

    const view = render(React.createElement(TocNodeView, nodeViewProps));
    const buttons = view.container.querySelectorAll("nav button");

    console.log(`[perf] Invariant 5 — TOC rows: ${buttons.length}`);
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.length).toBeLessThanOrEqual(50);

    view.unmount();
    editor.cleanup();
  });
});
