import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mermaidTheme, renderMermaidSvg, renderMermaidSvgLight, renderToString } = vi.hoisted(
  () => ({
    mermaidTheme: { value: "test-light" },
    renderMermaidSvg: vi.fn(async () => "<svg><text>Rendered diagram</text></svg>"),
    renderMermaidSvgLight: vi.fn(async () => "<svg><text>Printable diagram</text></svg>"),
    renderToString: vi.fn(() => '<span data-testid="rendered-math">Rendered equation</span>'),
  })
);

vi.mock("@/lib/mermaid-renderer", () => ({
  getMermaidThemeKey: () => mermaidTheme.value,
  subscribeMermaidTheme: () => () => undefined,
  renderMermaidSvg,
  renderMermaidSvgLight,
}));

vi.mock("katex", () => ({
  default: { renderToString },
}));

import {
  MarkdownFigureBlock,
  type MarkdownFigureKind,
} from "@/editor/markdown-block/markdown-figure-block";

function renderFigure(
  kind: MarkdownFigureKind,
  source: string,
  options: { editable?: boolean } = {}
) {
  const onChange = vi.fn();
  const onKeyDown = vi.fn();
  const view = render(
    <MarkdownFigureBlock
      blockId="block-1"
      kind={kind}
      source={source}
      editable={options.editable ?? true}
      onChange={onChange}
      onKeyDown={onKeyDown}
      renderInline={(markdown: string): ReactNode => markdown}
    />
  );
  return { ...view, onChange, onKeyDown };
}

/**
 * Let the mocked renderers resolve before the test ends.
 *
 * Both renders are asynchronous, so a test that finishes without waiting leaves a state update to
 * land after React has torn the tree down. That is only a warning, but a suite full of them is a
 * suite where the next genuine act violation goes unread.
 */
async function settle(): Promise<void> {
  await act(async () => undefined);
}

/** The source field, addressed the way the user reaches it: by its accessible name. */
function sourceField(kind: MarkdownFigureKind): HTMLTextAreaElement {
  return screen.getByRole("textbox", {
    name: kind === "block_math" ? "LaTeX source" : "Mermaid source",
  }) as HTMLTextAreaElement;
}

describe("MarkdownFigureBlock", () => {
  beforeEach(() => {
    mermaidTheme.value = "test-light";
    renderMermaidSvg.mockClear();
    renderMermaidSvgLight.mockClear();
    renderToString.mockClear();
    renderMermaidSvg.mockResolvedValue("<svg><text>Rendered diagram</text></svg>");
  });

  describe("block_math", () => {
    it("keeps the rendered equation on screen while the Block is editable", async () => {
      renderFigure("block_math", "$$\nE = mc^2\n$$");

      expect(await screen.findByTestId("rendered-math")).toHaveTextContent("Rendered equation");
      expect(screen.getByTestId("block-math-block")).toBeInTheDocument();
      expect(renderToString).toHaveBeenCalledWith(
        "E = mc^2",
        expect.objectContaining({
          displayMode: true,
          throwOnError: false,
          trust: false,
        })
      );
    });

    it("asks for one alignment, the one math-mermaid.css already enforces", async () => {
      // The wrapper carried `text-center` while `.markdown-page .katex-display` and
      // `.markdown-page .katex-display > .katex` both pin `text-align: left`. The stylesheet won
      // every time, so the Block computed `center` on its own box and painted flush left — and the
      // pre-KaTeX `<code>` fallback, which no rule pins, was drawn centred and then jumped 418.97px
      // to the left margin the moment the render arrived.
      renderFigure("block_math", "$$\nE = mc^2\n$$");

      const wrapper = screen.getByTestId("block-math-block");
      expect(wrapper.className).toContain("block-math-wrapper");
      expect(wrapper.className).not.toContain("text-center");
      await settle();
    });

    it("shows the formula in the field without the delimiters that surround it", async () => {
      renderFigure("block_math", "$$\nE = mc^2\n$$");

      expect(sourceField("block_math")).toHaveValue("E = mc^2");
      await settle();
    });

    it("splices an edited formula back between the delimiters it was written with", async () => {
      const { onChange } = renderFigure("block_math", "$$\nE = mc^2\n$$");

      fireEvent.change(sourceField("block_math"), { target: { value: "E = mc^3" } });

      expect(onChange).toHaveBeenCalledWith("block-1", "$$\nE = mc^3\n$$");
      await settle();
    });

    it("keeps a one-line equation on one line", async () => {
      const { onChange } = renderFigure("block_math", "$$x^2$$");

      fireEvent.change(sourceField("block_math"), { target: { value: "x^3" } });

      expect(onChange).toHaveBeenCalledWith("block-1", "$$x^3$$");
      await settle();
    });

    it("promotes a one-line equation to the delimited shape when a newline is typed", async () => {
      const { onChange } = renderFigure("block_math", "$$x^2$$");

      fireEvent.change(sourceField("block_math"), { target: { value: "x^2\ny^2" } });

      expect(onChange).toHaveBeenCalledWith("block-1", "$$\nx^2\ny^2\n$$");
      await settle();
    });

    it("holds the line Enter opened until there is something to write on it", async () => {
      const { onChange } = renderFigure("block_math", "$$\na^2\n$$");
      const field = sourceField("block_math");

      // Enter at the end of the formula. The line cannot go into the file yet — a blank line above
      // the closing `$$` ends the Block — but the field snapping back to `a^2` is why Enter read as
      // a key that does nothing, and `\begin{aligned}` was unwritable without the clipboard.
      fireEvent.change(field, { target: { value: "a^2\n" } });

      expect(onChange).not.toHaveBeenCalled();
      expect(field).toHaveValue("a^2\n");

      fireEvent.change(field, { target: { value: "a^2\nb" } });

      expect(onChange).toHaveBeenCalledWith("block-1", "$$\na^2\nb\n$$");
      await settle();
    });

    it("still drops a payload the Block cannot hold at all", async () => {
      const { onChange } = renderFigure("block_math", "$$\na\n$$");
      const field = sourceField("block_math");

      fireEvent.change(field, { target: { value: "- a" } });

      // Only a trailing empty line is held. A refused payload still reverts, because holding it
      // would show the user an equation the file does not have.
      expect(onChange).not.toHaveBeenCalled();
      expect(field).toHaveValue("a");
      await settle();
    });

    it("collapses a blank line rather than letting it split the equation in two", async () => {
      const { onChange } = renderFigure("block_math", "$$\na\n$$");

      fireEvent.change(sourceField("block_math"), { target: { value: "a\n\nb" } });

      expect(onChange).toHaveBeenCalledWith("block-1", "$$\na\nb\n$$");
      await settle();
    });

    it("collapses an emptied equation to the one-line shape that can hold nothing", async () => {
      const { onChange } = renderFigure("block_math", "$$\nE = mc^2\n$$");

      fireEvent.change(sourceField("block_math"), { target: { value: "" } });

      expect(onChange).toHaveBeenCalledWith("block-1", "$$ $$");
      await settle();
    });

    it("preserves the indentation the delimiters were written with", async () => {
      const { onChange } = renderFigure("block_math", "  $$\na\n  $$");

      fireEvent.change(sourceField("block_math"), { target: { value: "b" } });

      expect(onChange).toHaveBeenCalledWith("block-1", "  $$\nb\n  $$");
      await settle();
    });

    it("writes back the CRLF the equation was written with", async () => {
      const { onChange } = renderFigure("block_math", "$$\r\na\r\nb\r\n$$");

      // A real `<textarea>` hands back `\n` whatever went in, so this is what the field reports on a
      // Windows file after one keystroke. Every byte outside the edit has to survive it.
      fireEvent.change(sourceField("block_math"), { target: { value: "a\nc" } });

      expect(onChange).toHaveBeenCalledWith("block-1", "$$\r\na\r\nc\r\n$$");
      await settle();
    });

    it("collapses a blank line on a CRLF file without breaking the pair apart", async () => {
      const { onChange } = renderFigure("block_math", "$$\r\na\r\nb\r\n$$");

      fireEvent.change(sourceField("block_math"), { target: { value: "a\n\nc" } });

      // The danger here is a `\r\n` being read as two line breaks and collapsed into one bare `\r`,
      // which leaves the file with a line ending it never had.
      expect(onChange).toHaveBeenCalledWith("block-1", "$$\r\na\r\nc\r\n$$");
      await settle();
    });

    it("refuses a payload that would stop the source being one equation", async () => {
      const { onChange } = renderFigure("block_math", "$$\na\n$$");

      fireEvent.change(sourceField("block_math"), { target: { value: "- a" } });

      expect(onChange).not.toHaveBeenCalled();
      await settle();
    });

    it("shows the equation and no field at all when the Block is not editable", async () => {
      renderFigure("block_math", "$$\nE = mc^2\n$$", { editable: false });

      expect(await screen.findByTestId("rendered-math")).toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
  });

  describe("mermaid", () => {
    const DIAGRAM = "```mermaid\ngraph TD\nA --> B\n```";

    it("keeps the rendered diagram on screen while the Block is editable", async () => {
      renderFigure("mermaid", DIAGRAM);

      expect(await screen.findByRole("img", { name: "Mermaid diagram" })).toHaveAttribute(
        "src",
        expect.stringContaining("Rendered%20diagram")
      );
      expect(renderMermaidSvg).toHaveBeenCalledWith("graph TD\nA --> B");
    });

    it("shows the diagram in the field without the fence that surrounds it", async () => {
      renderFigure("mermaid", DIAGRAM);

      expect(sourceField("mermaid")).toHaveValue("graph TD\nA --> B");
      await settle();
    });

    it("splices an edited diagram back inside its fence", async () => {
      const { onChange } = renderFigure("mermaid", DIAGRAM);

      fireEvent.change(sourceField("mermaid"), { target: { value: "graph LR\nA --> C" } });

      expect(onChange).toHaveBeenCalledWith("block-1", "```mermaid\ngraph LR\nA --> C\n```");
      await settle();
    });

    it("keeps the info string on the opening fence", async () => {
      const { onChange } = renderFigure("mermaid", "~~~mermaid\ngraph TD\n~~~");

      fireEvent.change(sourceField("mermaid"), { target: { value: "graph LR" } });

      expect(onChange).toHaveBeenCalledWith("block-1", "~~~mermaid\ngraph LR\n~~~");
      await settle();
    });

    it("accepts an emptied diagram, which a fence can hold", async () => {
      const { onChange } = renderFigure("mermaid", DIAGRAM);

      fireEvent.change(sourceField("mermaid"), { target: { value: "" } });

      expect(onChange).toHaveBeenCalledWith("block-1", "```mermaid\n\n```");
      await settle();
    });

    it("writes back the CRLF the fence was written with", async () => {
      const { onChange } = renderFigure("mermaid", "```mermaid\r\ngraph TD\r\nA --> B\r\n```");

      fireEvent.change(sourceField("mermaid"), { target: { value: "graph LR\nA --> C" } });

      expect(onChange).toHaveBeenCalledWith("block-1", "```mermaid\r\ngraph LR\r\nA --> C\r\n```");
      await settle();
    });

    it("refuses a payload carrying a line that would close the fence early", async () => {
      const { onChange } = renderFigure("mermaid", DIAGRAM);

      fireEvent.change(sourceField("mermaid"), { target: { value: "graph TD\n```\nA --> B" } });

      expect(onChange).not.toHaveBeenCalled();
      await settle();
    });

    it.each([
      ["\n", "```mermaid\ngraph TD\n```\nA --> B\n```"],
      ["\r\n", "```mermaid\r\ngraph TD\r\n```\r\nA --> B\r\n```"],
    ])(
      "locks the field on a diagram whose payload already holds a %j fence line",
      async (_eol, source) => {
        renderFigure("mermaid", source);

        // No edit to this payload can round-trip, because a fence has no escape sequence. Read-only
        // says so once, instead of leaving a field that accepts keystrokes and discards all of them.
        expect(sourceField("mermaid")).toHaveAttribute("readonly");
        await settle();
      }
    );

    it("reports a diagram that will not parse without losing the source", async () => {
      renderMermaidSvg.mockRejectedValueOnce(new Error("Parse error on line 1"));
      const { container } = renderFigure("mermaid", "```mermaid\ngraph T\n```");

      await waitFor(() =>
        expect(container.querySelector("[data-mermaid-error]")).toHaveTextContent(
          "Parse error on line 1"
        )
      );
      expect(sourceField("mermaid")).toHaveValue("graph T");
      expect(screen.getByTestId("mermaid-block")).toHaveTextContent("graph T");
    });

    it("holds the last diagram that parsed while a later edit does not", async () => {
      const { rerender, onChange, onKeyDown } = renderFigure("mermaid", DIAGRAM);
      await screen.findByRole("img", { name: "Mermaid diagram" });

      renderMermaidSvg.mockRejectedValueOnce(new Error("Parse error on line 1"));
      rerender(
        <MarkdownFigureBlock
          blockId="block-1"
          kind="mermaid"
          source={"```mermaid\ngraph TD\nA -->\n```"}
          editable
          onChange={onChange}
          onKeyDown={onKeyDown}
          renderInline={(markdown: string): ReactNode => markdown}
        />
      );

      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Parse error"));
      expect(screen.getByRole("img", { name: "Mermaid diagram" })).toBeInTheDocument();
    });

    it("flags the print copy as ready so the local PDF export does not print an empty figure", async () => {
      const { container } = renderFigure("mermaid", DIAGRAM, { editable: false });

      await waitFor(() =>
        expect(container.querySelector("[data-mermaid-print-ready]")).toHaveAttribute(
          "data-mermaid-print-ready",
          "true"
        )
      );
    });
  });

  describe("the contract every in-place Block keeps", () => {
    it.each<[MarkdownFigureKind, string, string]>([
      ["block_math", "$$\nE = mc^2\n$$", "block-math-block"],
      ["mermaid", "```mermaid\ngraph TD\n```", "mermaid-block"],
    ])("mounts %s rendered in both states", async (kind, source, testId) => {
      const { rerender, onChange, onKeyDown } = renderFigure(kind, source, { editable: false });
      const inactive = screen.getByTestId(testId);

      rerender(
        <MarkdownFigureBlock
          blockId="block-1"
          kind={kind}
          source={source}
          editable
          onChange={onChange}
          onKeyDown={onKeyDown}
          renderInline={(markdown: string): ReactNode => markdown}
        />
      );

      // The same DOM node, not an identical one: rule 1 is about the element never being torn down.
      expect(screen.getByTestId(testId)).toBe(inactive);
      expect(sourceField(kind)).toBeInTheDocument();
      await settle();
    });

    it.each<[MarkdownFigureKind, string]>([
      ["block_math", "$$\nE = mc^2\n$$"],
      ["mermaid", "```mermaid\ngraph TD\n```"],
    ])("gives %s exactly one focused editing surface", async (kind, source) => {
      renderFigure(kind, source);

      const surfaces = document.querySelectorAll("[data-native-block-editor]");
      expect(surfaces).toHaveLength(1);
      expect(document.activeElement).toBe(surfaces[0]);
      await settle();
    });

    it.each<[MarkdownFigureKind, string]>([
      ["block_math", "$$\nE = mc^2\n$$"],
      ["mermaid", "```mermaid\ngraph TD\n```"],
    ])("leaves %s with no editing surface at all when it is not editable", async (kind, source) => {
      const { container } = renderFigure(kind, source, { editable: false });

      expect(container.querySelectorAll("[data-native-block-editor]")).toHaveLength(0);
      await settle();
    });

    it.each<[MarkdownFigureKind, string]>([
      ["block_math", "$$\nE = mc^2\n$$"],
      ["mermaid", "```mermaid\ngraph TD\n```"],
    ])("hands Escape back to the %s Block and keeps Enter", async (kind, source) => {
      const { onKeyDown } = renderFigure(kind, source);

      fireEvent.keyDown(sourceField(kind), { key: "Escape" });
      expect(onKeyDown).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(sourceField(kind), { key: "Enter" });
      expect(onKeyDown).toHaveBeenCalledTimes(1);
      await settle();
    });

    it.each<[MarkdownFigureKind, string]>([
      ["block_math", "$$\nE = mc^2\n$$"],
      ["mermaid", "```mermaid\ngraph TD\nA --> B\n```"],
    ])("never shows a %s delimiter in the field", async (kind, source) => {
      renderFigure(kind, source);

      const value = sourceField(kind).value;
      expect(value).not.toContain("$$");
      expect(value).not.toContain("```");
      await settle();
    });

    it.each<[MarkdownFigureKind, string]>([
      ["block_math", "$$\nE = mc^2\n$$"],
      ["mermaid", "```mermaid\ngraph TD\n```"],
    ])("keeps the %s source panel in the row's own flow", async (kind, source) => {
      // Both obvious places are wrong, and the panel has been in each of them.
      //
      // Absolutely positioned inside the row it was painted over: every row carries `contain: layout
      // style`, so the row is its own stacking context and the panel's z-index never applied outside
      // it. Measured in the packaged app, a one-line equation's panel hung 34.80px past its row with
      // 87% of the next paragraph drawn over it; a twelve-line one hung 188.78px past, over five
      // whole Blocks.
      //
      // In flow the paint was right but the Page moved: activating a one-line equation grew its row
      // by 56.78px, which `in-place.spec.ts` forbids — the content under the pointer jumps away from
      // what the user was aiming at.
      //
      // Portalled to the body it paints correctly and the row keeps its height, but the editing
      // surface then lives outside the row it belongs to — and the caret mapping, the focus
      // restoration and six lookups in the e2e harness all read it out of the row. Moving that
      // assumption for two kinds is a bigger change than the defect justifies, so the panel stays in
      // flow and the row grows.
      renderFigure(kind, source);

      const panel = sourceField(kind).parentElement as HTMLElement;
      expect(panel.style.position).toBe("");
      expect(panel.style.zIndex).toBe("");
      expect(panel.className).toContain("mt-1");
      await settle();
    });

    it.each<[MarkdownFigureKind, string, number]>([
      ["block_math", `$$\n${"a = b \\\\\n".repeat(12)}$$`, 8],
      ["mermaid", "```mermaid\ngraph TD\nA --> B\n```", 2],
    ])("caps the %s field at eight rows and scrolls the rest", async (kind, source, rows) => {
      renderFigure(kind, source);

      // In flow, every row the field asks for is a row the Page is pushed down by, so a long
      // source scrolls inside the field rather than growing the Block without limit.
      expect(sourceField(kind).rows).toBe(rows);
      await settle();
    });

    it.each<[MarkdownFigureKind, string, string]>([
      ["block_math", "$$\nE = mc^2\n$$", "block-math-block"],
      ["mermaid", "```mermaid\ngraph TD\n```", "mermaid-block"],
    ])("leaves the %s render's own box untouched by activation", async (kind, source, testId) => {
      // The class list is the whole layout contribution of the rendered form. Rule 2 is about
      // pixels, which jsdom does not have, so this is the closest thing to a measurement: the box
      // that occupies the row must be styled identically before and after the field appears.
      const { rerender, onChange, onKeyDown } = renderFigure(kind, source, { editable: false });
      const before = screen.getByTestId(testId).className;

      rerender(
        <MarkdownFigureBlock
          blockId="block-1"
          kind={kind}
          source={source}
          editable
          onChange={onChange}
          onKeyDown={onKeyDown}
          renderInline={(markdown: string): ReactNode => markdown}
        />
      );

      expect(screen.getByTestId(testId).className).toBe(before);
      await settle();
    });
  });

  describe("the equation's hover surface", () => {
    it("hangs no style hook off the rendered formula", async () => {
      const { container } = renderFigure("block_math", "$$\nE = mc^2\n$$", { editable: false });
      await waitFor(() => expect(screen.getByTestId("rendered-math")).toBeInTheDocument());

      // `math-rendered` exists for exactly two rules in math-mermaid.css: `cursor: pointer` and a
      // hover tint. BLOCK_UX_REFERENCE records that a row hover tint was shipped and then removed
      // because it painted a full-column band over a short piece of content; this one survived the
      // removal and did the same thing — measured on the packaged app, hovering `E = mc^2` painted
      // 923px of band while hovering the paragraph above it painted nothing.
      expect(container.querySelector(".math-rendered")).toBeNull();
      await settle();
    });
  });

  describe("a diagram's own size", () => {
    it("copies the viewBox onto the SVG root so the image has an intrinsic size", async () => {
      const { withIntrinsicSize } =
        await vi.importActual<typeof import("@/lib/mermaid-renderer")>("@/lib/mermaid-renderer");

      // Mermaid's own output shape. Through an `<img>` this is an image with a ratio and no size,
      // which the sizing rules resolve by filling the container: measured on the packaged app, a
      // two-node `graph TD` was drawn at 294.34x460 — a 3.07x upscale stopped only by the 460px
      // height cap it had grown into rather than been fitted to.
      const sized = withIntrinsicSize(
        '<svg id="d" width="100%" viewBox="0 0 111.34 174" style="max-width: 111.34px;"><g/></svg>'
      );
      expect(sized).toContain('width="111.34"');
      expect(sized).toContain('height="174"');
      expect(sized).not.toContain('width="100%"');
      // Everything else is left exactly as Mermaid wrote it.
      expect(sized).toContain('viewBox="0 0 111.34 174"');
      expect(sized).toContain('style="max-width: 111.34px;"');
      expect(sized).toContain("<g/></svg>");
    });

    it("leaves an SVG it cannot measure alone", async () => {
      const { withIntrinsicSize } =
        await vi.importActual<typeof import("@/lib/mermaid-renderer")>("@/lib/mermaid-renderer");

      // Guessing a size would be worse than the container-filling behaviour it replaces.
      const noViewBox = '<svg width="100%"><g/></svg>';
      expect(withIntrinsicSize(noViewBox)).toBe(noViewBox);
      const degenerate = '<svg viewBox="0 0 0 174"></svg>';
      expect(withIntrinsicSize(degenerate)).toBe(degenerate);
      const unparseable = '<svg viewBox="nonsense"></svg>';
      expect(withIntrinsicSize(unparseable)).toBe(unparseable);
    });
  });
});
