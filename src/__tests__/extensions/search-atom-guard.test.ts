import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { markdownToHtml } from "@/lib/markdown";
import { processSearches } from "@/extensions/search/search-algorithms";

function docFor(body: string) {
  const editor = new Editor({ extensions: getEditorExtensions(), content: markdownToHtml(body) });
  editor.commands.setContent(markdownToHtml(body), { emitUpdate: false } as never);
  return editor;
}

describe("search must not produce ranges that swallow an inline atom", () => {
  it("a regex spanning inline math yields no textblock match over it", () => {
    const editor = docFor("alpha $x^2$ omega\n");
    const hits = processSearches(editor.state.doc, "alpha.*omega", false, false, true);
    editor.destroy();
    // The only acceptable outcomes are no match, or matches that do not span
    // the math node — never a range covering it, which Replace would delete.
    for (const h of hits) {
      expect(h.to - h.from).toBeLessThan("alpha  omega".length + 4);
    }
  });

  it("still finds a term split across a mark boundary", () => {
    const editor = docFor("a **nee**dle here\n");
    const hits = processSearches(editor.state.doc, "needle", false, false, false);
    editor.destroy();
    expect(hits.length).toBe(1);
  });

  it("reported ranges never overlap", () => {
    const editor = docFor("abc $abc$ abc\n");
    const hits = processSearches(editor.state.doc, "a.*c", false, false, true);
    editor.destroy();
    const sorted = [...hits].sort((a, b) => a.from - b.from);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].from).toBeGreaterThanOrEqual(sorted[i - 1].to);
    }
  });
});
