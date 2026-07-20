/**
 * The block action menu must hand focus back to the editor.
 *
 * Every entry mutates the document, so leaving focus on the detached menu (and
 * then on <body> once it unmounts) means the user's immediate Cmd+Z reflex
 * reaches nothing — after Delete that reads as unrecoverable data loss.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { markdownToHtml } from "@/lib/markdown";
import { stubLayoutRects } from "../../helpers/stub-layout";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { BlockActionMenu } from "@/components/editor/block-action-menu";

function makeMountedEditor(body: string): Editor {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: getEditorExtensions(),
    content: markdownToHtml(body),
  });
  editor.commands.setSourceBaseline(body);
  return editor;
}

/** Top-level block order — getMarkdown() is not what this test is about. */
function blockOrder(editor: Editor): string[] {
  const texts: string[] = [];
  editor.state.doc.forEach((node) => {
    if (node.textContent) texts.push(node.textContent);
  });
  return texts;
}

stubLayoutRects();

afterEach(cleanup);

function clickItem(label: string) {
  const button = Array.from(document.querySelectorAll("button")).find((b) =>
    b.textContent?.startsWith(label)
  );
  if (!button) throw new Error(`no menu item ${label}`);
  fireEvent.click(button);
}

function renderMenu(editor: Editor, blockPos: number) {
  return render(
    <BlockActionMenu
      editor={editor}
      blockPos={blockPos}
      position={{ x: 10, y: 10 }}
      onClose={() => {}}
    />
  );
}

describe("block action menu — focus handback", () => {
  it("returns focus to the editor after Delete, so undo is reachable", () => {
    const editor = makeMountedEditor("Alpha paragraph.\n\nBeta paragraph.");
    const secondPos = editor.state.doc.resolve(editor.state.doc.content.size - 2).before(1);
    renderMenu(editor, secondPos);

    clickItem("blockAction.delete");

    expect(editor.view.hasFocus()).toBe(true);

    expect(blockOrder(editor)).toEqual(["Alpha paragraph."]);

    editor.commands.undo();
    const order = blockOrder(editor);
    editor.destroy();

    expect(order).toEqual(["Alpha paragraph.", "Beta paragraph."]);
  });

  it("returns focus to the editor after Duplicate", () => {
    const editor = makeMountedEditor("Alpha paragraph.");
    renderMenu(editor, 0);

    clickItem("blockAction.duplicate");

    const focused = editor.view.hasFocus();
    editor.destroy();
    expect(focused).toBe(true);
  });

  it("returns focus to the editor after Move up", () => {
    const editor = makeMountedEditor("Alpha paragraph.\n\nBeta paragraph.");
    const secondPos = editor.state.doc.resolve(editor.state.doc.content.size - 2).before(1);
    renderMenu(editor, secondPos);

    clickItem("blockAction.moveUp");

    const focused = editor.view.hasFocus();
    const order = blockOrder(editor);
    editor.destroy();

    expect(focused).toBe(true);
    expect(order).toEqual(["Beta paragraph.", "Alpha paragraph."]);
  });
});
