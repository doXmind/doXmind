import { act, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
  type MockInstance,
} from "vitest";

vi.mock("katex", () => ({
  default: { renderToString: vi.fn(() => "<span>Rendered equation</span>") },
}));

import { MarkdownCodeBlock } from "@/editor/markdown-block/markdown-code-block";
import { MarkdownFigureBlock } from "@/editor/markdown-block/markdown-figure-block";
import { SemanticInlineEditor } from "@/editor/markdown-block/semantic-inline-editor";

/**
 * Every surface that focuses itself must ask the browser for the smallest scroll that works.
 *
 * `focus()` scrolls with Blink's `ScrollAlignment::CenterIfNeeded`, which is bimodal: a surface
 * still partially on screen is not moved at all, and one entirely off screen is recentred at the
 * scroll-port midline. Measured in the running app at 1440x900 (an 868px scroll port), on the
 * equation panel with the field parked below the fold: a bare `focus()` scrolled the Page 492px,
 * and `focus({preventScroll: true})` followed by `scrollIntoView({block: "nearest"})` scrolled it
 * 109 — exactly enough to bring the field into view. End to end that is an arrow walk down a Page
 * stepping 39, 39, 39, 491 (into the equation) rather than a uniform 39, with the overshoot large
 * enough that the eleven presses after it moved the Page not at all.
 *
 * Asserted as "which call was made", not as a pixel, because jsdom has no layout: the pixels are in
 * the measurement above and the contract is that no surface goes back to a bare `focus()`.
 */
describe("focus never scrolls a Block on the browser's terms", () => {
  let focusSpy: MockInstance<(options?: FocusOptions) => void>;
  let scrollIntoView: Mock<(options?: boolean | ScrollIntoViewOptions) => void>;

  beforeEach(() => {
    // jsdom implements no scrolling at all, so `scrollIntoView` is missing rather than inert.
    scrollIntoView = vi.fn<(options?: boolean | ScrollIntoViewOptions) => void>();
    Element.prototype.scrollIntoView = scrollIntoView;
    focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
  });

  afterEach(async () => {
    // KaTeX renders through an effect; let it land before the tree is torn down.
    await act(async () => undefined);
    focusSpy.mockRestore();
  });

  /** The surface's own focus call, ignoring any the test harness or jsdom made on other nodes. */
  function focusOptionsFor(element: Element): unknown[] {
    return focusSpy.mock.calls
      .filter((_call, index) => focusSpy.mock.instances[index] === element)
      .map((call) => call[0]);
  }

  it("takes the semantic inline editor's caret without a browser scroll", () => {
    render(<SemanticInlineEditor source="Paragraph alpha" autoFocus onSourceChange={vi.fn()} />);
    const editor = screen.getByRole("textbox", { name: "Markdown block" });

    expect(focusOptionsFor(editor)).toContainEqual({ preventScroll: true });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(scrollIntoView.mock.instances[0]).toBe(editor);
  });

  it("takes a code Block's caret without a browser scroll", () => {
    render(
      <MarkdownCodeBlock
        blockId="block-1"
        source={"```ts\nconst a = 1;\n```"}
        editable
        onChange={vi.fn()}
        renderInline={(markdown) => markdown}
      />
    );
    const field = screen.getByRole("textbox", { name: "Markdown block" });

    expect(focusOptionsFor(field)).toContainEqual({ preventScroll: true });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(scrollIntoView.mock.instances[0]).toBe(field);
  });

  it("takes an equation's caret without a browser scroll", () => {
    render(
      <MarkdownFigureBlock
        blockId="block-1"
        kind="block_math"
        source={"$$\nE = mc^2\n$$"}
        editable
        onChange={vi.fn()}
        renderInline={(markdown) => markdown}
      />
    );
    const field = screen.getByRole("textbox", { name: "LaTeX source" });

    expect(focusOptionsFor(field)).toContainEqual({ preventScroll: true });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(scrollIntoView.mock.instances[0]).toBe(field);
  });
});
