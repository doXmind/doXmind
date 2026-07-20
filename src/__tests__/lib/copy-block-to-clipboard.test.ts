/**
 * The block-handle "Copy" action writes the same two flavors as ⌘C: markdown
 * as text/plain, rich markup as text/html.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { markdownToHtml } from "@/lib/markdown";
import { copyBlockToClipboard } from "@/lib/block-operations";

// jsdom's Blob has no text(), so stand in a recording one to read the flavors back.
class FakeBlob {
  constructor(public readonly parts: string[]) {}
}
class FakeClipboardItem {
  constructor(public readonly items: Record<string, FakeBlob>) {}
}

interface Written {
  items?: Record<string, FakeBlob>;
  text?: string;
}

function installClipboard(): Written {
  const written: Written = {};
  const clipboard = {
    write: vi.fn(async (entries: FakeClipboardItem[]) => {
      written.items = entries[0].items;
    }),
    writeText: vi.fn(async (text: string) => {
      written.text = text;
    }),
  };
  vi.stubGlobal("Blob", FakeBlob);
  vi.stubGlobal("ClipboardItem", FakeClipboardItem);
  vi.stubGlobal("navigator", { ...navigator, clipboard });
  return written;
}

function flavor(written: Written, type: string): string {
  return written.items?.[type]?.parts.join("") ?? "";
}

describe("copyBlockToClipboard", () => {
  let editor: Editor;

  beforeEach(() => {
    editor = new Editor({
      extensions: getEditorExtensions(),
      content: markdownToHtml(["1. first", "2. second"].join("\n")),
    });
  });

  afterEach(() => {
    editor.destroy();
    vi.unstubAllGlobals();
  });

  it("writes markdown as text/plain and markup as text/html", async () => {
    const written = installClipboard();
    const ok = await copyBlockToClipboard(editor, 0, editor.state.doc.content.size);

    expect(ok).toBe(true);
    const text = flavor(written, "text/plain");
    expect(text).toContain("1. first");
    expect(text).toContain("2. second");
    expect(flavor(written, "text/html")).toContain("<ol");
  });

  it("keeps math that carries no text nodes", async () => {
    editor.commands.setContent(markdownToHtml(["$$", "x^2", "$$"].join("\n")));
    const written = installClipboard();
    await copyBlockToClipboard(editor, 0, editor.state.doc.content.size);

    expect(flavor(written, "text/plain")).toContain("x^2");
  });

  it("falls back to plain markdown where ClipboardItem is unavailable", async () => {
    const written = installClipboard();
    vi.stubGlobal("ClipboardItem", undefined);
    const ok = await copyBlockToClipboard(editor, 0, editor.state.doc.content.size);

    expect(ok).toBe(true);
    expect(written.text).toContain("1. first");
  });
});
