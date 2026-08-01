import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  MarkdownContainerBlock,
  parseMarkdownContainer,
  type MarkdownContainerKind,
} from "@/editor/markdown-block/markdown-container-block";

/** The character the component puts on an empty last line so a caret can be seen on it. */
const ANCHOR = "\u200b";

/**
 * The rendered form is asserted through what a reader sees, and the edits through the exact bytes
 * the component hands back. Both halves matter: a component that emitted perfect Markdown while
 * showing the user `> [!NOTE]` would be the bug this replaces.
 */
function renderContainer(
  kind: MarkdownContainerKind,
  source: string,
  options: { editable?: boolean } = {}
) {
  const onChange = vi.fn();
  const onKeyDown = vi.fn();
  const view = render(
    <MarkdownContainerBlock
      blockId="block-1"
      kind={kind}
      source={source}
      editable={options.editable ?? true}
      onChange={onChange}
      onKeyDown={onKeyDown}
      renderInline={(markdown) => <>{markdown}</>}
    />
  );
  return { onChange, onKeyDown, ...view };
}

/**
 * The component with the Page behind it: every commit comes back as the next `source`.
 *
 * A gesture that takes two steps — press Enter, then type on the line it added — cannot be seen at
 * all without this, because the second step reads the state the first one wrote.
 */
function renderControlled(kind: MarkdownContainerKind, source: string) {
  const commits: string[] = [];
  function Harness() {
    const [current, setCurrent] = useState(source);
    return (
      <MarkdownContainerBlock
        blockId="block-1"
        kind={kind}
        source={current}
        editable
        onChange={(_, next) => {
          commits.push(next);
          setCurrent(next);
        }}
        renderInline={(markdown) => <>{markdown}</>}
      />
    );
  }
  return { commits, ...render(<Harness />) };
}

/** Put a collapsed caret at an offset in a surface's text, the way a click would. */
function placeCaret(editor: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.nodeValue?.length ?? 0;
    if (offset <= consumed + length) {
      const range = document.createRange();
      range.setStart(node, offset - consumed);
      range.collapse(true);
      const selection = window.getSelection();
      if (!selection) throw new Error("Selection API unavailable");
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    consumed += length;
  }
  throw new Error(`No text at offset ${offset}`);
}

/**
 * Type a whole new value into one of the component's editing surfaces.
 *
 * The surface is a contenteditable that reads its own DOM back, so the way to drive it is to put
 * the text in the DOM and tell it an input happened — which is what a keystroke does. The caret is
 * left where a person's would be, at the end of what they just typed, because the surface reads the
 * selection to decide where the change went. `caret` says otherwise for the one gesture where the
 * browser leaves it elsewhere: a deletion that empties the last line, after which Chrome's own
 * `<br>` is in the text but the caret is on the line above it.
 */
function typeInto(editor: HTMLElement, text: string, caret = text.length) {
  const host = editor.querySelector<HTMLElement>("[data-semantic-inline-content]") ?? editor;
  host.textContent = text;
  const node = host.firstChild ?? host;
  const selection = window.getSelection();
  if (!selection) throw new Error("Selection API unavailable");
  const range = document.createRange();
  range.setStart(node, node.nodeType === Node.TEXT_NODE ? caret : 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.input(editor, { inputType: "insertText" });
}

describe("MarkdownContainerBlock — callout", () => {
  it("keeps the callout rendered, and its Markdown hidden, while it is editable", () => {
    renderContainer("callout", "> [!WARNING] Careful\n> Mind the gap");

    const callout = screen.getByTestId("callout-block");
    expect(callout).toHaveAccessibleName("WARNING callout");
    expect(callout).toHaveTextContent("Careful");
    expect(callout).toHaveTextContent("Mind the gap");
    expect(callout.textContent).not.toContain("[!WARNING]");
    expect(callout.textContent).not.toContain(">");
    // Rule 4: an active Block owns exactly one editing surface.
    expect(callout.querySelectorAll("[data-native-block-editor]")).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "Callout body" })).toBeInTheDocument();
  });

  it("edits the body without touching the type marker, the title or the other prefixes", () => {
    const { onChange } = renderContainer(
      "callout",
      "> [!NOTE] Remember this\n> First line\n> Second line"
    );

    typeInto(
      screen.getByRole("textbox", { name: "Callout body" }),
      "First line\nSecond line edited"
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      "block-1",
      "> [!NOTE] Remember this\n> First line\n> Second line edited"
    );
  });

  it("leaves a CRLF callout in CRLF", () => {
    const { onChange } = renderContainer("callout", "> [!TIP]\r\n> One\r\n> Two");

    typeInto(screen.getByRole("textbox", { name: "Callout body" }), "One\nTwo three");

    expect(onChange).toHaveBeenCalledWith("block-1", "> [!TIP]\r\n> One\r\n> Two three");
  });

  it("keeps a blank body line's bare '>' when a line below it changes", () => {
    const { onChange } = renderContainer("callout", "> [!NOTE]\n> One\n>\n> Three");

    typeInto(screen.getByRole("textbox", { name: "Callout body" }), "One\n\nThree four");

    expect(onChange).toHaveBeenCalledWith("block-1", "> [!NOTE]\n> One\n>\n> Three four");
  });

  it("copies an untouched body line out rather than re-rendering it from its parts", () => {
    // `>Tight` and `>   Wide` both parse, and both would come back as `> …` if the line were
    // rebuilt from a prefix and its text. A Page would then gain a diff on two lines nobody edited.
    const { onChange } = renderContainer("callout", "> [!NOTE]\n>Tight\n>   Wide\n> Last");

    typeInto(screen.getByRole("textbox", { name: "Callout body" }), "Tight\n  Wide\nLast word");

    expect(onChange).toHaveBeenCalledWith("block-1", "> [!NOTE]\n>Tight\n>   Wide\n> Last word");
  });

  it("writes the first body line of a callout that has none, without growing on activation", () => {
    const { onChange } = renderContainer("callout", "> [!NOTE] Just a title");

    // No body means no body line: the callout is one line high whether or not it is active, and the
    // body is reached with Enter rather than by clicking a line that is not there.
    expect(screen.queryByRole("textbox", { name: "Callout body" })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Callout title" }), { key: "Enter" });
    typeInto(screen.getByRole("textbox", { name: "Callout body" }), "Now there is one");

    expect(onChange).toHaveBeenCalledWith("block-1", "> [!NOTE] Just a title\n> Now there is one");
  });

  it("edits the title in place and leaves the body alone", () => {
    const { onChange } = renderContainer("callout", "> [!NOTE] Old title\n> Body stays");

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Callout body" }), { key: "ArrowUp" });
    typeInto(screen.getByRole("textbox", { name: "Callout title" }), "New title");

    expect(onChange).toHaveBeenCalledWith("block-1", "> [!NOTE] New title\n> Body stays");
  });

  it("shows the derived type label instead of a title, and writes one after the marker", () => {
    const { onChange } = renderContainer("callout", "> [!TIP]\n> Body");

    expect(screen.getByTestId("callout-block")).toHaveTextContent("Tip");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Callout body" }), { key: "ArrowUp" });
    typeInto(screen.getByRole("textbox", { name: "Callout title" }), "Handy");

    expect(onChange).toHaveBeenCalledWith("block-1", "> [!TIP] Handy\n> Body");
  });

  it("hands the down arrow back when the callout has no body to move into", () => {
    // Catching it regardless left the Block with no way out downwards: an editor appeared over a
    // line the file does not have, and the key never reached the Block that would have moved the
    // caret to the paragraph below.
    const { onChange, onKeyDown } = renderContainer("callout", "> [!NOTE] Just a title");

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Callout title" }), { key: "ArrowDown" });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("textbox", { name: "Callout body" })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("takes the down arrow into a body that is on screen", () => {
    const { onKeyDown } = renderContainer("callout", "> [!NOTE] Title\n> Body");

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Callout body" }), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Callout title" }), { key: "ArrowDown" });

    expect(screen.getByRole("textbox", { name: "Callout body" })).toBeInTheDocument();
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it("moves the editing surface to the region a press landed in", () => {
    renderContainer("callout", "> [!NOTE] Title\n> Body");

    // The body is where an activated callout starts, so a press on the title has to move it.
    expect(screen.getByRole("textbox", { name: "Callout body" })).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByText("Title"), { clientX: 10, clientY: 10 });

    expect(screen.getByRole("textbox", { name: "Callout title" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Callout body" })).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-native-block-editor]")).toHaveLength(1);
  });

  it("renders read-only markup with no editing surface when it is not the active Block", () => {
    renderContainer("callout", "> [!NOTE] Title\n> Body", { editable: false });

    expect(screen.getByTestId("callout-block")).toHaveTextContent("Body");
    expect(document.querySelectorAll("[data-native-block-editor]")).toHaveLength(0);
  });
});

describe("MarkdownContainerBlock — toggle", () => {
  const TOGGLE = "<details open>\n<summary>Details</summary>\n\nBody line\n\n</details>";

  it("keeps the disclosure rendered, and its tags hidden, while it is editable", () => {
    renderContainer("toggle", TOGGLE);

    const toggle = screen.getByTestId("toggle-block");
    expect(toggle).toHaveTextContent("Details");
    expect(toggle).toHaveTextContent("Body line");
    expect(toggle.textContent).not.toContain("<details");
    expect(toggle.textContent).not.toContain("<summary>");
    expect(toggle.textContent).not.toContain("</details>");
    expect(toggle.querySelectorAll("[data-native-block-editor]")).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "Toggle summary" })).toBeInTheDocument();
  });

  it("edits the body between the summary and the closing tag", () => {
    const { onChange } = renderContainer("toggle", TOGGLE);

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Toggle summary" }), { key: "Enter" });
    typeInto(screen.getByRole("textbox", { name: "Toggle body" }), "Body line rewritten");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      "block-1",
      "<details open>\n<summary>Details</summary>\n\nBody line rewritten\n\n</details>"
    );
  });

  it("keeps the untouched lines of a several-line body byte-identical", () => {
    const source = "<details>\n<summary>Notes</summary>\n\nAlpha\n\nBeta\n\n</details>";
    const { onChange } = renderContainer("toggle", source);

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Toggle summary" }), { key: "Enter" });
    typeInto(screen.getByRole("textbox", { name: "Toggle body" }), "Alpha\n\nBeta gamma");

    expect(onChange).toHaveBeenCalledWith(
      "block-1",
      "<details>\n<summary>Notes</summary>\n\nAlpha\n\nBeta gamma\n\n</details>"
    );
  });

  it("leaves a CRLF toggle in CRLF", () => {
    const { onChange } = renderContainer(
      "toggle",
      "<details>\r\n<summary>Details</summary>\r\n\r\nBody\r\n\r\n</details>"
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Toggle summary" }), { key: "Enter" });
    typeInto(screen.getByRole("textbox", { name: "Toggle body" }), "Body edited");

    expect(onChange).toHaveBeenCalledWith(
      "block-1",
      "<details>\r\n<summary>Details</summary>\r\n\r\nBody edited\r\n\r\n</details>"
    );
  });

  it("gives a body written into an empty toggle the blank lines it needs", () => {
    const { onChange } = renderContainer(
      "toggle",
      "<details>\n<summary>Empty</summary>\n</details>"
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Toggle summary" }), { key: "Enter" });
    typeInto(screen.getByRole("textbox", { name: "Toggle body" }), "First words");

    expect(onChange).toHaveBeenCalledWith(
      "block-1",
      "<details>\n<summary>Empty</summary>\n\nFirst words\n\n</details>"
    );
  });

  it("hands the down arrow back rather than forcing a collapsed toggle open", () => {
    const { onChange, onKeyDown } = renderContainer(
      "toggle",
      "<details>\n<summary>Details</summary>\n\nBody\n\n</details>"
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Toggle summary" }), {
      key: "ArrowDown",
    });

    expect(screen.getByTestId("toggle-block")).not.toHaveAttribute("open");
    expect(screen.queryByRole("textbox", { name: "Toggle body" })).not.toBeInTheDocument();
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("opens a collapsed toggle on Enter and drops the caret into its body", () => {
    // Enter is a request to write in the Block, unlike the down arrow, so it is worth expanding
    // for. Opening it must not touch the file: `<details open>` is the initial value of a view
    // state, and reading a toggle cannot rewrite the user's Markdown.
    const { onChange } = renderContainer(
      "toggle",
      "<details>\n<summary>Details</summary>\n\nBody\n\n</details>"
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Toggle summary" }), { key: "Enter" });

    expect(screen.getByTestId("toggle-block")).toHaveAttribute("open");
    expect(screen.getByRole("textbox", { name: "Toggle body" })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("edits the summary without disturbing the body", () => {
    const { onChange } = renderContainer("toggle", TOGGLE);

    typeInto(screen.getByRole("textbox", { name: "Toggle summary" }), "Renamed");

    expect(onChange).toHaveBeenCalledWith(
      "block-1",
      "<details open>\n<summary>Renamed</summary>\n\nBody line\n\n</details>"
    );
  });
});

/**
 * Adding a line at the end of a body — the ordinary way anyone writes a second line.
 *
 * Chrome will not put a caret after a text node's trailing newline, so Enter at the end of a body
 * used to leave the caret on the line above with nothing on screen to say so: the line went into the
 * file, the box did not grow, and the next character was typed onto the first line.
 */
describe("MarkdownContainerBlock — Enter at the end of a body", () => {
  it("writes the callout's new line and types on it rather than on the one above", () => {
    const { commits } = renderControlled("callout", "> [!NOTE] T\n> aaa");

    placeCaret(screen.getByRole("textbox", { name: "Callout body" }), "aaa".length);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Callout body" }), { key: "Enter" });

    expect(commits.at(-1)).toBe("> [!NOTE] T\n> aaa\n>");
    const body = screen.getByRole("textbox", { name: "Callout body" });
    // The empty line has something on it, or the browser refuses to show a caret there at all.
    expect(body.textContent).toBe(`aaa\n${ANCHOR}`);

    typeInto(body, `aaa\nX${ANCHOR}`);

    expect(commits.at(-1)).toBe("> [!NOTE] T\n> aaa\n> X");
  });

  it("writes the toggle's new line and types on it rather than on the one above", () => {
    const { commits } = renderControlled(
      "toggle",
      "<details open>\n<summary>S</summary>\n\naaa\n\n</details>"
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Toggle summary" }), { key: "Enter" });
    placeCaret(screen.getByRole("textbox", { name: "Toggle body" }), "aaa".length);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Toggle body" }), { key: "Enter" });

    const body = screen.getByRole("textbox", { name: "Toggle body" });
    expect(body.textContent).toBe(`aaa\n${ANCHOR}`);

    typeInto(body, `aaa\nX${ANCHOR}`);

    expect(commits.at(-1)).toBe("<details open>\n<summary>S</summary>\n\naaa\nX\n\n</details>");
  });

  it("draws the empty last line while the Block is at rest too", () => {
    // Otherwise the callout grows a line the moment it is clicked, which is the grow-on-activation
    // this component exists to prevent — only upside down.
    const { container } = renderContainer("callout", "> [!NOTE] T\n> aaa\n>", { editable: false });

    const body = container.querySelector('[data-container-region="body"]');
    expect(body?.textContent).toBe(`aaa\n${ANCHOR}`);
    // Hidden from the walker that maps a press to an offset, the way the type label is: text it
    // counted would shift every caret in the region.
    expect(body?.querySelector('[aria-hidden="true"]')?.textContent).toBe(ANCHOR);
  });

  it("does not write the line Chrome adds when the last line is emptied", () => {
    // Taking the X off the last line leaves the surface's text ending in a newline the browser
    // cannot draw, so Chrome puts a `<br>` there — which the surface reads back as a second newline.
    // Measured in the packaged app: one Backspace added an empty line to the file instead of
    // removing a character. The caret is on the emptied line, above the `<br>`, which is what tells
    // that newline apart from one the user pasted.
    const { onChange } = renderContainer("callout", "> [!NOTE] T\n> aaa\n> X");

    typeInto(screen.getByRole("textbox", { name: "Callout body" }), "aaa\n\n", "aaa\n".length);

    expect(onChange).toHaveBeenCalledWith("block-1", "> [!NOTE] T\n> aaa\n>");
  });

  it("keeps a newline the user put at the end of the body themselves", () => {
    // A paste that ends in a newline leaves the caret after it, unlike the browser's own `<br>`, and
    // those bytes are the user's.
    const { onChange } = renderContainer("callout", "> [!NOTE] T\n> aaa");

    typeInto(screen.getByRole("textbox", { name: "Callout body" }), "aaa\np\n");

    expect(onChange).toHaveBeenCalledWith("block-1", "> [!NOTE] T\n> aaa\n> p\n>");
  });

  it("lands a press it cannot measure at the end of the region rather than at its start", () => {
    // A press on the empty last line lands on the anchor, which the walker that maps a point to an
    // offset rejects along with every other piece of decoration — so there is nothing to measure,
    // exactly as when a body is drawn as nested Blocks. Offset zero is the one answer that must not
    // come out of that: pressing the last line of a callout put the caret above the first character,
    // and a Backspace there merged the body into the title.
    renderContainer("callout", "> [!NOTE] Title\n> aaa");

    fireEvent.pointerDown(screen.getByText("Title"), { clientX: 10, clientY: 10 });

    expect(screen.getByRole("textbox", { name: "Callout title" })).toBeInTheDocument();
    expect(window.getSelection()?.focusOffset).toBe("Title".length);
  });

  it("never lets the anchor reach the file, and leaves a zero-width space of the user's alone", () => {
    // Deleting the anchor is an ordinary Delete at the end of the body. The last zero-width space in
    // what comes back is then the user's own, and taking it off would rewrite a byte they did not
    // touch.
    const { commits } = renderControlled("callout", `> [!NOTE] T\n> a${ANCHOR}b\n>`);

    typeInto(screen.getByRole("textbox", { name: "Callout body" }), `a${ANCHOR}b`);

    expect(commits.at(-1)).toBe(`> [!NOTE] T\n> a${ANCHOR}b`);
  });
});

describe("MarkdownContainerBlock — leaving and collapsing a container", () => {
  it("unwraps a toggle into the paragraphs it was written as", () => {
    // The blank lines between body paragraphs are the user's — they are what makes two paragraphs
    // two Blocks. Dropping them turned a summary and two paragraphs into one run-on paragraph.
    const { onChange } = renderContainer(
      "toggle",
      "<details open>\n<summary>Summary text</summary>\n\nBody paragraph one.\n\nBody paragraph two.\n\n</details>"
    );

    const summary = screen.getByRole("textbox", { name: "Toggle summary" });
    placeCaret(summary, 0);
    fireEvent.keyDown(summary, { key: "Backspace" });

    expect(onChange).toHaveBeenCalledWith(
      "block-1",
      "Summary text\n\nBody paragraph one.\n\nBody paragraph two.",
      { surfaceChanges: true, caret: 0 }
    );
  });

  it("does not fold a title-less callout's body onto its marker line", () => {
    // `> [!NOTE]\n> body` merged upward becomes `> [!NOTE] body`, which this app still draws as a
    // callout and GitHub does not draw as an alert at all: the press would change how the file
    // renders everywhere else. The caret goes to the title instead, and a second Backspace there
    // takes the container off.
    const { onChange } = renderContainer("callout", "> [!NOTE]\n> callout body");

    const body = screen.getByRole("textbox", { name: "Callout body" });
    placeCaret(body, 0);
    fireEvent.keyDown(body, { key: "Backspace" });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Callout title" })).toBeInTheDocument();
  });

  it("still merges the first body line into a callout title the file does have", () => {
    const { onChange } = renderContainer("callout", "> [!NOTE] Title\n> callout body");

    const body = screen.getByRole("textbox", { name: "Callout body" });
    placeCaret(body, 0);
    fireEvent.keyDown(body, { key: "Backspace" });

    expect(onChange).toHaveBeenCalledWith("block-1", "> [!NOTE] Titlecallout body");
  });

  it("puts the caret at the end of the summary when the toggle is collapsed under it", () => {
    const { onChange } = renderContainer(
      "toggle",
      "<details open>\n<summary>Sum</summary>\n\nbody one\n\n</details>"
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Toggle summary" }), {
      key: "ArrowDown",
    });
    expect(screen.getByRole("textbox", { name: "Toggle body" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse toggle" }));

    const summary = screen.getByRole("textbox", { name: "Toggle summary" });
    expect(summary).toBeInTheDocument();
    expect(window.getSelection()?.focusOffset).toBe("Sum".length);
    // Collapsing is view state: `<details open>` in the file is the initial value, not a fact to
    // rewrite.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps Tab inside the container instead of losing the caret to the page", () => {
    const { onKeyDown } = renderContainer("callout", "> [!NOTE] Title\n> Body");

    const body = screen.getByRole("textbox", { name: "Callout body" });
    const event = createEvent.keyDown(body, { key: "Tab" });
    fireEvent(body, event);

    expect(event.defaultPrevented).toBe(true);
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it("offers the callout's type menu on the first press, before the Block is active", () => {
    // The icon is documented as the control, so a press on it that does nothing at all is the one
    // answer it must not give.
    renderContainer("callout", "> [!NOTE] Title\n> Body", { editable: false });

    expect(screen.getByRole("button", { name: "Note callout, change type" })).toBeEnabled();
  });
});

/**
 * The round trip on its own, without a DOM in the way.
 *
 * Every one of these is a source the component has to be able to hand straight back. If any of them
 * does not round-trip, an unrelated keystroke somewhere else in the Block silently rewrites it.
 */
describe("parseMarkdownContainer round trips", () => {
  const cases: ReadonlyArray<[MarkdownContainerKind, string]> = [
    ["callout", "> [!NOTE]\n> Body"],
    ["callout", "> [!NOTE] Title\n> Body"],
    ["callout", "> [!WARNING]"],
    ["callout", "> [!NOTE] Title\n> One\n>\n> Three"],
    ["callout", "> [!NOTE]\r\n> One\r\n> Two"],
    ["callout", "  > [!TIP] Indented\n  > Body"],
    ["callout", "> [!NOTE]\n>Tight\n>   Wide"],
    ["callout", "> [!CAUTION]- Collapsed\n> Body"],
    ["toggle", "<details>\n<summary>S</summary>\n\nBody\n\n</details>"],
    ["toggle", "<details open>\n<summary>S</summary>\n\nA\n\nB\n\n</details>"],
    ["toggle", "<details>\n<summary>S</summary>\n</details>"],
    ["toggle", "<details>\n<summary>S</summary>\nNo blanks\n</details>"],
    ["toggle", "<details>\r\n<summary>S</summary>\r\n\r\nBody\r\n\r\n</details>"],
  ];

  it.each(cases)("%s: rewriting a container with its own parts is a no-op", (kind, source) => {
    const container = parseMarkdownContainer(kind, source);
    if (!container) throw new Error(`Expected ${kind} to parse`);
    expect(container.withBody(container.body)).toBe(source);
    expect(container.withHeading(container.heading)).toBe(source);
  });

  it("drops a callout's body without leaving a stray prefix behind", () => {
    const container = parseMarkdownContainer("callout", "> [!NOTE] Title\n> One\n> Two");
    expect(container?.withBody("")).toBe("> [!NOTE] Title");
  });

  it("drops a callout's title without leaving the space that followed the marker", () => {
    const container = parseMarkdownContainer("callout", "> [!NOTE] Title\n> Body");
    expect(container?.withHeading("")).toBe("> [!NOTE]\n> Body");
  });

  it("keeps one blank scaffolding line when a toggle's body is emptied", () => {
    const container = parseMarkdownContainer(
      "toggle",
      "<details>\n<summary>S</summary>\n\nBody\n\n</details>"
    );
    expect(container?.withBody("")).toBe("<details>\n<summary>S</summary>\n\n</details>");
  });

  it("flattens a newline pasted into a heading rather than cutting the Block in half", () => {
    const container = parseMarkdownContainer(
      "toggle",
      "<details>\n<summary>S</summary>\n\nBody\n\n</details>"
    );
    expect(container?.withHeading("One\nTwo")).toBe(
      "<details>\n<summary>One Two</summary>\n\nBody\n\n</details>"
    );
  });

  it("keeps a callout's fold marker when its type is changed", () => {
    // `[!NOTE]-` is what makes a callout start collapsed in Obsidian. doXmind does not honour it, so
    // dropping it changes nothing on screen and everything in the file the user opens elsewhere.
    const collapsed = parseMarkdownContainer("callout", "> [!NOTE]- Hidden details\n> body");
    expect(collapsed?.withType?.("tip")).toBe("> [!TIP]- Hidden details\n> body");

    const expanded = parseMarkdownContainer("callout", "> [!NOTE]+ Shown\n> body");
    expect(expanded?.withType?.("warning")).toBe("> [!WARNING]+ Shown\n> body");

    // A callout without one still changes type without gaining a marker it never had.
    const plain = parseMarkdownContainer("callout", "> [!TIP] Title\n> body");
    expect(plain?.withType?.("note")).toBe("> [!NOTE] Title\n> body");
  });

  it("changes a type without touching the header's own spacing", () => {
    // The marker's tab, and the space left behind by a title the file never had, are both bytes the
    // user's file already holds. `withHeading` drops the gap when the *user* deletes the title, which
    // is their edit; changing the type is not, so nothing here is tidied. Pinned because the obvious
    // reading of `> [!TIP] ` is that the editor left a space behind, and it did not — it kept one.
    const spaced = parseMarkdownContainer("callout", "> [!NOTE] \n> body");
    expect(spaced?.heading).toBe("");
    expect(spaced?.withType?.("tip")).toBe("> [!TIP] \n> body");

    const tabbed = parseMarkdownContainer("callout", "> [!NOTE]\tTitle");
    expect(tabbed?.withType?.("caution")).toBe("> [!CAUTION]\tTitle");

    const bare = parseMarkdownContainer("callout", "> [!NOTE]\n> body");
    expect(bare?.withType?.("tip")).toBe("> [!TIP]\n> body");
  });

  it("refuses a source that is not a container, so the caller can keep its fallback", () => {
    expect(parseMarkdownContainer("callout", "> Just a quote")).toBeNull();
    expect(parseMarkdownContainer("toggle", "<details>not a toggle</details>")).toBeNull();
    expect(parseMarkdownContainer("toggle", "<div>\n<summary>No</summary>\n</div>")).toBeNull();
  });
});
