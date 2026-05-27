import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import {
  equals,
  normalizeFromEditor,
  type Heading,
} from "@/components/editor/mindlines/canonical-outline";
import {
  getOutlineSnapshot,
  subscribeOutline,
  useCanonicalOutline,
} from "@/components/editor/mindlines/use-canonical-outline";
import { useHeadings } from "@/components/editor/mindlines/use-headings";

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

function makeEditor(nodes: FakeNode[]) {
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
  const editor = {
    state: buildState(),
    isEditable: false,
    view: {
      dom: viewDom,
      nodeDOM: () => null,
    },
    on(event: string, listener: UpdateListener) {
      if (event === "update") listeners.add(listener);
    },
    off(event: string, listener: UpdateListener) {
      if (event === "update") listeners.delete(listener);
    },
    triggerUpdate(nextNodes?: FakeNode[]) {
      if (nextNodes) {
        nodes.splice(0, nodes.length, ...nextNodes);
        editor.state = buildState();
      }
      for (const listener of listeners) listener();
    },
  };

  return editor as unknown as Editor & { triggerUpdate: (next?: FakeNode[]) => void };
}

describe("normalizeFromEditor", () => {
  it("includes headings at every level 1–6 without filtering", () => {
    const editor = makeEditor([
      { type: "heading", level: 1, text: "One" },
      { type: "heading", level: 2, text: "Two" },
      { type: "heading", level: 3, text: "Three" },
      { type: "heading", level: 4, text: "Four" },
      { type: "heading", level: 5, text: "Five" },
      { type: "heading", level: 6, text: "Six" },
    ]);

    const result = normalizeFromEditor(editor);

    expect(result.map((heading) => heading.level)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.map((heading) => heading.text)).toEqual([
      "One",
      "Two",
      "Three",
      "Four",
      "Five",
      "Six",
    ]);
  });

  it("ignores non-heading nodes and falls back to 'Untitled' when text is empty", () => {
    const editor = makeEditor([
      { type: "paragraph", text: "skip me" },
      { type: "heading", level: 2, text: "" },
      { type: "heading", level: 3, text: "Real" },
    ]);

    const result = normalizeFromEditor(editor);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ level: 2, text: "Untitled" });
    expect(result[1]).toMatchObject({ level: 3, text: "Real" });
  });

  it("ignores heading nodes with out-of-range levels", () => {
    const editor = makeEditor([
      { type: "heading", level: 0, text: "Bad low" },
      { type: "heading", level: 7, text: "Bad high" },
      { type: "heading", level: 2, text: "Good" },
    ]);

    const result = normalizeFromEditor(editor);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ level: 2, text: "Good" });
  });

  it("returns headings sorted by .pos", () => {
    const editor = makeEditor([
      { type: "heading", level: 1, text: "First" },
      { type: "paragraph" },
      { type: "heading", level: 2, text: "Second" },
      { type: "paragraph" },
      { type: "heading", level: 3, text: "Third" },
    ]);

    const result = normalizeFromEditor(editor);
    const positions = result.map((heading) => heading.pos);

    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(result.map((heading) => heading.text)).toEqual(["First", "Second", "Third"]);
  });
});

describe("equals", () => {
  const baseline: Heading[] = [
    { id: "h-0", level: 1, text: "A", pos: 0 },
    { id: "h-10", level: 2, text: "B", pos: 10 },
  ];

  it("returns true for structurally-identical lists with different array identity", () => {
    const clone: Heading[] = baseline.map((heading) => ({ ...heading }));
    expect(equals(baseline, clone)).toBe(true);
  });

  it("returns false when any field differs", () => {
    expect(equals(baseline, [baseline[0]])).toBe(false);
    expect(equals(baseline, [baseline[0], { ...baseline[1], text: "different" }])).toBe(false);
    expect(equals(baseline, [baseline[0], { ...baseline[1], pos: 999 }])).toBe(false);
    expect(equals(baseline, [baseline[0], { ...baseline[1], level: 3 }])).toBe(false);
    expect(equals(baseline, [baseline[0], { ...baseline[1], id: "h-different" }])).toBe(false);
  });

  it("treats two empty arrays as equal", () => {
    expect(equals([], [])).toBe(true);
  });
});

describe("subscribeOutline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits the initial snapshot synchronously and suppresses duplicate emissions", () => {
    const editor = makeEditor([
      { type: "heading", level: 1, text: "Intro" },
      { type: "heading", level: 2, text: "Body" },
    ]);
    const listener = vi.fn();

    const unsubscribe = subscribeOutline(editor, listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject([
      { level: 1, text: "Intro" },
      { level: 2, text: "Body" },
    ]);

    editor.triggerUpdate();
    act(() => vi.advanceTimersByTime(200));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("emits a new snapshot when the document changes", () => {
    const editor = makeEditor([{ type: "heading", level: 1, text: "Intro" }]);
    const listener = vi.fn();

    const unsubscribe = subscribeOutline(editor, listener);
    listener.mockClear();

    editor.triggerUpdate([
      { type: "heading", level: 1, text: "Intro" },
      { type: "heading", level: 2, text: "Detail" },
    ]);
    act(() => vi.advanceTimersByTime(200));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toHaveLength(2);

    unsubscribe();
  });

  it("preserves snapshot identity across an editor swap when content matches", () => {
    const editorA = makeEditor([
      { type: "heading", level: 1, text: "Same" },
      { type: "heading", level: 2, text: "Content" },
    ]);
    const editorB = makeEditor([
      { type: "heading", level: 1, text: "Same" },
      { type: "heading", level: 2, text: "Content" },
    ]);

    const snapshotA = getOutlineSnapshot(editorA);
    const snapshotB = getOutlineSnapshot(editorB);

    expect(equals(snapshotA, snapshotB)).toBe(true);
  });
});

describe("useCanonicalOutline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the canonical snapshot for the editor", () => {
    const editor = makeEditor([
      { type: "heading", level: 1, text: "Top" },
      { type: "heading", level: 4, text: "Deep" },
    ]);

    const { result } = renderHook(() => useCanonicalOutline(editor));

    expect(result.current.headings.map((heading) => heading.level)).toEqual([1, 4]);
  });

  it("returns an empty list when the editor is null", () => {
    const { result } = renderHook(() => useCanonicalOutline(null));
    expect(result.current.headings).toEqual([]);
  });

  it("preserves the headings reference across an editor swap when content matches", () => {
    const editorA = makeEditor([
      { type: "heading", level: 1, text: "Stable" },
      { type: "heading", level: 2, text: "Outline" },
    ]);
    const editorB = makeEditor([
      { type: "heading", level: 1, text: "Stable" },
      { type: "heading", level: 2, text: "Outline" },
    ]);

    const { result, rerender } = renderHook(
      ({ editor }: { editor: typeof editorA }) => useCanonicalOutline(editor),
      { initialProps: { editor: editorA } }
    );

    const before = result.current.headings;
    expect(before.map((heading) => heading.text)).toEqual(["Stable", "Outline"]);

    rerender({ editor: editorB });

    expect(result.current.headings).toBe(before);
  });

  it("produces a new headings reference across an editor swap when content differs", () => {
    const editorA = makeEditor([
      { type: "heading", level: 1, text: "Old" },
      { type: "heading", level: 2, text: "Outline" },
    ]);
    const editorB = makeEditor([
      { type: "heading", level: 1, text: "New" },
      { type: "heading", level: 2, text: "Outline" },
    ]);

    const { result, rerender } = renderHook(
      ({ editor }: { editor: typeof editorA }) => useCanonicalOutline(editor),
      { initialProps: { editor: editorA } }
    );

    const before = result.current.headings;
    rerender({ editor: editorB });

    expect(result.current.headings).not.toBe(before);
    expect(result.current.headings.map((heading) => heading.text)).toEqual(["New", "Outline"]);
  });
});

describe("useHeadings consumer-boundary filter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("filters out levels above 3 even when the canonical source exposes them", () => {
    const editor = makeEditor([
      { type: "heading", level: 1, text: "One" },
      { type: "heading", level: 2, text: "Two" },
      { type: "heading", level: 3, text: "Three" },
      { type: "heading", level: 4, text: "Four" },
      { type: "heading", level: 5, text: "Five" },
      { type: "heading", level: 6, text: "Six" },
    ]);

    const { result } = renderHook(() => useHeadings(editor));

    expect(result.current.headings.map((heading) => heading.level)).toEqual([1, 2, 3]);
    expect(result.current.headings.map((heading) => heading.text)).toEqual(["One", "Two", "Three"]);
  });

  it("returns an empty list when fewer than two headings would survive the filter", () => {
    const editor = makeEditor([
      { type: "heading", level: 1, text: "Only" },
      { type: "heading", level: 4, text: "Deep" },
    ]);

    const { result } = renderHook(() => useHeadings(editor));

    expect(result.current.headings).toEqual([]);
  });
});
