import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { highlightCodeTokens } from "@/editor/markdown-block/code-highlight";
import { MarkdownCodeBlock } from "@/editor/markdown-block/markdown-code-block";

/**
 * A parent that owns the source, the way the row does.
 *
 * The textarea is controlled, so a test that never fed an edit back would only ever prove the first
 * keystroke. Holding the source here means each assertion is made against the Markdown the component
 * would actually have written to the file.
 */
function Harness({
  initial,
  editable = true,
  onChange,
  onKeyDown,
  onSetLanguage,
}: {
  initial: string;
  editable?: boolean;
  onChange?: (blockId: string, next: string) => void;
  onKeyDown?: (event: unknown) => void;
  onSetLanguage?: (blockId: string, language: string) => void;
}) {
  const [source, setSource] = useState(initial);
  return (
    <MarkdownCodeBlock
      blockId="block-1"
      source={source}
      editable={editable}
      renderInline={(markdown) => markdown}
      onChange={(blockId, next) => {
        onChange?.(blockId, next);
        setSource(next);
      }}
      onKeyDown={onKeyDown}
      onSetLanguage={onSetLanguage}
    />
  );
}

/**
 * Let the lazily-loaded grammar land while the component is still mounted.
 *
 * Highlighting arrives from a dynamic import, so without this the token state settles after the test
 * has finished and React reports an update outside `act`. Flushing it here also means every
 * assertion is made against the highlighted Block rather than the plain-text one it starts as.
 */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

function editingSurface(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Markdown block" }) as HTMLTextAreaElement;
}

function selectRange(textarea: HTMLTextAreaElement, start: number, end: number) {
  textarea.focus();
  textarea.setSelectionRange(start, end);
}

describe("MarkdownCodeBlock", () => {
  beforeAll(async () => {
    // Warm the grammar cache once so each render's highlight resolves in microtasks that `settle`
    // can flush deterministically.
    await highlightCodeTokens("const a = 1;", "ts");
  });

  it("shows the code and never the fence, in both states", async () => {
    const { rerender } = render(<Harness initial={"```ts\nconst a = 1;\n```"} editable={false} />);

    const pre = screen.getByTestId("fenced-code-block");
    expect(pre).toHaveTextContent("const a = 1;");
    expect(pre.textContent).not.toContain("```");
    // Inactive, there is no editing surface in the accessibility tree at all.
    expect(screen.queryByRole("textbox", { name: "Markdown block" })).toBeNull();

    rerender(<Harness initial={"```ts\nconst a = 1;\n```"} editable />);
    // The very same element, not an identical one rendered again: everything that used to break on
    // activation came from tearing the rendered form down.
    expect(screen.getByTestId("fenced-code-block")).toBe(pre);
    expect(pre).toHaveTextContent("const a = 1;");
    expect(pre.textContent).not.toContain("```");
    expect(editingSurface()).toBeInTheDocument();
    // Out of flow, so nothing the editing surface adds can change the Block's height.
    expect(editingSurface().className).toContain("absolute inset-0");
    await settle();
  });

  it("keeps the highlighted code rendered while the Block is being edited", async () => {
    const { container } = render(<Harness initial={"```ts\nconst a = 1;\n```"} editable />);

    await waitFor(() => {
      expect(container.querySelector(".hljs-keyword")).not.toBeNull();
    });
    // The colours are inside the rendered `<pre>`, which is still there with the caret in the Block.
    const keyword = container.querySelector(".hljs-keyword");
    expect(keyword).toHaveTextContent("const");
    expect(screen.getByTestId("fenced-code-block").contains(keyword)).toBe(true);
    expect(editingSurface()).toHaveValue("const a = 1;");
    await settle();
  });

  it("writes an edited payload back between the delimiters the file already had", async () => {
    const onChange = vi.fn();
    render(<Harness initial={"```ts\nconst a = 1;\n```"} editable onChange={onChange} />);

    fireEvent.change(editingSurface(), { target: { value: "const a = 2;" } });

    expect(onChange).toHaveBeenCalledWith("block-1", "```ts\nconst a = 2;\n```");
    await settle();
  });

  it("edits a multi-line payload without disturbing either fence", async () => {
    const onChange = vi.fn();
    render(<Harness initial={"~~~py\nx = 1\ny = 2\n~~~"} editable onChange={onChange} />);

    fireEvent.change(editingSurface(), { target: { value: "x = 1\ny = 2\nz = 3" } });

    expect(onChange).toHaveBeenCalledWith("block-1", "~~~py\nx = 1\ny = 2\nz = 3\n~~~");
    await settle();
  });

  it("keeps an unterminated fence unterminated", async () => {
    const onChange = vi.fn();
    render(<Harness initial={"```ts\nconst a = 1;"} editable onChange={onChange} />);

    fireEvent.change(editingSurface(), { target: { value: "const a = 1;\n" } });

    // Round-tripping must not invent a closing delimiter the file never had.
    expect(onChange).toHaveBeenCalledWith("block-1", "```ts\nconst a = 1;\n");
    await settle();
  });

  it("refuses an edit whose payload would close the Block's own fence", async () => {
    const onChange = vi.fn();
    render(<Harness initial={"```js\ncode\n```"} editable onChange={onChange} />);

    // Typing the third backtick of a ``` line, or pasting a snippet that contains one. The payload
    // can no longer be spliced between the delimiters the file has: the row re-projects whatever
    // this hands back, and a source that no longer splits the same way comes back wrapped in its
    // delimiters a second time — the opening fence is duplicated into the file.
    fireEvent.change(editingSurface(), { target: { value: "code\n```" } });

    expect(onChange).not.toHaveBeenCalled();
    await settle();
  });

  it("takes a fence line that does not close the delimiter this Block opened with", async () => {
    const onChange = vi.fn();
    render(<Harness initial={"~~~md\ndocs\n~~~"} editable onChange={onChange} />);

    fireEvent.change(editingSurface(), { target: { value: "docs\n```" } });

    expect(onChange).toHaveBeenCalledWith("block-1", "~~~md\ndocs\n```\n~~~");
    await settle();
  });

  it("inserts an indent on Tab instead of moving focus", async () => {
    const onChange = vi.fn();
    const onKeyDown = vi.fn();
    render(
      <Harness
        initial={"```ts\nconst a = 1;\n```"}
        editable
        onChange={onChange}
        onKeyDown={onKeyDown}
      />
    );

    const textarea = editingSurface();
    selectRange(textarea, 0, 0);
    fireEvent.keyDown(textarea, { key: "Tab" });

    expect(onChange).toHaveBeenCalledWith("block-1", "```ts\n  const a = 1;\n```");
    expect(onKeyDown).not.toHaveBeenCalled();
    await settle();
  });

  it("indents every line a selection touches, and Shift+Tab takes it back", async () => {
    const onChange = vi.fn();
    render(<Harness initial={"```ts\na\nb\n```"} editable onChange={onChange} />);

    const textarea = editingSurface();
    selectRange(textarea, 0, 3);
    fireEvent.keyDown(textarea, { key: "Tab" });
    expect(onChange).toHaveBeenLastCalledWith("block-1", "```ts\n  a\n  b\n```");

    const indented = editingSurface();
    selectRange(indented, 0, 7);
    fireEvent.keyDown(indented, { key: "Tab", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith("block-1", "```ts\na\nb\n```");
    await settle();
  });

  it("takes Enter as a newline and never hands it back to the Block", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onKeyDown = vi.fn();
    render(
      <Harness
        initial={"```ts\nconst a = 1;\n```"}
        editable
        onChange={onChange}
        onKeyDown={onKeyDown}
      />
    );

    const textarea = editingSurface();
    selectRange(textarea, 12, 12);
    await user.keyboard("{Enter}");

    expect(onKeyDown).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith("block-1", "```ts\nconst a = 1;\n\n```");
    await settle();
  });

  it("hands the Block back the keys it owns", async () => {
    const onKeyDown = vi.fn();
    render(<Harness initial={"```ts\nconst a = 1;\n```"} editable onKeyDown={onKeyDown} />);

    const textarea = editingSurface();
    selectRange(textarea, 4, 4);
    fireEvent.keyDown(textarea, { key: "Escape" });
    fireEvent.keyDown(textarea, { key: "z", metaKey: true });
    fireEvent.keyDown(textarea, { key: "ArrowUp", altKey: true });

    expect(onKeyDown.mock.calls.map(([event]) => event.key)).toEqual(["Escape", "z", "ArrowUp"]);
    await settle();
  });

  it("only lets an arrow leave the Block from the payload's own edge", async () => {
    const onKeyDown = vi.fn();
    render(<Harness initial={"```ts\na\nb\n```"} editable onKeyDown={onKeyDown} />);

    const textarea = editingSurface();
    // Second line: Up moves within the payload, so the Block must not see it.
    selectRange(textarea, 2, 2);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(onKeyDown).not.toHaveBeenCalled();

    // First line: there is nowhere above to go inside the Block.
    selectRange(textarea, 0, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    await settle();
  });

  it("only hands Backspace back when the caret is at the start of the payload", async () => {
    const onKeyDown = vi.fn();
    render(<Harness initial={"```ts\nconst a = 1;\n```"} editable onKeyDown={onKeyDown} />);

    const textarea = editingSurface();
    selectRange(textarea, 5, 5);
    fireEvent.keyDown(textarea, { key: "Backspace" });
    expect(onKeyDown).not.toHaveBeenCalled();

    selectRange(textarea, 0, 0);
    fireEvent.keyDown(textarea, { key: "Backspace" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    await settle();
  });

  it("rewrites only the info string when the language chip is committed", async () => {
    const user = userEvent.setup();
    const onSetLanguage = vi.fn();
    render(
      <Harness
        initial={"```ts\nconst a = 1;\n```"}
        editable={false}
        onSetLanguage={onSetLanguage}
      />
    );

    await user.click(screen.getByRole("button", { name: "Code language: ts" }));
    const field = screen.getByRole("textbox", { name: "Code language" });
    await user.clear(field);
    await user.type(field, "python{Enter}");

    expect(onSetLanguage).toHaveBeenCalledWith("block-1", "python");
    await settle();
  });

  it("puts the caret where the code was pressed", async () => {
    const { rerender } = render(<Harness initial={"```ts\nconst a = 1;\n```"} editable={false} />);

    const code = screen.getByTestId("fenced-code-block").querySelector("code");
    expect(code).not.toBeNull();
    const text = code!.firstChild as Text;
    // jsdom has no layout, so the hit-test the browser performs is stubbed with the answer a press
    // in the middle of the line would give.
    const caretPositionFromPoint = vi.fn(() => ({ offsetNode: text, offset: 6 }));
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: caretPositionFromPoint,
    });

    fireEvent.pointerDown(code!, { clientX: 40, clientY: 20 });
    rerender(<Harness initial={"```ts\nconst a = 1;\n```"} editable />);

    await waitFor(() => {
      expect(editingSurface().selectionStart).toBe(6);
    });
    expect(editingSurface().selectionEnd).toBe(6);
    Reflect.deleteProperty(document, "caretPositionFromPoint");
    await settle();
  });

  it("lands at the end of the payload when the Block is activated without a press", async () => {
    const { rerender } = render(<Harness initial={"```ts\nconst a = 1;\n```"} editable={false} />);
    rerender(<Harness initial={"```ts\nconst a = 1;\n```"} editable />);

    await waitFor(() => {
      expect(editingSurface().selectionStart).toBe("const a = 1;".length);
    });
    await settle();
  });

  it("keeps every metric that positions a glyph identical on both layers", async () => {
    render(<Harness initial={"```ts\nconst a = 1;\n```"} editable />);

    const pre = screen.getByTestId("fenced-code-block");
    const textarea = editingSurface();
    // The caret is drawn by the textarea and the glyphs by the `<pre>`. They drift apart the moment
    // any of these disagree, and the drift accumulates down the Block, so this list is the contract.
    for (const property of [
      "font-size",
      "line-height",
      "letter-spacing",
      "padding",
      "tab-size",
      "white-space",
      "overflow-wrap",
      "word-break",
    ]) {
      // Asserted non-empty first. Two layers that both declare nothing are also "equal", so a
      // property quietly dropped from the shared metrics would otherwise still pass this loop
      // while the caret drifted in the browser.
      expect(`${property}: ${pre.style.getPropertyValue(property)}`).not.toBe(`${property}: `);
      expect(`${property}: ${textarea.style.getPropertyValue(property)}`).toBe(
        `${property}: ${pre.style.getPropertyValue(property)}`
      );
    }
    // The typed text must be invisible; only the caret shows through.
    expect(textarea.style.color).toBe("transparent");
    expect(textarea.style.background).toBe("transparent");
    expect(textarea.style.caretColor).not.toBe("");
    await settle();
  });

  it("puts a CRLF Block's own line endings back when it commits", async () => {
    const onChange = vi.fn();
    render(<Harness initial={"```ts\r\nx = 1\r\ny = 2\r\n```"} editable onChange={onChange} />);

    // The field holds the normalised text, because a textarea's value is normalised by the DOM and
    // every offset this component measures has to agree with the offsets the field reports.
    expect(editingSurface()).toHaveValue("x = 1\ny = 2");

    fireEvent.change(editingSurface(), { target: { value: "x = 1\ny = 2\nz = 3" } });

    // Every line ending in the file is still a CRLF, including the one the new line brought with
    // it. Committing what the field literally returned would have rewritten all three.
    expect(onChange).toHaveBeenCalledWith("block-1", "```ts\r\nx = 1\r\ny = 2\r\nz = 3\r\n```");
    await settle();
  });

  it("measures a CRLF Block's edges in the offsets the field reports", async () => {
    const onKeyDown = vi.fn();
    render(<Harness initial={"```ts\r\nx = 1\r\ny = 2\r\n```"} editable onKeyDown={onKeyDown} />);

    const textarea = editingSurface();
    // The start of the second line, counted the way the field counts it. Measured against the raw
    // CRLF bytes instead, everything before this offset is "x = 1\r" — no newline in it — so the
    // Block would read a caret in the middle of its own code as sitting on the first line and Up
    // would walk out of it.
    selectRange(textarea, 6, 6);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });

    expect(onKeyDown).not.toHaveBeenCalled();
    await settle();
  });

  it("preserves an indented fence and everything else on its info line", async () => {
    const onChange = vi.fn();
    render(<Harness initial={"  ```ts title=example\nx\n  ```"} editable onChange={onChange} />);

    expect(editingSurface()).toHaveValue("x");
    fireEvent.change(editingSurface(), { target: { value: "x\ny" } });

    // The indentation, the `title=example` the editor knows nothing about, and the indented closing
    // line are all bytes the user did not touch, so all three come back verbatim.
    expect(onChange).toHaveBeenCalledWith("block-1", "  ```ts title=example\nx\ny\n  ```");
    await settle();
  });

  it("writes nothing to the file until a composition settles", async () => {
    const onChange = vi.fn();
    render(<Harness initial={"```ts\nconst a = 1;\n```"} editable onChange={onChange} />);

    const textarea = editingSurface();
    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: "const a = 1;// 注" } });

    // Mid-composition text sent through the parent and back would replace the field's value under
    // the IME and drop the candidate, so nothing is committed yet — but the rendered code still
    // shows what is being typed.
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("fenced-code-block")).toHaveTextContent("const a = 1;// 注");

    fireEvent.compositionEnd(textarea);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("block-1", "```ts\nconst a = 1;// 注\n```");
    await settle();
  });

  it("gives the code no padding of its own, so both layers start at the same column", async () => {
    render(<Harness initial={"```ts\nconst a = 1;\n```"} editable />);

    const code = screen.getByTestId("fenced-code-block").querySelector("code");
    // `.markdown-page code` styles every `code` in a Page as an inline-code chip. Left on the
    // `<code>` inside a fence, its horizontal padding starts the first line 4px right of the
    // textarea's first line and the caret sits beside the glyph it is on.
    expect(code!.style.getPropertyValue("padding")).toMatch(/^0(px)?$/);
    await settle();
  });

  it("keeps one language chip, out of flow, in both states", async () => {
    const onSetLanguage = vi.fn();
    const { rerender } = render(
      <Harness
        initial={"```ts\nconst a = 1;\n```"}
        editable={false}
        onSetLanguage={onSetLanguage}
      />
    );

    const chip = screen.getByRole("button", { name: "Code language: ts" });
    expect(chip.className).toContain("absolute");

    rerender(
      <Harness initial={"```ts\nconst a = 1;\n```"} editable onSetLanguage={onSetLanguage} />
    );
    // The same element, never remounted: a control that appears on activation is how every earlier
    // version of a code Block grew on focus.
    expect(screen.getByRole("button", { name: "Code language: ts" })).toBe(chip);
    await settle();
  });

  it("carries exactly one editor element, and only while it is editable", async () => {
    const { container, rerender } = render(
      <Harness initial={"```ts\nconst a = 1;\n```"} editable={false} />
    );
    expect(container.querySelectorAll("[data-native-block-editor]")).toHaveLength(0);

    rerender(<Harness initial={"```ts\nconst a = 1;\n```"} editable />);
    const editors = container.querySelectorAll("[data-native-block-editor]");
    expect(editors).toHaveLength(1);
    expect(document.activeElement).toBe(editors[0]);
    await settle();
  });
});
