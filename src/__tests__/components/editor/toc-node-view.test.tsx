import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ReactNode } from "react";
import type { Heading } from "@/components/editor/mindlines/canonical-outline";

vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("@/components/editor/mindlines/use-canonical-outline", () => ({
  subscribeOutline: vi.fn(),
}));

import { TocNodeView } from "@/components/editor/toc-node-view";
import { subscribeOutline } from "@/components/editor/mindlines/use-canonical-outline";

const subscribeOutlineMock = subscribeOutline as unknown as Mock;

interface FakeEditor {
  state: {
    doc: {
      descendants: Mock;
      forEach: Mock;
    };
  };
  view: {
    dom: HTMLElement;
    coordsAtPos: Mock;
  };
  commands: {
    setTextSelection: Mock;
    focus: Mock;
  };
}

function makeEditor(): FakeEditor {
  const dom = document.createElement("div");
  return {
    state: {
      doc: {
        descendants: vi.fn(),
        forEach: vi.fn(),
      },
    },
    view: {
      dom,
      coordsAtPos: vi.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
    },
    commands: {
      setTextSelection: vi.fn(),
      focus: vi.fn(),
    },
  };
}

function makeNodeViewProps(editor: FakeEditor) {
  return {
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
}

function fakeHeadings(count: number, level: 1 | 2 | 3 | 4 | 5 | 6 = 1): Heading[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `h-${i}`,
    level,
    text: `Heading ${i}`,
    pos: i * 10,
  }));
}

describe("TocNodeView", () => {
  beforeEach(() => {
    subscribeOutlineMock.mockReset();
  });

  afterEach(() => {
    subscribeOutlineMock.mockReset();
  });

  it("subscribes to subscribeOutline with the editor on mount and unsubscribes on unmount", () => {
    const editor = makeEditor();
    const unsubscribe = vi.fn();
    subscribeOutlineMock.mockImplementation((_editor, listener: (h: Heading[]) => void) => {
      listener([]);
      return unsubscribe;
    });

    const view = render(<TocNodeView {...makeNodeViewProps(editor)} />);

    expect(subscribeOutlineMock).toHaveBeenCalledTimes(1);
    expect(subscribeOutlineMock.mock.calls[0][0]).toBe(editor);
    expect(unsubscribe).not.toHaveBeenCalled();

    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("renders at most maxShowCount (default 50) entries when the outline is larger", () => {
    const editor = makeEditor();
    let emit: (next: Heading[]) => void = () => {};
    subscribeOutlineMock.mockImplementation((_editor, listener: (h: Heading[]) => void) => {
      emit = listener;
      listener([]);
      return () => {};
    });

    const view = render(<TocNodeView {...makeNodeViewProps(editor)} />);

    act(() => {
      emit(fakeHeadings(100));
    });

    const buttons = view.container.querySelectorAll("nav button");
    expect(buttons.length).toBe(50);
    // Sanity check: the first 50 are shown, not the last 50.
    expect(buttons[0].textContent).toBe("Heading 0");
    expect(buttons[49].textContent).toBe("Heading 49");

    view.unmount();
  });

  it("renders every heading when the outline is at or below the cap", () => {
    const editor = makeEditor();
    let emit: (next: Heading[]) => void = () => {};
    subscribeOutlineMock.mockImplementation((_editor, listener: (h: Heading[]) => void) => {
      emit = listener;
      listener([]);
      return () => {};
    });

    const view = render(<TocNodeView {...makeNodeViewProps(editor)} />);

    act(() => {
      emit(fakeHeadings(7));
    });

    const buttons = view.container.querySelectorAll("nav button");
    expect(buttons.length).toBe(7);

    view.unmount();
  });

  it("preserves every heading level 1 through 6 (no level filter)", () => {
    const editor = makeEditor();
    let emit: (next: Heading[]) => void = () => {};
    subscribeOutlineMock.mockImplementation((_editor, listener: (h: Heading[]) => void) => {
      emit = listener;
      listener([]);
      return () => {};
    });

    const mixed: Heading[] = [
      { id: "h-0", level: 1, text: "One", pos: 0 },
      { id: "h-10", level: 2, text: "Two", pos: 10 },
      { id: "h-20", level: 3, text: "Three", pos: 20 },
      { id: "h-30", level: 4, text: "Four", pos: 30 },
      { id: "h-40", level: 5, text: "Five", pos: 40 },
      { id: "h-50", level: 6, text: "Six", pos: 50 },
    ];

    const view = render(<TocNodeView {...makeNodeViewProps(editor)} />);

    act(() => {
      emit(mixed);
    });

    const labels = Array.from(view.container.querySelectorAll("nav button")).map(
      (button) => button.textContent
    );
    expect(labels).toEqual(["One", "Two", "Three", "Four", "Five", "Six"]);

    view.unmount();
  });

  it("does not scan the document for headings (no doc.descendants / doc.forEach)", () => {
    const editor = makeEditor();
    let emit: (next: Heading[]) => void = () => {};
    subscribeOutlineMock.mockImplementation((_editor, listener: (h: Heading[]) => void) => {
      emit = listener;
      listener([]);
      return () => {};
    });

    const view = render(<TocNodeView {...makeNodeViewProps(editor)} />);

    act(() => {
      emit(fakeHeadings(5));
    });

    expect(editor.state.doc.descendants).not.toHaveBeenCalled();
    expect(editor.state.doc.forEach).not.toHaveBeenCalled();

    view.unmount();
  });
});
