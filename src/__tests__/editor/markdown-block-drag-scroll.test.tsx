/**
 * What a drag and an outline jump are allowed to do to the scroll position, and what they may cost.
 *
 * Three of these are frame-rate arithmetic, which no assertion about pixels-on-screen can pin down:
 * jsdom performs no layout, so the only honest things to measure are how often the editor asks for
 * one and how far it scrolls per unit of *time* rather than per frame. `takeOverFrames` therefore
 * replaces `requestAnimationFrame` outright and hands the autoscroll loop timestamps of the test's
 * own choosing, which is the only way to run one gesture at 60Hz and the same gesture at 144Hz.
 *
 * The rect counter is a plain prototype assignment rather than `vi.spyOn`: spying on
 * `Element.prototype.getBoundingClientRect` installs a mock that reports itself as installed and is
 * then never called, so the count silently reads 0 and the test passes for the wrong reason.
 */

import { act, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarkdownBlockRuntime } from "@/editor/markdown-block/markdown-block-runtime";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useEditorStore } from "@/stores/editor-store";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { usePageSessionStore } from "@/stores/page-session-store";

const file: FileItem = {
  id: "page-1",
  name: "Page",
  content: "Hello\n",
  isFolder: false,
  parentId: null,
  position: 0,
  isFavorite: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  wordCount: 1,
  preview: "Hello",
};

function paragraphs(count: number): string {
  return `${Array.from({ length: count }, (_, index) => `Paragraph ${index}`).join("\n\n")}\n`;
}

function dragTransfer() {
  const data = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "uninitialized",
    files: [],
    items: [],
    get types() {
      return [...data.keys()];
    },
    clearData: () => data.clear(),
    getData: (type: string) => data.get(type) ?? "",
    setData: (type: string, value: string) => void data.set(type, value),
    setDragImage: vi.fn(),
  } as unknown as DataTransfer;
}

/** jsdom has no `DragEvent`, so Testing Library drops `clientY` unless it is defined explicitly. */
function fireDragAt(
  target: HTMLElement,
  type: "dragStart" | "dragOver",
  dataTransfer: DataTransfer,
  clientY: number
) {
  const event = createEvent[type](target, { dataTransfer });
  Object.defineProperty(event, "clientY", { value: clientY, configurable: true });
  return fireEvent(target, event);
}

function firstGrip(): HTMLElement {
  return screen.getAllByRole("button", { name: "Block actions" })[0];
}

/** The scroll port the autoscroll ramp measures itself against: 900px tall, starting at y=0. */
function stubScrollPort(container: HTMLElement): HTMLElement {
  const scroller = container.querySelector<HTMLElement>("[data-native-markdown-scroll]");
  if (!scroller) throw new Error("no scroll container");
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 1440,
    bottom: 900,
    width: 1440,
    height: 900,
    toJSON: () => ({}),
  } as DOMRect);
  return scroller;
}

/** Take `requestAnimationFrame` over, so frames arrive at a rate and cadence the test chooses. */
function takeOverFrames() {
  let queue: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    queue.push(callback);
    return queue.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {
    queue = [];
  });
  let now = 0;
  return (frames: number, msPerFrame: number) => {
    for (let index = 0; index < frames; index += 1) {
      now += msPerFrame;
      const due = queue;
      queue = [];
      for (const callback of due) callback(now);
    }
  };
}

describe("Block drag and outline scrolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useFileStore.setState({ updateFile: async () => {} });
    useEditorStore.setState({ isDirty: false, isSaving: false, lastSavedAt: null });
    useEditorRefStore.setState({
      requestSave: null,
      requestUndo: null,
      requestRedo: null,
      discardPendingChanges: null,
    });
    useLayoutStore.setState({ autosaveEnabled: false, isSearchBarOpen: false });
    usePageSessionStore.setState({ outlineSession: null, revealRequest: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not move the Page when a drag starts", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: paragraphs(12) }} />
    );
    const scroller = stubScrollPort(container);
    const driveFrames = takeOverFrames();
    scroller.scrollTop = 900;

    // The pointer is on the grip, mid-port, in neither autoscroll band. Until the autoscroll loop
    // was told where it is, it read the pointer as being above the port and ran the top ramp.
    fireDragAt(firstGrip(), "dragStart", dragTransfer(), 400);
    act(() => driveFrames(12, 16));

    expect(scroller.scrollTop).toBe(900);
  });

  it("ramps the drag autoscroll per second, so a fast display does not scroll faster", () => {
    const held = (frames: number, msPerFrame: number) => {
      const view = render(<MarkdownBlockRuntime file={{ ...file, content: paragraphs(12) }} />);
      const scroller = stubScrollPort(view.container);
      const driveFrames = takeOverFrames();
      // 60px above the port's lower edge, inside the 72px band, where the ramp reads 440px/s.
      fireDragAt(firstGrip(), "dragStart", dragTransfer(), 840);
      act(() => driveFrames(frames, msPerFrame));
      const scrolled = scroller.scrollTop;
      view.unmount();
      return scrolled;
    };

    const at60Hz = held(30, 1000 / 60);
    const at144Hz = held(72, 1000 / 144);

    // Both gestures were held for ~500ms, so both must travel ~220px. Added once per frame instead
    // of once per second, the 144Hz run covered 2.4x the ground of the 60Hz one.
    expect(at60Hz).toBeGreaterThan(195);
    expect(at60Hz).toBeLessThan(225);
    expect(at144Hz).toBeGreaterThan(195);
    expect(at144Hz).toBeLessThan(225);
  });

  it("measures the drop boundaries once per drag, not once per autoscroll frame", () => {
    let rowRects = 0;
    const measureRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this instanceof HTMLElement && this.hasAttribute("data-native-block-row")) rowRects += 1;
      return measureRect.call(this);
    };
    try {
      const { container } = render(
        <MarkdownBlockRuntime file={{ ...file, content: paragraphs(40) }} />
      );
      const scroller = stubScrollPort(container);
      const driveFrames = takeOverFrames();

      fireDragAt(firstGrip(), "dragStart", dragTransfer(), 880);
      // One pass over the 40 rows, plus a second read of the last one for the tail boundary. That
      // is the whole layout budget for the drag.
      expect(rowRects).toBe(41);

      act(() => driveFrames(20, 16));

      expect(scroller.scrollTop).toBeGreaterThan(0);
      expect(rowRects).toBe(41);
    } finally {
      Element.prototype.getBoundingClientRect = measureRect;
    }
  });

  it("reads the same drop boundary after autoscroll has moved the Page under the pointer", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n\nThird\n" }} />
    );
    const scroller = stubScrollPort(container);
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    // A layout for the boundary table to be built from: three 40px rows starting at y=100.
    rows.forEach((row, index) => {
      vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
        x: 0,
        y: 100 + index * 40,
        top: 100 + index * 40,
        left: 0,
        right: 600,
        bottom: 140 + index * 40,
        width: 600,
        height: 40,
        toJSON: () => ({}),
      } as DOMRect);
    });

    const transfer = dragTransfer();
    fireDragAt(firstGrip(), "dragStart", transfer, 400);
    // Autoscroll moves the Page 60px under a pointer that has not moved. "Third" now spans 120-160
    // and the end of the Page sits at 160. The table is never rebuilt, so these only come out right
    // because its coordinates are the scroller's content rather than the viewport's.
    scroller.scrollTop = 60;

    fireDragAt(scroller, "dragOver", transfer, 130);
    expect(rows[2]).toHaveAttribute("data-drop-before", "true");

    fireDragAt(scroller, "dragOver", transfer, 160);
    expect(rows[2]).not.toHaveAttribute("data-drop-before");
    expect(container.querySelector("[data-native-block-drop-end]")).toHaveAttribute(
      "data-drop-active",
      "true"
    );
  });

  it("leaves the outline's smooth scroll as the only scroll its navigation performs", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "# One\n\nBody\n\n## Two\n\nMore\n" }} />
    );
    const scrolls: { blockId: string; options: unknown }[] = [];
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    for (const row of rows) {
      row.scrollIntoView = (options?: unknown) => {
        scrolls.push({ blockId: row.dataset.blockId ?? "", options });
      };
    }
    const session = usePageSessionStore.getState().outlineSession;
    expect(session?.headings).toHaveLength(2);
    if (!session) return;

    act(() => session.navigateTo(session.headings[1], { skipFocus: true }));

    // Exactly one. The activating row's own `block: "nearest"` scroll reaches the container while
    // this smooth one is still in flight and cancels it, stopping the Page short of the heading.
    expect(scrolls).toEqual([
      { blockId: "block-3", options: { behavior: "smooth", block: "start" } },
    ]);
    // Consumed, so it cannot stand the row down on some later, unrelated activation.
    expect(rows[2].hasAttribute("data-outline-scroll")).toBe(false);
  });
});
