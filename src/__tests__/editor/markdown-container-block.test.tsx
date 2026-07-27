import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  MarkdownContainerBlock,
  parseMarkdownContainer,
  type MarkdownContainerKind,
} from "@/editor/markdown-block/markdown-container-block";

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
 * Type a whole new value into one of the component's editing surfaces.
 *
 * The surface is a contenteditable that reads its own DOM back, so the way to drive it is to put
 * the text in the DOM and tell it an input happened — which is what a keystroke does. The caret is
 * left where a person's would be, at the end of what they just typed, because the surface reads the
 * selection to decide where the change went.
 */
function typeInto(editor: HTMLElement, text: string) {
  const host = editor.querySelector<HTMLElement>("[data-semantic-inline-content]") ?? editor;
  host.textContent = text;
  const node = host.firstChild ?? host;
  const selection = window.getSelection();
  if (!selection) throw new Error("Selection API unavailable");
  const range = document.createRange();
  range.setStart(node, node.nodeType === Node.TEXT_NODE ? text.length : 0);
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

  it("refuses a source that is not a container, so the caller can keep its fallback", () => {
    expect(parseMarkdownContainer("callout", "> Just a quote")).toBeNull();
    expect(parseMarkdownContainer("toggle", "<details>not a toggle</details>")).toBeNull();
    expect(parseMarkdownContainer("toggle", "<div>\n<summary>No</summary>\n</div>")).toBeNull();
  });
});
