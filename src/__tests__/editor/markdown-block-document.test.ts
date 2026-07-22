import { describe, expect, it } from "vitest";

import { MarkdownBlockDocument } from "@/editor/markdown-block/markdown-block-document";

describe("MarkdownBlockDocument", () => {
  it("classifies valid and invalid Collection definitions as exact source-only blocks", () => {
    const valid =
      '```doxmind-collection\r\n{"version":1,"view":"table","filters":[],"columns":["status"],"sort":[]}\r\n```\r\n\r\n';
    const invalid = "```doxmind-collection\n{]\n```\n";

    for (const source of [valid, invalid]) {
      const snapshot = MarkdownBlockDocument.fromMarkdown(source).getSnapshot();
      expect(snapshot.markdown).toBe(source);
      expect(snapshot.blocks).toHaveLength(1);
      expect(snapshot.blocks[0]).toMatchObject({ kind: "collection", editable: true, raw: source });
    }
  });

  it("classifies only safe standalone local Markdown images as image blocks", () => {
    const local = '![Roadmap](../assets/roadmap.png "Q3")\r\n\r\n';
    const remote = "![Remote](https://example.com/private.png)\n";

    expect(MarkdownBlockDocument.fromMarkdown(local).getSnapshot().blocks[0]).toMatchObject({
      kind: "image",
      raw: local,
      editable: true,
    });
    expect(MarkdownBlockDocument.fromMarkdown(remote).getSnapshot().blocks[0]).toMatchObject({
      kind: "paragraph",
      raw: remote,
      editable: true,
    });
  });

  it("classifies portable details as a source-backed toggle without normalizing bytes", () => {
    const markdown =
      "<details open>\r\n<summary>More</summary>\r\n\r\nNested **Markdown**.\r\n\r\n</details>\r\n";
    const snapshot = MarkdownBlockDocument.fromMarkdown(markdown).getSnapshot();

    expect(snapshot.markdown).toBe(markdown);
    expect(snapshot.blocks).toHaveLength(1);
    expect(snapshot.blocks[0]).toMatchObject({ kind: "toggle", editable: true, raw: markdown });
  });
  it("derives source-backed blocks without changing the Markdown", () => {
    const markdown = "# Heading\n\nFirst paragraph\n\n- untouched\n- list\n";

    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const snapshot = document.getSnapshot();

    expect(snapshot.markdown).toBe(markdown);
    expect(snapshot.blocks.map(({ kind, editable }) => ({ kind, editable }))).toEqual([
      { kind: "heading", editable: true },
      { kind: "paragraph", editable: true },
      { kind: "bullet_list_item", editable: true },
      { kind: "bullet_list_item", editable: true },
    ]);
    expect(snapshot.blocks.map((block) => block.raw).join("")).toBe(markdown);
    expect(new Set(snapshot.blocks.map((block) => block.id)).size).toBe(4);
  });

  it("keeps adjacent ATX headings and paragraphs as four editable source Blocks", () => {
    const markdown = "# Heading\nParagraph\n## Next\nText";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    expect(before.blocks.map(({ kind, raw }) => ({ kind, raw }))).toEqual([
      { kind: "heading", raw: "# Heading\n" },
      { kind: "paragraph", raw: "Paragraph\n" },
      { kind: "heading", raw: "## Next\n" },
      { kind: "paragraph", raw: "Text" },
    ]);
    expect(before.blocks.map((block) => block.raw).join("")).toBe(markdown);

    const changed = document.apply({
      type: "replaceText",
      blockId: before.blocks[1].id,
      range: { from: "Paragraph".length, to: "Paragraph".length },
      text: "!",
    }).snapshot;

    expect(changed.markdown).toBe("# Heading\nParagraph!\n## Next\nText");
    expect(changed.blocks).toHaveLength(4);
    expect(changed.blocks.map((block) => block.raw).join("")).toBe(changed.markdown);
  });

  it("exposes contiguous source spans whose raw views come from canonical Markdown", () => {
    const markdown = "# Heading\r\n\r\nParagraph\r\n\r\n- raw\r\n";

    const snapshot = MarkdownBlockDocument.fromMarkdown(markdown).getSnapshot();

    expect(snapshot.blocks.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: 0, to: 13 },
      { from: 13, to: 26 },
      { from: 26, to: markdown.length },
    ]);
    for (const block of snapshot.blocks) {
      expect(block.raw).toBe(snapshot.markdown.slice(block.from, block.to));
    }
  });

  it("preserves CRLF and reference definitions as exact unsupported source", () => {
    const markdown = "[reference]: /target\r\n\r\nPlain\r\n";

    const snapshot = MarkdownBlockDocument.fromMarkdown(markdown).getSnapshot();

    expect(snapshot.markdown).toBe(markdown);
    expect(snapshot.blocks.map(({ kind, editable }) => ({ kind, editable }))).toEqual([
      { kind: "unsupported", editable: true },
      { kind: "paragraph", editable: true },
    ]);
    expect(snapshot.blocks.map((block) => block.raw).join("")).toBe(markdown);
  });

  it("projects a fenced code block with internal blank lines as one editable source block", () => {
    const markdown =
      "Before\r\n\r\n```ts\r\nconst first = 1;\r\n\r\nconst second = 2;\r\n```\r\n\r\nAfter\r\n";

    const snapshot = MarkdownBlockDocument.fromMarkdown(markdown).getSnapshot();

    expect(snapshot.markdown).toBe(markdown);
    expect(snapshot.blocks.map(({ kind, editable }) => ({ kind, editable }))).toEqual([
      { kind: "paragraph", editable: true },
      { kind: "fenced_code", editable: true },
      { kind: "paragraph", editable: true },
    ]);
    expect(snapshot.blocks[1].raw).toBe(
      "```ts\r\nconst first = 1;\r\n\r\nconst second = 2;\r\n```\r\n\r\n"
    );
    expect(snapshot.blocks.map((block) => block.raw).join("")).toBe(markdown);
  });

  it("projects top-level list and task items as editable source-backed Blocks", () => {
    const markdown = "- bullet\r\n- [ ] todo\r\n1) ordered\r\n";

    const snapshot = MarkdownBlockDocument.fromMarkdown(markdown).getSnapshot();

    expect(
      snapshot.blocks.map(({ kind, editable, checked }) => ({ kind, editable, checked }))
    ).toEqual([
      { kind: "bullet_list_item", editable: true, checked: undefined },
      { kind: "task_list_item", editable: true, checked: false },
      { kind: "ordered_list_item", editable: true, checked: undefined },
    ]);
    expect(snapshot.blocks.map((block) => block.raw).join("")).toBe(markdown);
  });

  it("keeps a nested list item raw until nested structural commands are supported", () => {
    const markdown = "- outer\n  - nested\n- next\n";

    const snapshot = MarkdownBlockDocument.fromMarkdown(markdown).getSnapshot();

    expect(snapshot.blocks.map(({ kind, editable }) => ({ kind, editable }))).toEqual([
      { kind: "unsupported", editable: true },
      { kind: "bullet_list_item", editable: true },
    ]);
    expect(snapshot.blocks.map((block) => block.raw).join("")).toBe(markdown);
  });

  it("projects an explicit multi-line blockquote as one editable source-backed Block", () => {
    const markdown = "> quoted\r\n> second line\r\n\r\nAfter\r\n";

    const snapshot = MarkdownBlockDocument.fromMarkdown(markdown).getSnapshot();

    expect(snapshot.blocks.map(({ kind, editable }) => ({ kind, editable }))).toEqual([
      { kind: "blockquote", editable: true },
      { kind: "paragraph", editable: true },
    ]);
    expect(snapshot.blocks[0].raw).toBe("> quoted\r\n> second line\r\n\r\n");
    expect(snapshot.blocks.map((block) => block.raw).join("")).toBe(markdown);
  });

  it("checks a task by patching only the checkbox source character", () => {
    const markdown = "- [ ] todo\r\n- [X] keep uppercase\r\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({
      type: "setTaskChecked",
      blockId: before.blocks[0].id,
      checked: true,
    });

    expect(result.snapshot.markdown).toBe("- [x] todo\r\n- [X] keep uppercase\r\n");
    expect(result.snapshot.blocks[0].checked).toBe(true);
    expect(document.undo().markdown).toBe(markdown);
  });

  it("centralizes native classification for soft paragraphs and structural Markdown", () => {
    const markdown = "A paragraph can wrap\r\nacross source lines.\r\n\r\n---\r\n";

    const snapshot = MarkdownBlockDocument.fromMarkdown(markdown).getSnapshot();

    expect(snapshot.markdown).toBe(markdown);
    expect(snapshot.blocks.map(({ kind, editable }) => ({ kind, editable }))).toEqual([
      { kind: "paragraph", editable: true },
      { kind: "thematic_break", editable: true },
    ]);
  });

  it("classifies lossless thematic breaks, GFM tables, block math, mermaid, and callouts", () => {
    const markdown =
      "---\r\n\r\n" +
      "| Name | Value |\r\n| :--- | ---: |\r\n| alpha | **one** |\r\n\r\n" +
      "$$\r\nx^2 + y^2\r\n$$\r\n\r\n" +
      "```mermaid\r\ngraph TD\r\n  A --> B\r\n```\r\n\r\n" +
      "> [!NOTE] Source of truth\r\n> Body stays Markdown.\r\n";

    const snapshot = MarkdownBlockDocument.fromMarkdown(markdown).getSnapshot();

    expect(snapshot.blocks.map(({ kind, editable }) => ({ kind, editable }))).toEqual([
      { kind: "thematic_break", editable: true },
      { kind: "table", editable: true },
      { kind: "block_math", editable: true },
      { kind: "mermaid", editable: true },
      { kind: "callout", editable: true },
    ]);
    expect(snapshot.blocks.map((block) => block.raw).join("")).toBe(markdown);
    for (const block of snapshot.blocks) {
      expect(block.raw).toBe(markdown.slice(block.from, block.to));
    }
  });

  it("edits semantic source blocks losslessly but rejects unsafe structural commands", () => {
    const markdown = "---\r\n\r\n```mermaid\r\ngraph TD\r\nA-->B\r\n```\r\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();
    const thematicId = before.blocks[0].id;
    const mermaidId = before.blocks[1].id;
    const codeFrom = before.blocks[1].raw.indexOf("A-->B");

    const changed = document.apply({
      type: "replaceText",
      blockId: mermaidId,
      range: { from: codeFrom, to: codeFrom + 5 },
      text: "A-->C",
    }).snapshot;

    expect(changed.markdown).toBe(markdown.replace("A-->B", "A-->C"));
    expect(changed.blocks[1]).toMatchObject({ kind: "mermaid", editable: true });
    expect(() => document.apply({ type: "split", blockId: mermaidId, at: 4 })).toThrow(
      /cannot be split structurally/i
    );
    expect(() =>
      document.apply({ type: "setKind", blockId: thematicId, kind: "paragraph" })
    ).toThrow(/cannot change kind structurally/i);
    const undone = document.undo();
    expect(undone.markdown).toBe(before.markdown);
    expect(undone.blocks).toEqual(before.blocks);
  });

  it("allocates a unique id for the first block inserted into an empty Page", () => {
    const document = MarkdownBlockDocument.fromMarkdown("");
    const firstId = document.getSnapshot().blocks[0].id;

    const result = document.apply({ type: "insertAfter", blockId: firstId });

    expect(result.snapshot.blocks.map((block) => block.id)).toEqual(["block-1", "block-2"]);
  });

  it("replaces UTF-16 ranges while leaving untouched blocks byte-identical", () => {
    const document = MarkdownBlockDocument.fromMarkdown("你好🙂 world\n\n# Keep\n");
    const before = document.getSnapshot();

    const result = document.apply({
      type: "replaceText",
      blockId: before.blocks[0].id,
      range: { from: 2, to: 4 },
      text: "🌏",
    });

    expect(result.snapshot.markdown).toBe("你好🌏 world\n\n# Keep\n");
    expect(result.snapshot.revision).toBe(1);
    expect(result.snapshot.blocks[1]).toEqual(before.blocks[1]);
  });

  it("edits unsupported raw source without enabling unsafe structural commands", () => {
    const document = MarkdownBlockDocument.fromMarkdown("[reference]: /target\n");
    const before = document.getSnapshot();
    const blockId = before.blocks[0].id;

    const edited = document.apply({
      type: "replaceText",
      blockId,
      range: { from: 13, to: 20 },
      text: "/next",
    });

    expect(edited.snapshot.markdown).toBe("[reference]: /next\n");
    expect(edited.snapshot.blocks[0]).toMatchObject({ kind: "unsupported", editable: true });
    expect(() => document.apply({ type: "split", blockId, at: 2 })).toThrow(
      /raw blocks cannot be split structurally/i
    );
    const undone = document.undo();
    expect(undone.markdown).toBe(before.markdown);
    expect(undone.blocks).toEqual(before.blocks);
  });

  it("does not revise or record history for identical text and kind commands", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Alpha\n");
    const before = document.getSnapshot();
    const blockId = before.blocks[0].id;

    const sameText = document.apply({
      type: "replaceText",
      blockId,
      range: { from: 0, to: 5 },
      text: "Alpha",
    }).snapshot;
    const sameKind = document.apply({ type: "setKind", blockId, kind: "paragraph" }).snapshot;

    expect(sameText).toEqual(before);
    expect(sameKind).toEqual(before);
    expect(document.undo()).toEqual(before);
  });

  it("reprojects a pasted block boundary so save and reopen keep the same partition", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Alpha\n");
    const blockId = document.getSnapshot().blocks[0].id;

    const result = document.apply({
      type: "replaceText",
      blockId,
      range: { from: 0, to: 5 },
      text: "A\n\nB",
    });
    const reopened = MarkdownBlockDocument.fromMarkdown(result.snapshot.markdown).getSnapshot();

    expect(result.snapshot.markdown).toBe("A\n\nB\n");
    expect(result.snapshot.blocks.map((block) => block.raw)).toEqual(["A\n\n", "B\n"]);
    expect(result.snapshot.blocks.map((block) => block.kind)).toEqual(
      reopened.blocks.map((block) => block.kind)
    );
  });

  it("reclassifies ATX headings after an editable source change", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Alpha\n");
    const blockId = document.getSnapshot().blocks[0].id;

    const heading = document.apply({
      type: "replaceText",
      blockId,
      range: { from: 0, to: 5 },
      text: "# Alpha",
    });
    expect(heading.snapshot.blocks[0]).toMatchObject({ kind: "heading", level: 1 });

    const paragraph = document.apply({
      type: "replaceText",
      blockId,
      range: { from: 0, to: 2 },
      text: "",
    });
    expect(paragraph.snapshot.blocks[0].kind).toBe("paragraph");
    expect(paragraph.snapshot.blocks[0].level).toBeUndefined();
    expect(paragraph.snapshot.markdown).toBe("Alpha\n");
  });

  it("moves an exact source block before another block", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Alpha\n\n# Beta\n\nGamma\n");
    const before = document.getSnapshot();

    const result = document.apply({
      type: "move",
      blockId: before.blocks[2].id,
      beforeId: before.blocks[0].id,
    });

    expect(result.snapshot.markdown).toBe("Gamma\n\nAlpha\n\n# Beta\n\n");
    expect(result.snapshot.blocks.map((block) => block.id)).toEqual([
      before.blocks[2].id,
      before.blocks[0].id,
      before.blocks[1].id,
    ]);
  });

  it("does not record or revise a move when the block is already at the target", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Alpha\n\nBeta\n");
    const initial = document.getSnapshot();
    const changed = document.apply({
      type: "setKind",
      blockId: initial.blocks[0].id,
      kind: "heading",
      level: 2,
    }).snapshot;

    const beforeNext = document.apply({
      type: "move",
      blockId: changed.blocks[0].id,
      beforeId: changed.blocks[1].id,
    }).snapshot;
    const lastAtEnd = document.apply({
      type: "move",
      blockId: changed.blocks[1].id,
      beforeId: null,
    }).snapshot;

    expect(beforeNext).toEqual(changed);
    expect(lastAtEnd).toEqual(changed);
    expect(document.undo().markdown).toBe(initial.markdown);
  });

  it("moves a tight list item without rewriting the list as loose Markdown", () => {
    const document = MarkdownBlockDocument.fromMarkdown("- one\n- two\n- three\n");
    const before = document.getSnapshot();

    const result = document.apply({
      type: "move",
      blockId: before.blocks[2].id,
      beforeId: before.blocks[0].id,
    });

    expect(result.snapshot.markdown).toBe("- three\n- one\n- two\n");
    expect(
      MarkdownBlockDocument.fromMarkdown(result.snapshot.markdown).getSnapshot().blocks
    ).toHaveLength(3);
  });

  it("repairs both source boundaries when moving the last item in a list", () => {
    const document = MarkdownBlockDocument.fromMarkdown("- one\n- two\n\nAfter\n");
    const before = document.getSnapshot();

    const result = document.apply({
      type: "move",
      blockId: before.blocks[1].id,
      beforeId: before.blocks[0].id,
    });

    expect(result.snapshot.markdown).toBe("- two\n- one\n\nAfter\n");
  });

  it("splits an editable block into two source blocks", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Hello world\n\n# Keep\n");
    const before = document.getSnapshot();

    const result = document.apply({
      type: "split",
      blockId: before.blocks[0].id,
      at: 6,
    });

    expect(result.snapshot.markdown).toBe("Hello \n\nworld\n\n# Keep\n");
    expect(result.snapshot.blocks).toHaveLength(3);
    expect(result.snapshot.blocks[0].id).toBe(before.blocks[0].id);
    expect(result.selection?.blockId).toBe(result.snapshot.blocks[1].id);
    expect(result.selection?.anchor).toBe(0);
  });

  it("uses the source line ending when a split creates a new block boundary", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Hello\r\n");
    const blockId = document.getSnapshot().blocks[0].id;

    const result = document.apply({ type: "split", blockId, at: 2 });

    expect(result.snapshot.markdown).toBe("He\r\n\r\nllo\r\n");
  });

  it("splits a bullet item into adjacent source-backed list Blocks", () => {
    const document = MarkdownBlockDocument.fromMarkdown("- one two\r\n- keep\r\n");
    const before = document.getSnapshot();

    const result = document.apply({ type: "split", blockId: before.blocks[0].id, at: 6 });

    expect(result.snapshot.markdown).toBe("- one \r\n- two\r\n- keep\r\n");
    expect(result.snapshot.blocks.map((block) => block.kind)).toEqual([
      "bullet_list_item",
      "bullet_list_item",
      "bullet_list_item",
    ]);
    expect(result.selection).toEqual({
      blockId: result.snapshot.blocks[1].id,
      anchor: 2,
      head: 2,
    });
  });

  it("exits an empty list item to an empty paragraph", () => {
    const document = MarkdownBlockDocument.fromMarkdown("- \n");
    const before = document.getSnapshot();

    const result = document.apply({ type: "split", blockId: before.blocks[0].id, at: 2 });

    expect(result.snapshot.markdown).toBe("\n");
    expect(result.snapshot.blocks[0].kind).toBe("paragraph");
    expect(result.selection).toEqual({
      blockId: before.blocks[0].id,
      anchor: 0,
      head: 0,
    });
  });

  it("continues a blockquote in-place with its exact source prefix", () => {
    const document = MarkdownBlockDocument.fromMarkdown("> one two\r\n");
    const before = document.getSnapshot();

    const result = document.apply({ type: "split", blockId: before.blocks[0].id, at: 6 });

    expect(result.snapshot.markdown).toBe("> one \r\n> two\r\n");
    expect(result.snapshot.blocks).toHaveLength(1);
    expect(result.snapshot.blocks[0].kind).toBe("blockquote");
    expect(result.selection).toEqual({
      blockId: before.blocks[0].id,
      anchor: 10,
      head: 10,
    });
  });

  it("replaces the selected range when splitting a block", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Hello\n");
    const blockId = document.getSnapshot().blocks[0].id;

    const result = document.apply({ type: "split", blockId, at: 1, to: 4 });

    expect(result.snapshot.markdown).toBe("H\n\no\n");
    expect(result.snapshot.blocks.map((block) => block.raw)).toEqual(["H\n\n", "o\n"]);
  });

  it("does not trim spaces around a split command", () => {
    const document = MarkdownBlockDocument.fromMarkdown("left  right\n");
    const blockId = document.getSnapshot().blocks[0].id;

    const result = document.apply({ type: "split", blockId, at: 6 });

    expect(result.snapshot.markdown).toBe("left  \n\nright\n");
  });

  it("groups composition replacements behind one undo checkpoint", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Hello\n");
    const blockId = document.getSnapshot().blocks[0].id;

    document.apply({
      type: "replaceText",
      blockId,
      range: { from: 0, to: 5 },
      text: "你",
      recordHistory: true,
    });
    document.apply({
      type: "replaceText",
      blockId,
      range: { from: 0, to: 1 },
      text: "你好",
      recordHistory: false,
    });

    expect(document.undo().markdown).toBe("Hello\n");
  });

  it("merges a block backward at its source boundary", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Hello\n\nworld\n\n# Keep\n");
    const before = document.getSnapshot();

    const result = document.apply({
      type: "mergeBackward",
      blockId: before.blocks[1].id,
    });

    expect(result.snapshot.markdown).toBe("Helloworld\n\n# Keep\n");
    expect(result.snapshot.blocks).toHaveLength(2);
    expect(result.snapshot.blocks[0].id).toBe(before.blocks[0].id);
    expect(result.selection).toEqual({
      blockId: before.blocks[0].id,
      anchor: 5,
      head: 5,
    });
  });

  it("treats a whitespace-only line as a block separator when merging", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Alpha\n  \nBeta\n");
    const before = document.getSnapshot();

    const result = document.apply({
      type: "mergeBackward",
      blockId: before.blocks[1].id,
    });

    expect(result.snapshot.markdown).toBe("AlphaBeta\n");
  });

  it("merges adjacent list items while keeping one exact list marker", () => {
    const document = MarkdownBlockDocument.fromMarkdown("- one\n- two\n- keep\n");
    const before = document.getSnapshot();

    const result = document.apply({
      type: "mergeBackward",
      blockId: before.blocks[1].id,
    });

    expect(result.snapshot.markdown).toBe("- onetwo\n- keep\n");
    expect(result.selection).toEqual({
      blockId: before.blocks[0].id,
      anchor: 5,
      head: 5,
    });
  });

  it("unwraps the first list item instead of merging it into a preceding paragraph", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Before\n\n- item\n- next\n");
    const before = document.getSnapshot();

    const result = document.apply({
      type: "mergeBackward",
      blockId: before.blocks[1].id,
    });

    expect(result.snapshot.markdown).toBe("Before\n\nitem\n\n- next\n");
    expect(result.snapshot.blocks[1].kind).toBe("paragraph");
    expect(result.selection).toEqual({
      blockId: before.blocks[1].id,
      anchor: 0,
      head: 0,
    });
  });

  it("unwraps a blockquote at its payload boundary", () => {
    const document = MarkdownBlockDocument.fromMarkdown("> quoted\r\n");
    const before = document.getSnapshot();

    const result = document.apply({
      type: "mergeBackward",
      blockId: before.blocks[0].id,
    });

    expect(result.snapshot.markdown).toBe("quoted\r\n");
    expect(result.snapshot.blocks[0].kind).toBe("paragraph");
    expect(result.selection).toEqual({
      blockId: before.blocks[0].id,
      anchor: 0,
      head: 0,
    });
  });

  it("duplicates a block with a new session id", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Alpha\n\n# Beta\n");
    const before = document.getSnapshot();

    const result = document.apply({ type: "duplicate", blockId: before.blocks[0].id });

    expect(result.snapshot.markdown).toBe("Alpha\n\nAlpha\n\n# Beta\n");
    expect(result.snapshot.blocks[1].id).not.toBe(before.blocks[0].id);
    expect(result.snapshot.blocks[1].kind).toBe("paragraph");
  });

  it("duplicates a tight list item without turning the list loose", () => {
    const document = MarkdownBlockDocument.fromMarkdown("- one\n- two\n");
    const before = document.getSnapshot();

    const result = document.apply({ type: "duplicate", blockId: before.blocks[0].id });

    expect(result.snapshot.markdown).toBe("- one\n- one\n- two\n");
    expect(result.snapshot.blocks.map((block) => block.kind)).toEqual([
      "bullet_list_item",
      "bullet_list_item",
      "bullet_list_item",
    ]);
  });

  it("duplicates the last list item without carrying its Page separator into the list", () => {
    const document = MarkdownBlockDocument.fromMarkdown("- one\n- two\n\nAfter\n");
    const before = document.getSnapshot();

    const result = document.apply({ type: "duplicate", blockId: before.blocks[1].id });

    expect(result.snapshot.markdown).toBe("- one\n- two\n- two\n\nAfter\n");
  });

  it("deletes a block without rewriting its neighbors", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Alpha\n\n# Remove\n\nGamma\n");
    const before = document.getSnapshot();

    const result = document.apply({ type: "delete", blockId: before.blocks[1].id });

    expect(result.snapshot.markdown).toBe("Alpha\n\nGamma\n");
    expect(result.snapshot.blocks.map((block) => block.id)).toEqual([
      before.blocks[0].id,
      before.blocks[2].id,
    ]);
  });

  it("repairs the Page boundary when deleting the last item in a list", () => {
    const document = MarkdownBlockDocument.fromMarkdown("- one\n- two\n\nAfter\n");
    const before = document.getSnapshot();

    const result = document.apply({ type: "delete", blockId: before.blocks[1].id });

    expect(result.snapshot.markdown).toBe("- one\n\nAfter\n");
    expect(
      MarkdownBlockDocument.fromMarkdown(result.snapshot.markdown).getSnapshot().blocks
    ).toHaveLength(2);
  });

  it("changes paragraph and ATX heading kind in Markdown", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Alpha\n\n");
    const blockId = document.getSnapshot().blocks[0].id;

    const heading = document.apply({
      type: "setKind",
      blockId,
      kind: "heading",
      level: 2,
    });
    expect(heading.snapshot.markdown).toBe("## Alpha\n\n");
    expect(heading.snapshot.blocks[0].level).toBe(2);

    const paragraph = document.apply({ type: "setKind", blockId, kind: "paragraph" });
    expect(paragraph.snapshot.markdown).toBe("Alpha\n\n");
    expect(paragraph.snapshot.blocks[0].kind).toBe("paragraph");
  });

  it("converts a paragraph to a bullet item and back through Markdown source", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Alpha\r\n\r\n");
    const blockId = document.getSnapshot().blocks[0].id;

    const bullet = document.apply({ type: "setKind", blockId, kind: "bullet_list_item" });
    expect(bullet.snapshot.markdown).toBe("- Alpha\r\n\r\n");
    expect(bullet.snapshot.blocks[0].kind).toBe("bullet_list_item");

    const paragraph = document.apply({ type: "setKind", blockId, kind: "paragraph" });
    expect(paragraph.snapshot.markdown).toBe("Alpha\r\n\r\n");
  });

  it("does not flatten a soft-wrapped paragraph into a false single heading", () => {
    const document = MarkdownBlockDocument.fromMarkdown("First line\nsecond line\n");
    const before = document.getSnapshot();

    expect(() =>
      document.apply({
        type: "setKind",
        blockId: before.blocks[0].id,
        kind: "heading",
        level: 2,
      })
    ).toThrow(/multi-line paragraph cannot become a heading/i);
    expect(document.getSnapshot()).toEqual(before);
  });

  it("keeps a heading split at its start reconstructable from Markdown", () => {
    const document = MarkdownBlockDocument.fromMarkdown("# Hello\n");
    const blockId = document.getSnapshot().blocks[0].id;

    const result = document.apply({ type: "split", blockId, at: 0 });
    const reopened = MarkdownBlockDocument.fromMarkdown(result.snapshot.markdown).getSnapshot();

    expect(result.snapshot.markdown).toBe("\n\n# Hello\n");
    expect(result.snapshot.blocks.map((block) => block.kind)).toEqual(["paragraph", "heading"]);
    expect(reopened.blocks.map((block) => block.kind)).toEqual(["paragraph", "heading"]);
  });

  it("inserts a new Markdown block after the active block", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Alpha\n\n# Beta\n");
    const blockId = document.getSnapshot().blocks[0].id;

    const result = document.apply({ type: "insertAfter", blockId, raw: "Next" });

    expect(result.snapshot.markdown).toBe("Alpha\n\nNext\n\n# Beta\n");
    expect(result.selection).toEqual({
      blockId: result.snapshot.blocks[1].id,
      anchor: 4,
      head: 4,
    });
  });

  it("undoes and redoes source commands without changing block ids", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Alpha\n");
    const blockId = document.getSnapshot().blocks[0].id;
    document.apply({ type: "setKind", blockId, kind: "heading", level: 2 });

    const undone = document.undo();
    expect(undone.markdown).toBe("Alpha\n");
    expect(undone.blocks[0].id).toBe(blockId);

    const redone = document.redo();
    expect(redone.markdown).toBe("## Alpha\n");
    expect(redone.blocks[0].id).toBe(blockId);
    expect(redone.revision).toBe(3);
  });
});
