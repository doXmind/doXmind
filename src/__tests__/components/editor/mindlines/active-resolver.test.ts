import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import { findActiveByPosition } from "@/components/editor/mindlines/active-resolver";
import type { Heading } from "@/components/editor/mindlines/canonical-outline";
import { useHeadings } from "@/components/editor/mindlines/use-headings";

function heading(id: string, pos: number): Heading {
  return { id, level: 1, text: id, pos };
}

describe("findActiveByPosition — pure module", () => {
  it("returns null when the heading list is empty", () => {
    expect(findActiveByPosition([], 42, null)).toBe(null);
    expect(findActiveByPosition([], 42, "h-x")).toBe(null);
    expect(findActiveByPosition([], null, null)).toBe(null);
    expect(findActiveByPosition([], null, "h-x")).toBe(null);
  });

  it("returns null when probe is before the first heading and no previous active", () => {
    const headings = [heading("h-10", 10), heading("h-20", 20)];
    expect(findActiveByPosition(headings, 5, null)).toBe(null);
  });

  it("preserves previousActiveId when probe is before the first heading", () => {
    const headings = [heading("h-10", 10), heading("h-20", 20)];
    expect(findActiveByPosition(headings, 5, "h-x")).toBe("h-x");
  });

  it("returns the heading whose pos exactly matches the probe", () => {
    const headings = [heading("h-0", 0), heading("h-10", 10), heading("h-20", 20)];
    expect(findActiveByPosition(headings, 10, null)).toBe("h-10");
  });

  it("returns the previous (lower-pos) heading when probe lands between two", () => {
    const headings = [heading("h-0", 0), heading("h-10", 10), heading("h-20", 20)];
    expect(findActiveByPosition(headings, 15, null)).toBe("h-10");
  });

  it("returns the last heading when probe is past the last pos", () => {
    const headings = [heading("h-0", 0), heading("h-10", 10), heading("h-20", 20)];
    expect(findActiveByPosition(headings, 9999, null)).toBe("h-20");
  });

  it("returns previousActiveId when probePos is null and a previous active exists", () => {
    const headings = [heading("h-0", 0), heading("h-10", 10)];
    expect(findActiveByPosition(headings, null, "h-10")).toBe("h-10");
  });

  it("returns null when probePos is null and there is no previous active", () => {
    const headings = [heading("h-0", 0), heading("h-10", 10)];
    expect(findActiveByPosition(headings, null, null)).toBe(null);
  });

  it("treats non-finite probePos as null (keep-previous fallback)", () => {
    const headings = [heading("h-0", 0), heading("h-10", 10)];
    expect(findActiveByPosition(headings, Number.NaN, "h-0")).toBe("h-0");
    expect(findActiveByPosition(headings, Number.POSITIVE_INFINITY, "h-0")).toBe("h-0");
  });

  it("locates the correct heading on a 200-heading list with O(log N) probes", () => {
    const headings: Heading[] = Array.from({ length: 200 }, (_, index) =>
      heading(`h-${index}`, index * 10)
    );

    // Wrap the list in a Proxy so we can count comparisons against `.pos`.
    let comparisons = 0;
    const watched = new Proxy(headings, {
      get(target, prop, receiver) {
        if (typeof prop === "string" && /^\d+$/.test(prop)) {
          const node = target[Number(prop)];
          if (!node) return node;
          return new Proxy(node, {
            get(innerTarget, innerProp, innerReceiver) {
              if (innerProp === "pos") comparisons++;
              return Reflect.get(innerTarget, innerProp, innerReceiver);
            },
          });
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as Heading[];

    // Probe lands between h-77 (pos 770) and h-78 (pos 780).
    expect(findActiveByPosition(watched, 775, null)).toBe("h-77");

    // A linear scan would read `pos` at least 78 times (one per heading up to
    // the target). Binary search over 200 elements stays well under ~16
    // (⌈log2(200)⌉ ≈ 8, plus the initial-pos and final-id reads). We allow
    // headroom for the firstPos compare + result read; if the implementation
    // regresses to O(N), this assertion will fail loudly.
    expect(comparisons).toBeLessThan(20);
  });
});

interface FakeHeadingNode {
  type: "heading";
  level: number;
  text: string;
}

function makeEditor(nodes: FakeHeadingNode[]) {
  type UpdateListener = () => void;
  const listeners = new Set<UpdateListener>();

  const buildState = () => ({
    doc: {
      forEach(
        callback: (
          node: { type: { name: string }; attrs: { level?: number }; textContent: string },
          offset: number
        ) => void
      ) {
        let offset = 0;
        for (const node of nodes) {
          callback(
            {
              type: { name: node.type },
              attrs: { level: node.level },
              textContent: node.text,
            },
            offset
          );
          offset += 10;
        }
      },
    },
  });

  const viewDom = document.createElement("div");
  // Give the editor DOM a fake scrollable ancestor with a known rect.
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

  const editor = {
    state: buildState(),
    isEditable: false,
    view: {
      dom: viewDom,
      posAtCoords,
      nodeDOM,
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
    view: Editor["view"] & { posAtCoords: typeof posAtCoords; nodeDOM: typeof nodeDOM };
    cleanup: () => void;
    _scrollParent: HTMLElement;
  };
}

describe("useHeadings scroll-spy — hook-level integration", () => {
  let rafCallbacks: Array<FrameRequestCallback>;
  let rafSpy: ReturnType<typeof vi.fn>;
  let cafSpy: ReturnType<typeof vi.fn>;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCaf = globalThis.cancelAnimationFrame;

  beforeEach(() => {
    vi.useFakeTimers();
    rafCallbacks = [];
    rafSpy = vi.fn((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    cafSpy = vi.fn();
    globalThis.requestAnimationFrame = rafSpy as unknown as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = cafSpy as unknown as typeof globalThis.cancelAnimationFrame;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCaf;
    vi.useRealTimers();
  });

  function flushRaf() {
    const callbacks = rafCallbacks;
    rafCallbacks = [];
    for (const cb of callbacks) cb(0);
  }

  it("calls posAtCoords (not nodeDOM/getBoundingClientRect) and updates activeId on scroll", () => {
    const editor = makeEditor([
      { type: "heading", level: 1, text: "One" },
      { type: "heading", level: 2, text: "Two" },
      { type: "heading", level: 3, text: "Three" },
    ]);

    // Heading offsets are 0, 10, 20 (per the makeEditor stride).
    // Make `posAtCoords` report a probe position between h-10 and h-20 so the
    // resolver should pick "h-10".
    (editor.view.posAtCoords as ReturnType<typeof vi.fn>).mockReturnValue({ pos: 15, inside: 0 });

    const { result } = renderHook(() => useHeadings(editor));

    // Initial mount probe runs synchronously inside the effect.
    expect(editor.view.posAtCoords).toHaveBeenCalledTimes(1);
    expect(result.current.activeId).toBe("h-10");

    const posAtCoordsCallsBefore = (editor.view.posAtCoords as ReturnType<typeof vi.fn>).mock.calls
      .length;
    const nodeDomCallsBefore = (editor.view.nodeDOM as ReturnType<typeof vi.fn>).mock.calls.length;

    // Move the probe to a position past h-20 and dispatch a scroll.
    (editor.view.posAtCoords as ReturnType<typeof vi.fn>).mockReturnValue({ pos: 9999, inside: 0 });

    act(() => {
      editor._scrollParent.dispatchEvent(new Event("scroll"));
      editor._scrollParent.dispatchEvent(new Event("scroll"));
      editor._scrollParent.dispatchEvent(new Event("scroll"));
    });

    // Three scroll events should coalesce into a single RAF tick (one queued
    // frame, additional events bail early).
    expect(rafSpy).toHaveBeenCalledTimes(1);

    act(() => {
      flushRaf();
    });

    // posAtCoords ran exactly once per RAF tick — never per heading.
    expect(
      (editor.view.posAtCoords as ReturnType<typeof vi.fn>).mock.calls.length -
        posAtCoordsCallsBefore
    ).toBe(1);

    // nodeDOM must NOT have been called by the scroll-spy effect.
    expect(
      (editor.view.nodeDOM as ReturnType<typeof vi.fn>).mock.calls.length - nodeDomCallsBefore
    ).toBe(0);

    expect(result.current.activeId).toBe("h-20");

    editor.cleanup();
  });

  it("preserves the previous active heading when posAtCoords returns null", () => {
    const editor = makeEditor([
      { type: "heading", level: 1, text: "One" },
      { type: "heading", level: 2, text: "Two" },
    ]);

    // Initial probe picks h-10.
    (editor.view.posAtCoords as ReturnType<typeof vi.fn>).mockReturnValue({ pos: 12, inside: 0 });

    const { result } = renderHook(() => useHeadings(editor));
    expect(result.current.activeId).toBe("h-10");

    // Next probe returns null — the previous active id must be preserved.
    (editor.view.posAtCoords as ReturnType<typeof vi.fn>).mockReturnValue(null);

    act(() => {
      editor._scrollParent.dispatchEvent(new Event("scroll"));
    });
    act(() => {
      flushRaf();
    });

    expect(result.current.activeId).toBe("h-10");

    editor.cleanup();
  });
});
