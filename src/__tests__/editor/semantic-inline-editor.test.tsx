import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  SemanticInlineEditor,
  type SemanticInlineSelection,
} from "@/editor/markdown-block/semantic-inline-editor";

describe("SemanticInlineEditor", () => {
  it("renders inline Markdown semantically without showing delimiters", () => {
    const { container } = render(
      <SemanticInlineEditor
        source={
          "**Bold** *italic* ~~gone~~ `code` [link](https://example.test) [[Page|wiki]] ![Map](map.png)"
        }
        onSourceChange={vi.fn()}
      />
    );

    const editor = screen.getByRole("textbox", { name: "Markdown block" });
    expect(editor).toHaveTextContent("Bold italic gone code link wiki \uFFFC");
    expect(editor).not.toHaveTextContent("**");
    expect(screen.getByText("Bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");
    expect(screen.getByText("gone").tagName).toBe("DEL");
    expect(screen.getByText("code").tagName).toBe("CODE");
    expect(screen.getByRole("link", { name: "link" })).toHaveAttribute(
      "href",
      "https://example.test"
    );
    expect(container.querySelector("[data-markdown-inline-wiki='Page']")).toHaveTextContent("wiki");
    expect(screen.getByRole("img", { name: "Map" })).toHaveAttribute("contenteditable", "false");
  });

  it("edits inside bold text while preserving its canonical delimiters", () => {
    const onSourceChange = vi.fn();
    render(<SemanticInlineEditor source="Keep **bold** text" onSourceChange={onSourceChange} />);
    const editor = screen.getByRole("textbox", {
      name: "Markdown block",
    });
    const strong = screen.getByText("bold");
    const text = strong.firstChild;
    expect(text).toBeInstanceOf(Text);
    if (!text) throw new Error("Expected bold text");

    text.nodeValue = "bolder";
    setDomSelection(text, 6);
    fireEvent.input(editor, { inputType: "insertText", data: "er" });

    expect(onSourceChange).toHaveBeenCalledWith(
      "Keep **bolder** text",
      expect.objectContaining({
        anchor: "Keep **bolder".length,
        head: "Keep **bolder".length,
      })
    );
  });

  it("restores the source selection after a controlled semantic rerender", () => {
    function ControlledEditor() {
      const [value, setValue] = useState({
        source: "Keep **bold** text",
        selection: {
          anchor: "Keep **bold".length,
          head: "Keep **bold".length,
        },
      });
      return (
        <SemanticInlineEditor
          source={value.source}
          selection={value.selection}
          autoFocus
          onSourceChange={(source, selection) => setValue({ source, selection })}
        />
      );
    }

    render(<ControlledEditor />);
    const editor = screen.getByRole("textbox", {
      name: "Markdown block",
    });
    const text = screen.getByText("bold").firstChild;
    if (!text) throw new Error("Expected bold text");
    text.nodeValue = "bolder";
    setDomSelection(text, 6);

    fireEvent.input(editor, { inputType: "insertText", data: "er" });

    const updatedText = screen.getByText("bolder").firstChild;
    expect(window.getSelection()?.anchorNode).toBe(updatedText);
    expect(window.getSelection()?.anchorOffset).toBe(6);
  });

  it("restores a source-offset selection and reports it back unchanged", () => {
    const onSelectionChange = vi.fn();
    const selectedSource: SemanticInlineSelection = {
      anchor: "A **b".length,
      head: "A **bol".length,
    };
    render(
      <SemanticInlineEditor
        source="A **bold** Z"
        autoFocus
        selection={selectedSource}
        onSourceChange={vi.fn()}
        onSelectionChange={onSelectionChange}
      />
    );

    expect(window.getSelection()?.toString()).toBe("ol");

    document.dispatchEvent(new Event("selectionchange"));
    expect(onSelectionChange).toHaveBeenLastCalledWith(selectedSource, expect.any(Event));
  });

  it("highlights an explicit selection without stealing focus from an external control", () => {
    const onSourceChange = vi.fn();
    const { rerender } = render(
      <>
        <input aria-label="Search text" />
        <SemanticInlineEditor source="A **bold** Z" onSourceChange={onSourceChange} />
      </>
    );
    const search = screen.getByRole("textbox", { name: "Search text" });
    search.focus();

    rerender(
      <>
        <input aria-label="Search text" />
        <SemanticInlineEditor
          source="A **bold** Z"
          selection={{ anchor: "A **b".length, head: "A **bol".length }}
          highlightSelection
          onSourceChange={onSourceChange}
        />
      </>
    );

    expect(search).toHaveFocus();
    expect(document.querySelector("[data-native-search-selection]")).toHaveTextContent("ol");
    expect(search).toHaveFocus();
  });

  it("highlights an atomic image when a source-only target match is active", () => {
    const source = "Before ![Map](assets/campus.png) after";
    const from = source.indexOf("campus");
    render(
      <SemanticInlineEditor
        source={source}
        selection={{ anchor: from, head: from + "campus".length }}
        highlightSelection
        onSourceChange={vi.fn()}
      />
    );

    expect(document.querySelector("[data-markdown-inline-image]")).toHaveAttribute(
      "data-native-search-selection"
    );
  });

  it("defers source commits during IME composition and emits lifecycle callbacks", () => {
    const onSourceChange = vi.fn();
    const onCompositionStart = vi.fn();
    const onCompositionEnd = vi.fn();
    render(
      <SemanticInlineEditor
        source="Hi"
        onSourceChange={onSourceChange}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
      />
    );
    const editor = screen.getByRole("textbox", {
      name: "Markdown block",
    });
    const text = editor.querySelector("[data-markdown-inline-segment]")?.firstChild;
    expect(text).toBeInstanceOf(Text);
    if (!text) throw new Error("Expected editor text");

    fireEvent.compositionStart(editor, { data: "" });
    text.nodeValue = "你好";
    setDomSelection(text, 2);
    fireEvent.input(editor, { inputType: "insertCompositionText", data: "你好" });
    expect(onSourceChange).not.toHaveBeenCalled();

    fireEvent.compositionEnd(editor, { data: "你好" });
    expect(onCompositionStart).toHaveBeenCalledOnce();
    expect(onCompositionEnd).toHaveBeenCalledOnce();
    expect(onSourceChange).toHaveBeenCalledWith("你好", {
      anchor: 2,
      head: 2,
    });
  });

  it("pastes plain text through the source patch instead of inserting HTML", () => {
    const onSourceChange = vi.fn();
    render(
      <SemanticInlineEditor
        source="A **bold** Z"
        autoFocus
        selection={{ anchor: "A **bo".length, head: "A **bo".length }}
        onSourceChange={onSourceChange}
      />
    );
    const editor = screen.getByRole("textbox", {
      name: "Markdown block",
    });

    fireEvent.paste(editor, {
      clipboardData: {
        files: [],
        getData: (type: string) => (type === "text/plain" ? "<b>X</b>" : "<b>ignored</b>"),
      },
    });

    expect(onSourceChange).toHaveBeenCalledWith("A **bo<b>X</b>ld** Z", expect.any(Object));
    expect(editor.querySelector("b")).not.toBeInTheDocument();
  });

  it("fails closed when a direct DOM edit would delete an atomic image", () => {
    const onSourceChange = vi.fn();
    render(
      <SemanticInlineEditor source="Before ![Map](map.png) after" onSourceChange={onSourceChange} />
    );
    const editor = screen.getByRole("textbox", {
      name: "Markdown block",
    });
    editor.querySelector("[data-markdown-inline-image]")?.remove();

    fireEvent.input(editor, { inputType: "deleteContentBackward" });

    expect(onSourceChange).not.toHaveBeenCalled();
    expect(screen.getByRole("img", { name: "Map" })).toBeInTheDocument();
  });

  it("points at the slash command panel it never hands focus to", () => {
    render(
      <SemanticInlineEditor
        source="/head"
        onSourceChange={vi.fn()}
        slashListboxId="block-1-slash"
        slashMenuOpen
        slashActiveOptionId="block-1-slash-heading-2"
      />
    );
    const editor = screen.getByRole("textbox", { name: "Markdown block" });

    expect(editor).toHaveAttribute("aria-haspopup", "listbox");
    expect(editor).toHaveAttribute("aria-controls", "block-1-slash");
    expect(editor).toHaveAttribute("aria-activedescendant", "block-1-slash-heading-2");
  });

  it("drops the panel relationship while the panel is closed", () => {
    render(
      <SemanticInlineEditor
        source="text"
        onSourceChange={vi.fn()}
        slashListboxId="block-1-slash"
        slashActiveOptionId="block-1-slash-heading-2"
      />
    );
    const editor = screen.getByRole("textbox", { name: "Markdown block" });

    expect(editor).toHaveAttribute("aria-haspopup", "listbox");
    expect(editor).not.toHaveAttribute("aria-controls");
    expect(editor).not.toHaveAttribute("aria-activedescendant");
  });

  it("claims no popup on a surface that has no slash panel", () => {
    render(<SemanticInlineEditor source="cell" label="Table cell" onSourceChange={vi.fn()} />);
    const editor = screen.getByRole("textbox", { name: "Table cell" });

    expect(editor).not.toHaveAttribute("aria-haspopup");
    expect(editor).not.toHaveAttribute("aria-controls");
    expect(editor).not.toHaveAttribute("aria-activedescendant");
  });
});

function setDomSelection(node: Node, offset: number) {
  const selection = window.getSelection();
  if (!selection) throw new Error("Selection API unavailable");
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}
