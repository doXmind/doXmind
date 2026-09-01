import { describe, expect, it } from "vitest";

import { MarkdownBlockDocument } from "@/editor/markdown-block/markdown-block-document";
import {
  hiddenMarkdownBlockIds,
  isMarkdownFoldable,
  markdownFoldRangeEnd,
} from "@/editor/markdown-block/markdown-block-source";

const blocksOf = (markdown: string) =>
  MarkdownBlockDocument.fromMarkdown(markdown).getSnapshot().blocks;

describe("markdownFoldRangeEnd", () => {
  it("gives a heading everything down to the next heading of equal or higher level", () => {
    const blocks = blocksOf("# One\n\nbody\n\n## Two\n\nmore\n\n# Three\n\nlast\n");
    const kinds = blocks.map((block) => `${block.kind}${block.level ?? ""}`);
    expect(kinds).toEqual([
      "heading1",
      "paragraph",
      "heading2",
      "paragraph",
      "heading1",
      "paragraph",
    ]);

    // `# One` owns its body, `## Two` and its body — everything before the next H1.
    expect(markdownFoldRangeEnd(blocks, 0)).toBe(4);
    // `## Two` owns only its own body.
    expect(markdownFoldRangeEnd(blocks, 2)).toBe(4);
    // The last heading owns the rest of the document.
    expect(markdownFoldRangeEnd(blocks, 4)).toBe(6);
  });

  it("gives a list item its deeper descendants and stops at its sibling", () => {
    const blocks = blocksOf("- a\n  - a1\n    - a2\n- b\n");

    expect(markdownFoldRangeEnd(blocks, 0)).toBe(3);
    expect(markdownFoldRangeEnd(blocks, 1)).toBe(3);
    // A leaf owns nothing, which is what makes it unfoldable.
    expect(markdownFoldRangeEnd(blocks, 2)).toBe(3);
    expect(markdownFoldRangeEnd(blocks, 3)).toBe(4);
  });

  it("offers a control only where something would actually be hidden", () => {
    const blocks = blocksOf("# One\n\nbody\n\n- a\n  - a1\n\nplain\n");

    expect(blocks.map((_, index) => isMarkdownFoldable(blocks, index))).toEqual([
      true, // heading with a body
      false, // paragraph
      true, // list item with a child
      false, // the child
      false, // trailing paragraph
    ]);
  });
});

describe("hiddenMarkdownBlockIds", () => {
  it("hides what a fold owns, and never the folded Block itself", () => {
    const blocks = blocksOf("# One\n\nbody\n\n# Two\n\nother\n");
    const hidden = hiddenMarkdownBlockIds(blocks, new Set([blocks[0].id]));

    expect(hidden.has(blocks[0].id)).toBe(false);
    // The value is the anchor to open when the caret has to be revealed here.
    expect(hidden.get(blocks[1].id)).toEqual([blocks[0].id]);
    expect(hidden.has(blocks[2].id)).toBe(false);
  });

  it("counts a fold nested inside another fold only once", () => {
    const blocks = blocksOf("- a\n  - a1\n    - a2\n- b\n");
    const both = hiddenMarkdownBlockIds(blocks, new Set([blocks[0].id, blocks[1].id]));

    expect([...both.keys()]).toEqual([blocks[1].id, blocks[2].id]);
    // Only the outer anchor hides them: the inner fold is already inside its range.
    expect(both.get(blocks[2].id)).toEqual([blocks[0].id]);
    expect(both.has(blocks[3].id)).toBe(false);
  });

  it("ignores a folded anchor that no longer exists, so fold state heals across edits", () => {
    const blocks = blocksOf("# One\n\nbody\n");
    expect(hiddenMarkdownBlockIds(blocks, new Set(["deleted-block"])).size).toBe(0);
  });

  it("hides nothing when nothing is folded", () => {
    const blocks = blocksOf("# One\n\nbody\n");
    expect(hiddenMarkdownBlockIds(blocks, new Set()).size).toBe(0);
  });
});
