import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { render, waitFor, act } from "@testing-library/react";

vi.mock("@/lib/mermaid-renderer", () => ({
  renderMermaidSvg: vi.fn(),
  getMermaidThemeKey: vi.fn(() => "notion-light"),
  subscribeMermaidTheme: vi.fn(() => () => {}),
}));

vi.mock("./mermaid-editor-panel", () => ({
  MermaidEditorPanel: () => null,
}));

vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

import { MermaidNodeView, __mermaidTestUtils } from "@/components/editor/mermaid/mermaid-node-view";
import {
  renderMermaidSvg,
  getMermaidThemeKey,
  subscribeMermaidTheme,
} from "@/lib/mermaid-renderer";

const renderMermaidSvgMock = renderMermaidSvg as unknown as Mock;
const getMermaidThemeKeyMock = getMermaidThemeKey as unknown as Mock;
const subscribeMermaidThemeMock = subscribeMermaidTheme as unknown as Mock;

const SAMPLE_SVG = '<svg id="sample" viewBox="0 0 100 100"><rect/></svg>';

function makeNodeProps(code: string) {
  return {
    node: { attrs: { code } },
    updateAttributes: vi.fn(),
    deleteNode: vi.fn(),
    editor: { isEditable: true },
    getPos: () => 0,
    decorations: [],
    selected: false,
    extension: {} as never,
    innerDecorations: [] as never,
    HTMLAttributes: {},
  } as unknown as Parameters<typeof MermaidNodeView>[0];
}

describe("MermaidNodeView caching", () => {
  beforeEach(() => {
    __mermaidTestUtils.clearCaches();
    renderMermaidSvgMock.mockReset();
    getMermaidThemeKeyMock.mockReset();
    getMermaidThemeKeyMock.mockReturnValue("notion-light");
    subscribeMermaidThemeMock.mockReset();
    subscribeMermaidThemeMock.mockReturnValue(() => {});
  });

  it("renders only once when the same chart mounts twice (cache hit)", async () => {
    renderMermaidSvgMock.mockResolvedValue(SAMPLE_SVG);

    const props = makeNodeProps("graph TD\n  A --> B");

    const first = render(<MermaidNodeView {...props} />);
    await waitFor(() => {
      expect(first.container.querySelector("svg")).not.toBeNull();
    });
    first.unmount();

    expect(renderMermaidSvgMock).toHaveBeenCalledTimes(1);

    const second = render(<MermaidNodeView {...props} />);
    // Cache hit is initialized synchronously via the lazy state initializer —
    // the SVG is in the DOM before any effect runs.
    expect(second.container.querySelector("svg")).not.toBeNull();
    expect(renderMermaidSvgMock).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  it("dedupes concurrent renders of the same chart", async () => {
    let resolveRender: ((svg: string) => void) | null = null;
    renderMermaidSvgMock.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveRender = resolve;
        })
    );

    const props = makeNodeProps("graph TD\n  A --> B");
    const a = render(<MermaidNodeView {...props} />);
    const b = render(<MermaidNodeView {...props} />);

    expect(renderMermaidSvgMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRender!(SAMPLE_SVG);
    });

    await waitFor(() => {
      expect(a.container.querySelector("svg")).not.toBeNull();
      expect(b.container.querySelector("svg")).not.toBeNull();
    });

    a.unmount();
    b.unmount();
  });

  it("re-renders when the theme key changes (cache key namespace)", async () => {
    renderMermaidSvgMock.mockResolvedValue(SAMPLE_SVG);

    const props = makeNodeProps("graph TD\n  A --> B");

    const view = render(<MermaidNodeView {...props} />);
    await waitFor(() => {
      expect(view.container.querySelector("svg")).not.toBeNull();
    });
    expect(renderMermaidSvgMock).toHaveBeenCalledTimes(1);

    // Simulate a theme change: getMermaidThemeKey returns a new value, and
    // the subscriber fires (useSyncExternalStore re-reads the store).
    getMermaidThemeKeyMock.mockReturnValue("dark-dark");
    const subscribers = subscribeMermaidThemeMock.mock.calls.map(
      (call: unknown[]) => call[0] as () => void
    );

    await act(async () => {
      subscribers.forEach((fn) => fn());
    });

    await waitFor(() => {
      expect(renderMermaidSvgMock).toHaveBeenCalledTimes(2);
    });

    view.unmount();
  });

  it("falls back to a code preview when render rejects", async () => {
    renderMermaidSvgMock.mockRejectedValue(new Error("syntax error"));

    const props = makeNodeProps("not::a::diagram");
    const view = render(<MermaidNodeView {...props} />);

    await waitFor(() => {
      const pre = view.container.querySelector("pre");
      expect(pre).not.toBeNull();
      expect(pre?.textContent).toContain("not::a::diagram");
    });

    view.unmount();
  });

  it("shows a 'Rendering mermaid…' placeholder while waiting for the first render", async () => {
    renderMermaidSvgMock.mockImplementation(() => new Promise<string>(() => {}));

    const props = makeNodeProps("graph TD\n  A --> B");
    const view = render(<MermaidNodeView {...props} />);

    expect(view.container.textContent).toContain("Rendering mermaid");
    view.unmount();
  });

  it("paints the SVG on the very first commit when the cache has it (no flicker)", async () => {
    // Pre-populate the cache as if a previous mount had already rendered.
    renderMermaidSvgMock.mockResolvedValue(SAMPLE_SVG);
    const props = makeNodeProps("graph TD\n  A --> B");

    const warmup = render(<MermaidNodeView {...props} />);
    await waitFor(() => {
      expect(warmup.container.querySelector("svg")).not.toBeNull();
    });
    warmup.unmount();

    // Now mount fresh — the FIRST commit should already include the SVG,
    // before any effect runs, because state is seeded from the cache.
    const fresh = render(<MermaidNodeView {...props} />);
    expect(fresh.container.querySelector("svg")).not.toBeNull();
    expect(fresh.container.textContent).not.toContain("Rendering mermaid");
    fresh.unmount();
  });
});
