/**
 * The counter calls the first hit "1 of N", so the find bar has to reveal it
 * while the term is being typed — not only once Enter is pressed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Editor } from "@tiptap/core";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { SearchPluginKey } from "@/extensions/search";
import { scrollToPosition } from "@/lib/editor-utils";

vi.mock("@/lib/editor-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/editor-utils")>();
  return { ...actual, scrollToPosition: vi.fn() };
});

const scrollMock = vi.mocked(scrollToPosition);

function makeEditor(html: string): Editor {
  return new Editor({ extensions: getEditorExtensions(), content: html });
}

describe("revealing the current match", () => {
  beforeEach(() => scrollMock.mockClear());

  it("scrolls to the first match when the search term is set", () => {
    const editor = makeEditor("<p>alpha</p><p>beta needle gamma</p>");
    editor.commands.setSearchTerm("needle");
    const first = SearchPluginKey.getState(editor.state)?.results[0];
    editor.destroy();
    expect(first).toBeDefined();
    expect(scrollMock).toHaveBeenCalledWith(expect.anything(), first!.from);
  });

  it("does not scroll when there is nothing to reveal", () => {
    const editor = makeEditor("<p>alpha</p>");
    editor.commands.setSearchTerm("needle");
    editor.destroy();
    expect(scrollMock).not.toHaveBeenCalled();
  });

  it("the first next() advances to the second match", () => {
    const editor = makeEditor("<p>needle one</p><p>needle two</p>");
    editor.commands.setSearchTerm("needle");
    editor.commands.nextSearchResult();
    const state = SearchPluginKey.getState(editor.state);
    editor.destroy();
    expect(state?.currentIndex).toBe(1);
  });
});
