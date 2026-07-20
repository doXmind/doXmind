/**
 * Editor-scoped keyboard shortcuts.
 *
 * These all share one failure mode: the caret ends up somewhere the user did
 * not put it, so the next keystroke acts on the wrong thing (or on nothing).
 */
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { markdownToHtml } from "@/lib/markdown";
import { useBlockKeyboardShortcuts } from "@/hooks/use-block-keyboard-shortcuts";
import { stubLayoutRects } from "../helpers/stub-layout";

function makeMountedEditor(body: string): Editor {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: getEditorExtensions(),
    content: markdownToHtml(body),
  });
  editor.commands.setSourceBaseline(body);
  editor.view.focus();
  return editor;
}

/** Dispatch from the editor DOM, the way a real keystroke arrives. */
function press(editor: Editor, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  editor.view.dom.dispatchEvent(event);
  return event;
}

/** Put the caret inside the first textblock whose text matches. */
function caretIn(editor: Editor, text: string): void {
  let pos = -1;
  editor.state.doc.descendants((node, at) => {
    if (pos < 0 && node.isTextblock && node.textContent === text) pos = at;
    return pos < 0;
  });
  if (pos < 0) throw new Error(`no textblock ${text}`);
  editor.commands.setTextSelection(pos + 2);
}

/** Top-level block order — what the move shortcut is responsible for. */
function blockOrder(editor: Editor): string[] {
  const texts: string[] = [];
  editor.state.doc.forEach((node) => {
    if (node.textContent) texts.push(node.textContent);
  });
  return texts;
}

const norm = (s: string) => s.replace(/\n+$/, "");

stubLayoutRects();

afterEach(cleanup);

describe("Cmd+Shift+Arrow keeps the caret on the moved block", () => {
  it("repeated presses keep moving the same block", () => {
    const editor = makeMountedEditor("Alpha.\n\nBeta.\n\nGamma.");
    renderHook(() => useBlockKeyboardShortcuts(editor));

    caretIn(editor, "Gamma.");

    press(editor, "ArrowUp", { metaKey: true, shiftKey: true });
    press(editor, "ArrowUp", { metaKey: true, shiftKey: true });

    const order = blockOrder(editor);
    editor.destroy();

    expect(order).toEqual(["Gamma.", "Alpha.", "Beta."]);
  });

  it("moving down twice carries the caret with the block", () => {
    const editor = makeMountedEditor("Alpha.\n\nBeta.\n\nGamma.");
    renderHook(() => useBlockKeyboardShortcuts(editor));

    caretIn(editor, "Alpha.");

    press(editor, "ArrowDown", { metaKey: true, shiftKey: true });
    press(editor, "ArrowDown", { metaKey: true, shiftKey: true });

    const order = blockOrder(editor);
    editor.destroy();

    expect(order).toEqual(["Beta.", "Gamma.", "Alpha."]);
  });
});

describe("Tab does not let focus escape the editor", () => {
  it("swallows Tab in a plain paragraph", () => {
    const editor = makeMountedEditor("Alpha paragraph.");
    renderHook(() => useBlockKeyboardShortcuts(editor));
    caretIn(editor, "Alpha paragraph.");

    const event = press(editor, "Tab");
    const out = norm(editor.getMarkdown() as string);
    editor.destroy();

    expect(event.defaultPrevented).toBe(true);
    expect(out).toBe("Alpha paragraph.");
  });

  it("leaves Tab alone where the editor already handles it", () => {
    const editor = makeMountedEditor("- One\n- Two");
    renderHook(() => useBlockKeyboardShortcuts(editor));
    // Caret inside the second list item so sinkListItem applies.
    caretIn(editor, "Two");

    press(editor, "Tab");

    const out = norm(editor.getMarkdown() as string);
    editor.destroy();

    expect(out).toContain("  - Two");
  });
});

// jsdom reports no platform, so prosemirror-keymap resolves "Mod-" to Ctrl-.
// Use Ctrl so the editor's own select-all fallback is reachable here.
describe("Mod+A scopes to the current block before the document", () => {
  it("selects the code block's own text first, the document second", () => {
    const editor = makeMountedEditor("Intro.\n\n```js\nconst a = 1;\n```");
    renderHook(() => useBlockKeyboardShortcuts(editor));

    let codeFrom = 0;
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === "codeBlock") codeFrom = offset;
    });
    editor.commands.setTextSelection(codeFrom + 2);

    press(editor, "a", { ctrlKey: true });
    const first = editor.state.selection;
    expect(editor.state.doc.textBetween(first.from, first.to).trim()).toBe("const a = 1;");

    press(editor, "a", { ctrlKey: true });
    const second = editor.state.selection;
    const coversDoc = second.from <= 1 && second.to >= editor.state.doc.content.size - 1;
    editor.destroy();

    expect(coversDoc).toBe(true);
  });

  it("selects a table cell's text first", () => {
    const editor = makeMountedEditor("| a | b |\n| --- | --- |\n| cell one | d |");
    renderHook(() => useBlockKeyboardShortcuts(editor));

    let cellPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (cellPos < 0 && node.isTextblock && node.textContent === "cell one") cellPos = pos;
      return true;
    });
    expect(cellPos).toBeGreaterThan(0);
    editor.commands.setTextSelection(cellPos + 2);

    press(editor, "a", { ctrlKey: true });
    const sel = editor.state.selection;
    const text = editor.state.doc.textBetween(sel.from, sel.to);
    editor.destroy();

    expect(text).toBe("cell one");
  });
});
