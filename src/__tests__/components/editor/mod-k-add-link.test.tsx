/**
 * Mod+K is advertised as "Add link" in the bubble menu tooltip and the
 * shortcuts panel, but the command palette shortcut lives on window and used
 * to take every press. With a selection the editor has to win.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { markdownToHtml } from "@/lib/markdown";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { EditorContextMenu } from "@/components/editor/editor-context-menu";

function makeMountedEditor(body: string): Editor {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: getEditorExtensions(),
    content: markdownToHtml(body),
  });
  editor.view.focus();
  return editor;
}

function pressModK(editor: Editor): { reachedWindow: boolean; prevented: boolean } {
  let reachedWindow = false;
  const spy = () => {
    reachedWindow = true;
  };
  window.addEventListener("keydown", spy);
  const event = new KeyboardEvent("keydown", {
    key: "k",
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    editor.view.dom.dispatchEvent(event);
  });
  window.removeEventListener("keydown", spy);
  return { reachedWindow, prevented: event.defaultPrevented };
}

afterEach(cleanup);

describe("Mod+K", () => {
  it("opens the link modal when text is selected, and keeps the palette out", () => {
    const editor = makeMountedEditor("Alpha paragraph.");
    render(<EditorContextMenu editor={editor} />);
    editor.commands.setTextSelection({ from: 1, to: 6 });

    const { reachedWindow, prevented } = pressModK(editor);

    const modal = document.querySelector("#link-url");
    editor.destroy();

    expect(prevented).toBe(true);
    expect(reachedWindow).toBe(false);
    expect(modal).not.toBeNull();
  });

  it("leaves the key to the command palette when nothing is selected", () => {
    const editor = makeMountedEditor("Alpha paragraph.");
    render(<EditorContextMenu editor={editor} />);
    editor.commands.setTextSelection(3);

    const { reachedWindow, prevented } = pressModK(editor);

    const modal = document.querySelector("#link-url");
    editor.destroy();

    expect(prevented).toBe(false);
    expect(reachedWindow).toBe(true);
    expect(modal).toBeNull();
  });
});
