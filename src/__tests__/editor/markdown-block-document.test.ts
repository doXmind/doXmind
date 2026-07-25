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

  it("projects nested list items as independent typed Blocks with logical depth", () => {
    const markdown = "- outer\n  3. ordered\n     * [x] task\n- next\n";

    const snapshot = MarkdownBlockDocument.fromMarkdown(markdown).getSnapshot();

    expect(snapshot.blocks.map(({ kind, depth, checked }) => ({ kind, depth, checked }))).toEqual([
      { kind: "bullet_list_item", depth: 0, checked: undefined },
      { kind: "ordered_list_item", depth: 1, checked: undefined },
      { kind: "task_list_item", depth: 2, checked: true },
      { kind: "bullet_list_item", depth: 0, checked: undefined },
    ]);
    expect(snapshot.blocks.map((block) => block.raw).join("")).toBe(markdown);
  });

  it("keeps list continuations on their logical item and leaves standalone raw code unlayered", () => {
    const markdown = "    - literal code\r\n\r\n- item\r\n  continuation  \r\n  - child\r\n";

    const snapshot = MarkdownBlockDocument.fromMarkdown(markdown).getSnapshot();

    expect(snapshot.blocks.map(({ kind, depth, raw }) => ({ kind, depth, raw }))).toEqual([
      { kind: "unsupported", depth: undefined, raw: "    - literal code\r\n\r\n" },
      {
        kind: "bullet_list_item",
        depth: 0,
        raw: "- item\r\n  continuation  \r\n",
      },
      { kind: "bullet_list_item", depth: 1, raw: "  - child\r\n" },
    ]);
    expect(snapshot.blocks.map((block) => block.raw).join("")).toBe(markdown);
  });

  it("indents a list Block under its previous sibling without normalizing its source", () => {
    const markdown = "- parent\r\n+ child\r\n  continuation  \r\n- after\r\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({
      type: "indentBlocks",
      blockIds: [before.blocks[1].id],
    });

    expect(result.snapshot.markdown).toBe(
      "- parent\r\n  + child\r\n    continuation  \r\n- after\r\n"
    );
    expect(result.snapshot.blocks.map(({ depth, raw }) => ({ depth, raw }))).toEqual([
      { depth: 0, raw: "- parent\r\n" },
      { depth: 1, raw: "  + child\r\n    continuation  \r\n" },
      { depth: 0, raw: "- after\r\n" },
    ]);
    expect(document.undo()).toEqual({ ...before, revision: 2 });
  });

  it("outdents a list Block with its descendants while preserving markers and CRLF", () => {
    const markdown =
      "- parent\r\n  + [X] child\r\n    continuation\r\n    7) grandchild\r\n- after\r\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({
      type: "outdentBlocks",
      blockIds: [before.blocks[1].id],
    });

    expect(result.snapshot.markdown).toBe(
      "- parent\r\n+ [X] child\r\n  continuation\r\n  7) grandchild\r\n- after\r\n"
    );
    expect(
      result.snapshot.blocks.map(({ kind, depth, checked }) => ({ kind, depth, checked }))
    ).toEqual([
      { kind: "bullet_list_item", depth: 0, checked: undefined },
      { kind: "task_list_item", depth: 0, checked: true },
      { kind: "ordered_list_item", depth: 1, checked: undefined },
      { kind: "bullet_list_item", depth: 0, checked: undefined },
    ]);
    expect(document.undo()).toEqual({ ...before, revision: 2 });
  });

  it("rejects hierarchy commands for non-list, noncontiguous, or parentless selections atomically", () => {
    const document = MarkdownBlockDocument.fromMarkdown("- one\n- two\n\nParagraph\n\n- three\n");
    const before = document.getSnapshot();

    expect(() => document.apply({ type: "indentBlocks", blockIds: [before.blocks[0].id] })).toThrow(
      /previous sibling/i
    );
    expect(() =>
      document.apply({ type: "outdentBlocks", blockIds: [before.blocks[1].id] })
    ).toThrow(/top-level/i);
    expect(() => document.apply({ type: "indentBlocks", blockIds: [before.blocks[2].id] })).toThrow(
      /only supports list/i
    );
    expect(() =>
      document.apply({
        type: "indentBlocks",
        blockIds: [before.blocks[1].id, before.blocks[3].id],
      })
    ).toThrow(/contiguous/i);

    expect(document.getSnapshot()).toEqual(before);
    expect(document.undo()).toEqual(before);
  });

  it("does not borrow an indentation parent from a previous list subtree", () => {
    const markdown = "- first parent\n  - first child\n- second parent\n  - second child\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    expect(() => document.apply({ type: "indentBlocks", blockIds: [before.blocks[3].id] })).toThrow(
      /previous sibling/i
    );
    expect(document.getSnapshot()).toEqual(before);
  });

  it("indents the complete subtree when a partial selection includes its parent", () => {
    const markdown = "- previous\n- parent\n  - first child\n  - second child\n- after\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({
      type: "indentBlocks",
      blockIds: [before.blocks[1].id, before.blocks[2].id],
    });

    expect(result.snapshot.markdown).toBe(
      "- previous\n  - parent\n    - first child\n    - second child\n- after\n"
    );
    expect(result.snapshot.blocks.map((block) => block.depth)).toEqual([0, 1, 2, 2, 0]);
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

  it("checks a deeply nested task without changing its hierarchy or indentation", () => {
    const markdown = "- parent\r\n  1. child\r\n     + [ ] deep task\r\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({
      type: "setTaskChecked",
      blockId: before.blocks[2].id,
      checked: true,
    });

    expect(result.snapshot.markdown).toBe("- parent\r\n  1. child\r\n     + [x] deep task\r\n");
    expect(result.snapshot.blocks[2]).toMatchObject({
      kind: "task_list_item",
      depth: 2,
      checked: true,
    });
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

  it("moves a list parent together with every descendant", () => {
    const markdown = "- parent\n  - child\n    1. grandchild\n- sibling\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({
      type: "move",
      blockId: before.blocks[0].id,
      beforeId: null,
    });

    expect(result.snapshot.markdown).toBe("- sibling\n- parent\n  - child\n    1. grandchild\n");
    expect(result.snapshot.blocks.map((block) => block.id)).toEqual([
      before.blocks[3].id,
      before.blocks[0].id,
      before.blocks[1].id,
      before.blocks[2].id,
    ]);
    expect(result.snapshot.blocks.map((block) => block.depth)).toEqual([0, 0, 1, 2]);
  });

  it("rejects a grouped move that cuts a list subtree", () => {
    const markdown = "- parent\n  - child\n- sibling\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    expect(() =>
      document.apply({
        type: "moveBlocks",
        blockIds: [before.blocks[0].id],
        beforeId: null,
      })
    ).toThrow(/descendants/i);
    expect(document.getSnapshot()).toEqual(before);
    expect(document.undo()).toEqual(before);
  });

  it("reprojects hierarchy when a nested item moves outside its former parent", () => {
    const document = MarkdownBlockDocument.fromMarkdown("- parent\n  - child\n- sibling\n");
    const before = document.getSnapshot();

    const result = document.apply({
      type: "move",
      blockId: before.blocks[1].id,
      beforeId: before.blocks[0].id,
    });
    const reopened = MarkdownBlockDocument.fromMarkdown(result.snapshot.markdown).getSnapshot();

    expect(result.snapshot.markdown).toBe("  - child\n- parent\n- sibling\n");
    expect(result.snapshot.blocks.map((block) => block.depth)).toEqual([0, 0, 0]);
    expect(result.snapshot.blocks.map(({ kind, depth, raw }) => ({ kind, depth, raw }))).toEqual(
      reopened.blocks.map(({ kind, depth, raw }) => ({ kind, depth, raw }))
    );
  });

  it("moves contiguous Blocks atomically while preserving ids, CRLF, and raw source", () => {
    const markdown = "Before\r\n\r\n[ref]: /exact\r\n\r\n# Move\r\n\r\nAfter\r\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({
      type: "moveBlocks",
      blockIds: [before.blocks[1].id, before.blocks[2].id],
      beforeId: before.blocks[0].id,
    });

    expect(result.snapshot.markdown).toBe(
      "[ref]: /exact\r\n\r\n# Move\r\n\r\nBefore\r\n\r\nAfter\r\n"
    );
    expect(result.snapshot.blocks.map((block) => block.id)).toEqual([
      before.blocks[1].id,
      before.blocks[2].id,
      before.blocks[0].id,
      before.blocks[3].id,
    ]);
    expect(result.selection).toEqual({
      blockId: before.blocks[1].id,
      anchor: 0,
      head: 0,
    });
    expect(document.undo()).toEqual({ ...before, revision: 2 });
  });

  it("moves a mixed raw and list Block group to the end by repairing only new boundaries", () => {
    const markdown = "Before\r\n\r\n[ref]: /exact\r\n\r\n- one\r\n- two\r\n\r\nAfter\r\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({
      type: "moveBlocks",
      blockIds: [before.blocks[1].id, before.blocks[2].id],
      beforeId: null,
    });

    expect(result.snapshot.markdown).toBe(
      "Before\r\n\r\n- two\r\n\r\nAfter\r\n\r\n[ref]: /exact\r\n\r\n- one\r\n"
    );
    expect(result.snapshot.blocks.map((block) => block.id)).toEqual([
      before.blocks[0].id,
      before.blocks[3].id,
      before.blocks[4].id,
      before.blocks[1].id,
      before.blocks[2].id,
    ]);
    expect(result.selection?.blockId).toBe(before.blocks[1].id);
    expect(document.undo()).toEqual({ ...before, revision: 2 });
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

  it("treats empty multi-Block selections as exact no-ops", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Alpha\r\n\r\nBeta\r\n");
    const before = document.getSnapshot();

    const results = [
      document.apply({ type: "deleteBlocks", blockIds: [] }),
      document.apply({ type: "duplicateBlocks", blockIds: [] }),
      document.apply({ type: "moveBlocks", blockIds: [], beforeId: "missing" }),
    ];

    for (const result of results) {
      expect(result).toEqual({ snapshot: before });
    }
    expect(document.undo()).toEqual(before);
  });

  it("rejects invalid multi-Block selections without changing source or history", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Alpha\n\nBeta\n\nGamma\n");
    const before = document.getSnapshot();
    const noncontiguous = [before.blocks[0].id, before.blocks[2].id];

    expect(() => document.apply({ type: "deleteBlocks", blockIds: noncontiguous })).toThrow(
      /contiguous Blocks in document order/i
    );
    expect(() => document.apply({ type: "duplicateBlocks", blockIds: noncontiguous })).toThrow(
      /contiguous Blocks in document order/i
    );
    expect(() =>
      document.apply({
        type: "moveBlocks",
        blockIds: noncontiguous,
        beforeId: before.blocks[1].id,
      })
    ).toThrow(/contiguous Blocks in document order/i);
    expect(() => document.apply({ type: "deleteBlocks", blockIds: ["missing"] })).toThrow(
      /unknown block/i
    );
    expect(() =>
      document.apply({
        type: "moveBlocks",
        blockIds: [before.blocks[0].id],
        beforeId: "missing",
      })
    ).toThrow(/unknown before block/i);

    expect(document.getSnapshot()).toEqual(before);
    expect(document.undo()).toEqual(before);
  });

  it("does not revise or record history when a Block group is already at its target", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Alpha\n\nBeta\n\nGamma\n");
    const before = document.getSnapshot();

    const inside = document.apply({
      type: "moveBlocks",
      blockIds: [before.blocks[0].id, before.blocks[1].id],
      beforeId: before.blocks[1].id,
    });
    const beforeNext = document.apply({
      type: "moveBlocks",
      blockIds: [before.blocks[0].id, before.blocks[1].id],
      beforeId: before.blocks[2].id,
    });
    const alreadyAtEnd = document.apply({
      type: "moveBlocks",
      blockIds: [before.blocks[1].id, before.blocks[2].id],
      beforeId: null,
    });

    expect(inside).toEqual({ snapshot: before });
    expect(beforeNext).toEqual({ snapshot: before });
    expect(alreadyAtEnd).toEqual({ snapshot: before });
    expect(document.undo()).toEqual(before);
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

  it("splits a nested list item into a same-depth source-backed sibling", () => {
    const document = MarkdownBlockDocument.fromMarkdown(
      "- Parent\r\n  - Child\r\n    - one two\r\n"
    );
    const before = document.getSnapshot();

    const result = document.apply({ type: "split", blockId: before.blocks[2].id, at: 10 });

    expect(result.snapshot.markdown).toBe("- Parent\r\n  - Child\r\n    - one \r\n    - two\r\n");
    expect(result.snapshot.blocks.map((block) => [block.kind, block.depth])).toEqual([
      ["bullet_list_item", 0],
      ["bullet_list_item", 1],
      ["bullet_list_item", 2],
      ["bullet_list_item", 2],
    ]);
    expect(result.selection).toEqual({
      blockId: result.snapshot.blocks[3].id,
      anchor: 6,
      head: 6,
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

  it("duplicates a list parent with its complete descendant subtree in one undo step", () => {
    const markdown = "- parent\r\n  + child\r\n    3) grandchild\r\n- sibling\r\n\r\nAfter\r\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({ type: "duplicate", blockId: before.blocks[0].id });

    expect(result.snapshot.markdown).toBe(
      "- parent\r\n  + child\r\n    3) grandchild\r\n" +
        "- parent\r\n  + child\r\n    3) grandchild\r\n" +
        "- sibling\r\n\r\nAfter\r\n"
    );
    expect(result.snapshot.blocks.map((block) => block.depth)).toEqual([
      0,
      1,
      2,
      0,
      1,
      2,
      0,
      undefined,
    ]);
    expect(result.snapshot.blocks.slice(0, 3).map((block) => block.raw)).toEqual(
      before.blocks.slice(0, 3).map((block) => block.raw)
    );
    expect(new Set(result.snapshot.blocks.map((block) => block.id)).size).toBe(
      result.snapshot.blocks.length
    );
    expect(result.selection?.blockId).toBe(result.snapshot.blocks[3].id);
    expect(document.undo()).toEqual({ ...before, revision: 2 });
  });

  it("duplicates contiguous Blocks atomically with exact CRLF and raw source", () => {
    const markdown = "[ref]: /exact\r\n\r\n# Two\r\n\r\nAfter\r\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({
      type: "duplicateBlocks",
      blockIds: [before.blocks[0].id, before.blocks[1].id],
    });

    expect(result.snapshot.markdown).toBe(
      "[ref]: /exact\r\n\r\n# Two\r\n\r\n[ref]: /exact\r\n\r\n# Two\r\n\r\nAfter\r\n"
    );
    const ids = result.snapshot.blocks.map((block) => block.id);
    expect(ids.slice(0, 2)).toEqual(before.blocks.slice(0, 2).map((block) => block.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.selection).toEqual({
      blockId: result.snapshot.blocks[2].id,
      anchor: 0,
      head: 0,
    });
    expect(document.undo()).toEqual({ ...before, revision: 2 });
  });

  it("expands a partial batch duplication through the selected parent's last descendant", () => {
    const markdown =
      "- root\r\n  - parent\r\n    + child\r\n      7) leaf\r\n  - after\r\n- outside\r\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({
      type: "duplicateBlocks",
      blockIds: [before.blocks[1].id, before.blocks[2].id],
    });

    expect(result.snapshot.markdown).toBe(
      "- root\r\n" +
        "  - parent\r\n    + child\r\n      7) leaf\r\n" +
        "  - parent\r\n    + child\r\n      7) leaf\r\n" +
        "  - after\r\n- outside\r\n"
    );
    expect(result.snapshot.blocks.map((block) => block.depth)).toEqual([0, 1, 2, 3, 1, 2, 3, 1, 0]);
    expect(result.selection?.blockId).toBe(result.snapshot.blocks[4].id);
    expect(document.undo()).toEqual({ ...before, revision: 2 });
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

  it("preserves an intentional loose-list CRLF boundary when duplicating a subtree", () => {
    const markdown = "- parent\r\n  + child\r\n\r\n- sibling\r\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({ type: "duplicate", blockId: before.blocks[0].id });

    expect(result.snapshot.markdown).toBe(
      "- parent\r\n  + child\r\n\r\n- parent\r\n  + child\r\n\r\n- sibling\r\n"
    );
    expect(result.snapshot.blocks.map((block) => block.depth)).toEqual([0, 1, 0, 1, 0]);
    expect(document.undo()).toEqual({ ...before, revision: 2 });
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

  it("deletes a list parent with its complete descendant subtree in one undo step", () => {
    const markdown =
      "Before\r\n\r\n- parent\r\n  + child\r\n    3) grandchild\r\n- sibling\r\n\r\nAfter\r\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({ type: "delete", blockId: before.blocks[1].id });

    expect(result.snapshot.markdown).toBe("Before\r\n\r\n- sibling\r\n\r\nAfter\r\n");
    expect(result.snapshot.blocks.map((block) => block.id)).toEqual([
      before.blocks[0].id,
      before.blocks[4].id,
      before.blocks[5].id,
    ]);
    expect(result.snapshot.blocks.map((block) => block.raw).join("")).toBe(
      result.snapshot.markdown
    );
    expect(document.undo()).toEqual({ ...before, revision: 2 });
  });

  it("deletes contiguous Blocks atomically without rewriting untouched CRLF source", () => {
    const markdown = "Before\r\n\r\n[ref]: /exact\r\n\r\n# Remove\r\n\r\nAfter\r\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({
      type: "deleteBlocks",
      blockIds: [before.blocks[1].id, before.blocks[2].id],
    });

    expect(result.snapshot.markdown).toBe("Before\r\n\r\nAfter\r\n");
    expect(result.snapshot.blocks.map((block) => block.id)).toEqual([
      before.blocks[0].id,
      before.blocks[3].id,
    ]);
    expect(result.selection).toEqual({
      blockId: before.blocks[3].id,
      anchor: 0,
      head: 0,
    });
    expect(document.undo()).toEqual({ ...before, revision: 2 });
  });

  it("replaces contiguous Blocks with parsed Markdown in one revision and undo checkpoint", () => {
    const markdown = "Before\n\nRemove one\n\nRemove two\n\nAfter\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({
      type: "replaceBlocks",
      blockIds: [before.blocks[1].id, before.blocks[2].id],
      markdown: "## Inserted\n\n- first\n- second",
    });

    expect(result.snapshot.markdown).toBe("Before\n\n## Inserted\n\n- first\n- second\n\nAfter\n");
    expect(result.snapshot.revision).toBe(1);
    expect(result.snapshot.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "heading",
      "bullet_list_item",
      "bullet_list_item",
      "paragraph",
    ]);
    expect(result.selection).toEqual({
      blockId: result.snapshot.blocks[3].id,
      anchor: "- second".length,
      head: "- second".length,
    });
    expect(document.undo()).toEqual({ ...before, revision: 2 });
  });

  it("replaces a selected list parent together with its complete descendant subtree", () => {
    const markdown = "- Parent\r\n  - Child\r\n    1. Grandchild\r\n- Sibling\r\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({
      type: "replaceBlocks",
      blockIds: [before.blocks[0].id],
      markdown: "Replacement",
    });

    expect(result.snapshot.markdown).toBe("Replacement\r\n\r\n- Sibling\r\n");
    expect(result.snapshot.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "bullet_list_item",
    ]);
    expect(result.snapshot.blocks[1].id).toBe(before.blocks[3].id);
    expect(result.selection).toEqual({
      blockId: before.blocks[0].id,
      anchor: "Replacement".length,
      head: "Replacement".length,
    });
    expect(document.undo()).toEqual({ ...before, revision: 2 });
  });

  it("expands a partial batch deletion through the selected parent's last descendant", () => {
    const markdown =
      "- root\r\n  - parent\r\n    + child\r\n      7) leaf\r\n  - after\r\n- outside\r\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({
      type: "deleteBlocks",
      blockIds: [before.blocks[1].id, before.blocks[2].id],
    });

    expect(result.snapshot.markdown).toBe("- root\r\n  - after\r\n- outside\r\n");
    expect(result.snapshot.blocks.map((block) => block.id)).toEqual([
      before.blocks[0].id,
      before.blocks[4].id,
      before.blocks[5].id,
    ]);
    expect(result.snapshot.blocks.map((block) => block.depth)).toEqual([0, 1, 0]);
    expect(document.undo()).toEqual({ ...before, revision: 2 });
  });

  it("preserves the untouched loose-list CRLF boundary around a deleted subtree", () => {
    const markdown = "- root\r\n  - before\r\n\r\n  + parent\r\n    1. child\r\n\r\n  - after\r\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({ type: "delete", blockId: before.blocks[2].id });

    expect(result.snapshot.markdown).toBe("- root\r\n  - before\r\n\r\n  - after\r\n");
    expect(result.snapshot.blocks.map((block) => block.depth)).toEqual([0, 1, 1]);
    expect(result.snapshot.blocks[1].raw).toBe("  - before\r\n\r\n");
    expect(document.undo()).toEqual({ ...before, revision: 2 });
  });

  it("keeps one empty source-backed Block when deleting the entire selection", () => {
    const markdown = "[ref]: /exact\r\n\r\n# Remove\r\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({
      type: "deleteBlocks",
      blockIds: before.blocks.map((block) => block.id),
    });

    expect(result.snapshot.markdown).toBe("");
    expect(result.snapshot.blocks).toHaveLength(1);
    expect(result.snapshot.blocks[0]).toMatchObject({
      id: before.blocks[0].id,
      kind: "paragraph",
      raw: "",
      editable: true,
    });
    expect(result.selection).toEqual({
      blockId: before.blocks[0].id,
      anchor: 0,
      head: 0,
    });
    expect(document.undo()).toEqual({ ...before, revision: 2 });
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

  it("changes a nested list kind without flattening its indentation or logical depth", () => {
    const markdown = "- root\r\n  + nested\r\n- after\r\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({
      type: "setKind",
      blockId: before.blocks[1].id,
      kind: "ordered_list_item",
    });
    const reopened = MarkdownBlockDocument.fromMarkdown(result.snapshot.markdown).getSnapshot();

    expect(result.snapshot.markdown).toBe("- root\r\n  1. nested\r\n- after\r\n");
    expect(result.snapshot.blocks.map(({ kind, depth, raw }) => ({ kind, depth, raw }))).toEqual(
      reopened.blocks.map(({ kind, depth, raw }) => ({ kind, depth, raw }))
    );
    expect(result.snapshot.blocks[1]).toMatchObject({
      id: before.blocks[1].id,
      kind: "ordered_list_item",
      depth: 1,
      raw: "  1. nested\r\n",
    });
    expect(document.undo()).toEqual({ ...before, revision: 2 });
  });

  it("keeps a nested item's exact indentation across bullet, task, and ordered kinds", () => {
    const document = MarkdownBlockDocument.fromMarkdown("- root\r\n  + nested\r\n- after\r\n");
    const blockId = document.getSnapshot().blocks[1].id;

    const task = document.apply({
      type: "setKind",
      blockId,
      kind: "task_list_item",
    }).snapshot;
    expect(task.markdown).toBe("- root\r\n  - [ ] nested\r\n- after\r\n");
    expect(task.blocks[1]).toMatchObject({ kind: "task_list_item", depth: 1, checked: false });

    const ordered = document.apply({
      type: "setKind",
      blockId,
      kind: "ordered_list_item",
    }).snapshot;
    expect(ordered.markdown).toBe("- root\r\n  1. nested\r\n- after\r\n");
    expect(ordered.blocks[1]).toMatchObject({ kind: "ordered_list_item", depth: 1 });

    const bullet = document.apply({
      type: "setKind",
      blockId,
      kind: "bullet_list_item",
    }).snapshot;
    const reopened = MarkdownBlockDocument.fromMarkdown(bullet.markdown).getSnapshot();
    expect(bullet.markdown).toBe("- root\r\n  - nested\r\n- after\r\n");
    expect(bullet.blocks[1]).toMatchObject({ kind: "bullet_list_item", depth: 1 });
    expect(bullet.blocks.map(({ kind, depth, raw }) => ({ kind, depth, raw }))).toEqual(
      reopened.blocks.map(({ kind, depth, raw }) => ({ kind, depth, raw }))
    );
  });

  it("treats an identical nested list kind as a byte-exact no-op", () => {
    const markdown = "- root\r\n  + nested\r\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({
      type: "setKind",
      blockId: before.blocks[1].id,
      kind: "bullet_list_item",
    });

    expect(result).toEqual({ snapshot: before });
    expect(document.undo()).toEqual(before);
  });

  it("adjusts only descendant indentation required by a new list marker and round-trips exactly", () => {
    const markdown = "- before\r\n- parent\r\n  + child\r\n    * grandchild\r\n- after\r\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();
    const parentId = before.blocks[1].id;

    const ordered = document.apply({
      type: "setKind",
      blockId: parentId,
      kind: "ordered_list_item",
    }).snapshot;
    const reopenedOrdered = MarkdownBlockDocument.fromMarkdown(ordered.markdown).getSnapshot();

    expect(ordered.markdown).toBe(
      "- before\r\n1. parent\r\n   + child\r\n     * grandchild\r\n- after\r\n"
    );
    expect(ordered.blocks.map((block) => block.depth)).toEqual([0, 0, 1, 2, 0]);
    expect(ordered.blocks.map(({ kind, depth, raw }) => ({ kind, depth, raw }))).toEqual(
      reopenedOrdered.blocks.map(({ kind, depth, raw }) => ({ kind, depth, raw }))
    );

    const bullet = document.apply({
      type: "setKind",
      blockId: parentId,
      kind: "bullet_list_item",
    }).snapshot;
    expect(bullet.markdown).toBe(markdown);
    expect(bullet.blocks.map((block) => block.depth)).toEqual([0, 0, 1, 2, 0]);
  });

  it("adjusts a list parent's continuation and descendants together without losing bytes", () => {
    const markdown =
      "- parent\r\n  continuation with spaces  \r\n  + child\r\n    child continuation  \r\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();
    const parentId = before.blocks[0].id;

    const ordered = document.apply({
      type: "setKind",
      blockId: parentId,
      kind: "ordered_list_item",
    }).snapshot;
    const reopened = MarkdownBlockDocument.fromMarkdown(ordered.markdown).getSnapshot();

    expect(ordered.markdown).toBe(
      "1. parent\r\n   continuation with spaces  \r\n" +
        "   + child\r\n     child continuation  \r\n"
    );
    expect(ordered.blocks.map(({ kind, depth, raw }) => ({ kind, depth, raw }))).toEqual(
      reopened.blocks.map(({ kind, depth, raw }) => ({ kind, depth, raw }))
    );

    const restored = document.apply({
      type: "setKind",
      blockId: parentId,
      kind: "bullet_list_item",
    }).snapshot;
    expect(restored.markdown).toBe(markdown);
    expect(restored.blocks.map((block) => block.id)).toEqual(
      before.blocks.map((block) => block.id)
    );
  });

  it("rejects list-to-text conversions that would orphan hierarchy before recording history", () => {
    const cases = [
      { markdown: "- root\r\n  + nested\r\n- after\r\n", blockIndex: 1 },
      { markdown: "- parent\r\n  + child\r\n- after\r\n", blockIndex: 0 },
    ] as const;
    const targets = [
      { kind: "paragraph" as const },
      { kind: "heading" as const, level: 2 as const },
      { kind: "blockquote" as const },
    ];

    for (const { markdown, blockIndex } of cases) {
      for (const target of targets) {
        const document = MarkdownBlockDocument.fromMarkdown(markdown);
        const before = document.getSnapshot();

        expect(() =>
          document.apply({
            type: "setKind",
            blockId: before.blocks[blockIndex].id,
            ...target,
          })
        ).toThrow(/list hierarchy cannot be preserved/i);
        expect(document.getSnapshot()).toEqual(before);
        expect(document.undo()).toEqual(before);
      }
    }
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

describe("typing-run history granularity", () => {
  const typeInto = (document: MarkdownBlockDocument, blockId: string, text: string) => {
    for (const char of text) {
      const block = document.getSnapshot().blocks.find((candidate) => candidate.id === blockId);
      if (!block) throw new Error("block went away");
      // Type at the end of the content, before any trailing blank line.
      const end = block.raw.replace(/(\r\n|\n|\r)+$/, "").length;
      document.apply({ type: "replaceText", blockId, range: { from: end, to: end }, text: char });
    }
  };

  it("folds a word into one undo entry and checkpoints at whitespace", () => {
    const document = MarkdownBlockDocument.fromMarkdown("");
    const blockId = document.getSnapshot().blocks[0].id;
    typeInto(document, blockId, "hello world");
    expect(document.getSnapshot().markdown).toBe("hello world");

    // One step per word, not one per character: the space is the checkpoint, so the entry recorded
    // before it holds the first word alone.
    expect(document.undo().markdown).toBe("hello");
    expect(document.undo().markdown).toBe("");
  });

  it("never folds an autoformat into the typing around it", () => {
    const document = MarkdownBlockDocument.fromMarkdown("");
    const blockId = document.getSnapshot().blocks[0].id;
    typeInto(document, blockId, "#");
    // The space is what turns the Block into a heading; it must stand alone in history.
    typeInto(document, blockId, " ");
    const headingId = document.getSnapshot().blocks[0].id;
    typeInto(document, headingId, "Title");
    expect(document.getSnapshot().blocks[0].kind).toBe("heading");

    expect(document.undo().blocks[0].raw).toBe("# ");
    // A second undo reaches the state before the space, i.e. the bare marker. Its kind is
    // `unsupported` today — a lone `#` classifying as raw is tracked separately.
    expect(document.undo().blocks[0].raw).toBe("#");
  });

  it("starts a new entry after an explicit flush", () => {
    const document = MarkdownBlockDocument.fromMarkdown("");
    const blockId = document.getSnapshot().blocks[0].id;
    typeInto(document, blockId, "ab");
    document.flushHistory();
    typeInto(document, blockId, "cd");

    expect(document.undo().markdown).toBe("ab");
    expect(document.undo().markdown).toBe("");
  });

  it("does not fold a structural command into a typing run", () => {
    const document = MarkdownBlockDocument.fromMarkdown("one\n");
    const blockId = document.getSnapshot().blocks[0].id;
    typeInto(document, blockId, "X");
    document.apply({ type: "split", blockId, at: 4 });
    expect(document.getSnapshot().blocks).toHaveLength(2);

    // The split is its own step, so one undo rejoins the Block with the typed character intact.
    const rejoined = document.undo();
    expect(rejoined.blocks).toHaveLength(1);
    expect(rejoined.blocks[0].raw.startsWith("oneX")).toBe(true);
  });

  it("folds a backspace run and stops at a word boundary", () => {
    const document = MarkdownBlockDocument.fromMarkdown("abcd\n");
    const blockId = document.getSnapshot().blocks[0].id;
    for (let remaining = 4; remaining > 1; remaining -= 1) {
      document.apply({
        type: "replaceText",
        blockId,
        range: { from: remaining - 1, to: remaining },
        text: "",
      });
    }
    expect(document.getSnapshot().blocks[0].raw.startsWith("a")).toBe(true);
    expect(document.undo().blocks[0].raw.startsWith("abcd")).toBe(true);
  });

  it("caps the undo stack", () => {
    const document = MarkdownBlockDocument.fromMarkdown("seed\n");
    const blockId = document.getSnapshot().blocks[0].id;
    for (let index = 0; index < 260; index += 1) {
      const end = document.getSnapshot().blocks[0].raw.length;
      document.apply({ type: "replaceText", blockId, range: { from: end, to: end }, text: " x" });
    }
    let steps = 0;
    let previous = document.getSnapshot().markdown;
    while (steps < 400) {
      const next = document.undo().markdown;
      if (next === previous) break;
      previous = next;
      steps += 1;
    }
    expect(steps).toBeLessThanOrEqual(200);
    expect(steps).toBeGreaterThan(150);
  });
});
