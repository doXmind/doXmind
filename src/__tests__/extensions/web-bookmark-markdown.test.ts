/**
 * What an authority-less bookmark writes into the `.md`. The rewrite itself is
 * guarded in web-bookmark-url.test.tsx (the node view must not unfurl these);
 * this pins the emitted link so a URL that survived the node view can't be
 * mangled on the way out to the file.
 */
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { getEditorExtensions } from "@/components/editor/editor-extensions";

function markdownFor(url: string, title: string): string {
  const editor = new Editor({
    extensions: getEditorExtensions(),
    content: `<div data-type="web-bookmark" data-url="${url}" data-title="${title}"></div>`,
  });
  const markdown = editor.getMarkdown() as string;
  editor.destroy();
  return markdown;
}

describe("web bookmark markdown", () => {
  it("emits a mailto: bookmark with the address the user typed", () => {
    const markdown = markdownFor("mailto:someone@example.com", "Email me");
    expect(markdown).toContain("[Email me](mailto:someone@example.com)");
    expect(markdown).not.toContain("https://mailto:");
  });

  it("emits a tel: bookmark with the number the user typed", () => {
    expect(markdownFor("tel:+15551234567", "Support")).toContain("[Support](tel:+15551234567)");
  });
});
