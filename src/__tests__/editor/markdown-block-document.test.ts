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

  it.each<[string, string, number]>([
    ["a tab-indented sibling", "- a\n\t- b\n\t- c\n", 2],
    ["a sibling whose marker gap is a tab", "-\ta\n-\tb\n", 1],
  ])("moves %s a whole level in one press", (_name, markdown, expectedDepth) => {
    // The parent's nesting indent is always spaces, so prefixing it to a tab-indented sibling
    // landed on the same tab stop: the file changed, the depth did not, and Tab felt dead.
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();
    const target = before.blocks.at(-1)!;

    const result = document.apply({ type: "indentBlocks", blockIds: [target.id] });

    expect(result.snapshot.blocks.at(-1)?.depth).toBe(expectedDepth);
    expect(
      MarkdownBlockDocument.fromMarkdown(result.snapshot.markdown)
        .getSnapshot()
        .blocks.map((block) => `${block.kind}@${block.depth}`)
    ).toEqual(result.snapshot.blocks.map((block) => `${block.kind}@${block.depth}`));
    expect(document.undo().markdown).toBe(markdown);
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

  it("classifies an indented ATX heading as a heading, not an unrepairable raw Block", () => {
    // The source scanner has always segmented these as heading lines. The classifier anchored at
    // column zero, so they arrived as grey `unsupported` boxes that Turn into then refused.
    const document = MarkdownBlockDocument.fromMarkdown(" # one\n  ## two\n   ### three\n");

    expect(
      document.getSnapshot().blocks.map((block) => `${block.kind}/${block.level ?? ""}`)
    ).toEqual(["heading/1", "heading/2", "heading/3"]);
    // Four columns is an indented code block in CommonMark, and must stay raw.
    expect(MarkdownBlockDocument.fromMarkdown("    # four\n").getSnapshot().blocks[0].kind).toBe(
      "unsupported"
    );
  });

  it("lets an indented heading change kind instead of stranding it", () => {
    const markdown = "  ## two\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({
      type: "setKind",
      blockId: before.blocks[0].id,
      kind: "paragraph",
    });

    expect(result.snapshot.markdown).toBe("two\n");
    expect(document.undo().markdown).toBe(markdown);
  });

  it("turns a nested list item into a paragraph and promotes what nested under it", () => {
    // The gutter offers Turn into on every list item, so refusing the nested ones left a menu
    // entry that did nothing at all. The Block leaves the list, so its subtree loses one level.
    const markdown = "- parent\n  - child\n    - grandchild\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({
      type: "setKind",
      blockId: before.blocks[1].id,
      kind: "paragraph",
    });

    expect(result.snapshot.markdown).toBe("- parent\n\nchild\n\n- grandchild\n");
    expect(result.snapshot.blocks.map(({ kind, depth }) => `${kind}@${depth ?? 0}`)).toEqual([
      "bullet_list_item@0",
      "paragraph@0",
      "bullet_list_item@0",
    ]);
    expect(document.undo().markdown).toBe(markdown);
  });

  it("turns a tab-indented nested list item into a heading", () => {
    const markdown = "- parent\n\t- child\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({
      type: "setKind",
      blockId: before.blocks[1].id,
      kind: "heading",
      level: 2,
    });

    expect(result.snapshot.markdown).toBe("- parent\n\n## child\n");
    expect(document.undo().markdown).toBe(markdown);
  });

  it("outdents a tab-indented list the way Obsidian writes one", () => {
    // Obsidian indents with tabs by default, so every nested list in an imported vault reaches
    // this path. Measuring the indentation in characters made the outdent look for a space.
    const markdown = "- parent\n\t- child\n\t\t- grandchild\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({
      type: "outdentBlocks",
      blockIds: [before.blocks[1].id],
    });

    expect(result.snapshot.markdown).toBe("- parent\n- child\n\t- grandchild\n");
    expect(result.snapshot.blocks.map((block) => block.depth)).toEqual([0, 0, 1]);
    expect(document.undo().markdown).toBe(markdown);
  });

  it("pays back the columns a straddling tab covered when outdenting", () => {
    // The child stands at column 4 behind two spaces and a tab; the parent at column 1. Removing
    // three columns cuts through the tab, so the column it covered has to come back as a space.
    const document = MarkdownBlockDocument.fromMarkdown(" - parent\n  \t- child\n");
    const before = document.getSnapshot();

    const result = document.apply({
      type: "outdentBlocks",
      blockIds: [before.blocks[1].id],
    });

    expect(result.snapshot.markdown).toBe(" - parent\n - child\n");
    expect(result.snapshot.blocks[1].depth).toBe(0);
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

  it("keeps tab-indented list depths after an edit reprojects the hierarchy", () => {
    const markdown = "- a\n\t- b\n\t\t- c\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    expect(before.blocks.map(({ kind, depth }) => ({ kind, depth }))).toEqual([
      { kind: "bullet_list_item", depth: 0 },
      { kind: "bullet_list_item", depth: 1 },
      { kind: "bullet_list_item", depth: 2 },
    ]);
    expect(before.markdown).toBe(markdown);

    const result = document.apply({
      type: "replaceText",
      blockId: before.blocks[2].id,
      range: { from: "\t\t- c".length, to: "\t\t- c".length },
      text: " edited",
    });

    expect(result.snapshot.markdown).toBe("- a\n\t- b\n\t\t- c edited\n");
    expect(result.snapshot.blocks.map((block) => block.depth)).toEqual([0, 1, 2]);
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

  it.each<[string, string]>([
    ["spaced asterisks", "* * *"],
    ["spaced dashes", "- - -"],
    ["four spaced asterisks", "* * * *"],
  ])("classifies a %s divider as a thematic break, not a bullet", (_name, divider) => {
    // The bullet pattern matches `* * *` marker-then-space, so the divider used to open a list item
    // whose text read `* *`. Splitting it then wrote a second `*` item and destroyed the rule.
    const markdown = `intro\n\n${divider}\n\nmore\n`;
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const snapshot = document.getSnapshot();

    expect(snapshot.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "thematic_break",
      "paragraph",
    ]);
    expect(snapshot.markdown).toBe(markdown);
    expect(() =>
      document.apply({ type: "split", blockId: snapshot.blocks[1].id, at: divider.length })
    ).toThrow();
    expect(document.getSnapshot().markdown).toBe(markdown);
  });

  it("still reads a short marker run as a list item", () => {
    const snapshot = MarkdownBlockDocument.fromMarkdown("- -\n\n* item\n").getSnapshot();

    expect(snapshot.blocks.map((block) => block.kind)).toEqual([
      "bullet_list_item",
      "bullet_list_item",
    ]);
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

  it.each<[string, string, string, string]>([
    ["a heading before a paragraph", "# H\n\nbody\n", "# H\n\n\n\nbody\n", "# H\n\nX\n\nbody\n"],
    [
      "a paragraph before a paragraph",
      "para\n\nnext\n",
      "para\n\n\n\nnext\n",
      "para\n\nX\n\nnext\n",
    ],
    ["the last Block on the Page", "tail\n", "tail\n\n\n", "tail\n\nX\n"],
  ])(
    "does not grow the blank-line run each time Enter ends %s",
    (_name, markdown, afterSplit, afterTyping) => {
      // The new Block holds nothing but line endings, so it cannot survive a reload — but its blank
      // lines do. Carrying the anchor's whole separator into it as well as onto the anchor left two
      // more of them behind on every cycle, without bound.
      const splitAtEnd = (source: string) => {
        const document = MarkdownBlockDocument.fromMarkdown(source);
        const first = document.getSnapshot().blocks[0];
        const content = first.raw.replace(/(?:\r\n|\n|\r)+$/, "").length;
        return { document, ...document.apply({ type: "split", blockId: first.id, at: content }) };
      };

      const once = splitAtEnd(markdown);
      expect(once.snapshot.markdown).toBe(afterSplit);
      // A tab away and back rebuilds the document from these bytes, so the cycle has to settle.
      expect(splitAtEnd(afterSplit).snapshot.markdown).toBe(afterSplit);
      // And the capped separator still keeps the new Block off its neighbours once it has text.
      expect(
        once.document.apply({
          type: "replaceText",
          blockId: once.snapshot.blocks[1].id,
          range: { from: 0, to: 0 },
          text: "X",
        }).snapshot.markdown
      ).toBe(afterTyping);
    }
  );

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

  it.each<[string, string]>([
    ["tab-indented children", "- a\n\t- b\n\t- c\n"],
    ["four-space children", "- a\n    - b\n    - c\n"],
  ])("leaves a list parent alone when unwrapping it would bury its %s", (_name, markdown) => {
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();

    const result = document.apply({ type: "mergeBackward", blockId: before.blocks[0].id });

    // Unwrapping the parent puts a blank line in front of children indented four columns, which
    // reads back as an indented code block — the children stop being list items on disk while the
    // live view still shows them. `setKind` already refuses the same intent.
    expect(result.snapshot.markdown).toBe(markdown);
    expect(result.snapshot.blocks.map((block) => `${block.kind}@${block.depth ?? "-"}`)).toEqual(
      before.blocks.map((block) => `${block.kind}@${block.depth ?? "-"}`)
    );
    expect(document.undo().markdown).toBe(markdown);
  });

  it("still unwraps a list parent whose children survive as list items", () => {
    const document = MarkdownBlockDocument.fromMarkdown("- a\n  - b\n");
    const before = document.getSnapshot();

    const result = document.apply({ type: "mergeBackward", blockId: before.blocks[0].id });

    expect(result.snapshot.markdown).toBe("a\n\n  - b\n");
    expect(
      MarkdownBlockDocument.fromMarkdown(result.snapshot.markdown)
        .getSnapshot()
        .blocks.map((block) => `${block.kind}@${block.depth ?? "-"}`)
    ).toEqual(result.snapshot.blocks.map((block) => `${block.kind}@${block.depth ?? "-"}`));
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

  it("promotes the orphaned hierarchy when a list Block converts to text, atomically", () => {
    const cases = [
      {
        markdown: "- root\r\n  + nested\r\n- after\r\n",
        blockIndex: 1,
        expected: {
          paragraph: "- root\r\n\r\nnested\r\n\r\n- after\r\n",
          heading: "- root\r\n\r\n## nested\r\n\r\n- after\r\n",
          blockquote: "- root\r\n\r\n> nested\r\n\r\n- after\r\n",
        },
      },
      {
        markdown: "- parent\r\n  + child\r\n- after\r\n",
        blockIndex: 0,
        expected: {
          paragraph: "parent\r\n\r\n+ child\r\n- after\r\n",
          heading: "## parent\r\n\r\n+ child\r\n- after\r\n",
          blockquote: "> parent\r\n\r\n+ child\r\n- after\r\n",
        },
      },
    ] as const;
    const targets = [
      { kind: "paragraph" as const },
      { kind: "heading" as const, level: 2 as const },
      { kind: "blockquote" as const },
    ];

    for (const { markdown, blockIndex, expected } of cases) {
      for (const target of targets) {
        const document = MarkdownBlockDocument.fromMarkdown(markdown);
        const before = document.getSnapshot();

        const result = document.apply({
          type: "setKind",
          blockId: before.blocks[blockIndex].id,
          ...target,
        });

        expect(result.snapshot.markdown).toBe(expected[target.kind]);
        // One command, one undo step: the promotion never lands as a separate entry.
        expect(document.undo()).toEqual({ ...before, revision: 2 });
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

describe("moveBlocks re-indents what it moves", () => {
  const move = (markdown: string, movedText: string, beforeText: string | null) => {
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const blocks = document.getSnapshot().blocks;
    const moved = blocks.find((block) => block.raw.includes(movedText));
    if (!moved) throw new Error(`no Block contains ${movedText}`);
    const beforeId =
      beforeText === null
        ? null
        : (blocks.find((block) => block.raw.includes(beforeText))?.id ?? null);
    const result = document.apply({ type: "moveBlocks", blockIds: [moved.id], beforeId });
    return {
      markdown: result.snapshot.markdown,
      kinds: MarkdownBlockDocument.fromMarkdown(result.snapshot.markdown)
        .getSnapshot()
        .blocks.map((block) => `${block.kind}@${block.depth ?? "-"}`),
    };
  };

  it("keeps a deeply nested item a list item when it moves to the top", () => {
    // Four leading spaces at the start of a Page is an indented code block, so without re-indenting
    // this drag silently turned a list item into raw code.
    const result = move("- a\n  - b\n    - c\n\nTail\n", "- c", "- a");
    expect(result.markdown).toBe("- c\n- a\n  - b\n\nTail\n");
    expect(result.kinds).toEqual([
      "bullet_list_item@0",
      "bullet_list_item@0",
      "bullet_list_item@1",
      "paragraph@-",
    ]);
  });

  it("clamps to one level deeper than the item it lands under", () => {
    const result = move("- a\n\n- x\n  - y\n    - z\n", "- z", "- y");
    expect(MarkdownBlockDocument.fromMarkdown(result.markdown).getSnapshot().blocks[3].depth).toBe(
      1
    );
  });

  it("preserves nesting inside the moved range", () => {
    const document = MarkdownBlockDocument.fromMarkdown("- p\n  - q\n    - r\n\nTail\n");
    const blocks = document.getSnapshot().blocks;
    const q = blocks.find((block) => block.raw.includes("- q"))!;
    const r = blocks.find((block) => block.raw.includes("- r"))!;
    const p = blocks.find((block) => block.raw.startsWith("- p"))!;
    const result = document.apply({
      type: "moveBlocks",
      blockIds: [q.id, r.id],
      beforeId: p.id,
    });
    // The range flattens by one so `q` is valid at top level, and `r` stays one level under it.
    expect(
      MarkdownBlockDocument.fromMarkdown(result.snapshot.markdown)
        .getSnapshot()
        .blocks.map((block) => `${block.kind}@${block.depth ?? "-"}`)
    ).toEqual(["bullet_list_item@0", "bullet_list_item@1", "bullet_list_item@0", "paragraph@-"]);
  });

  it("refuses the move when the re-indented range cannot be validated", () => {
    // Landing next to a thematic break re-segments the candidate, so the correct dedent to `- c`
    // cannot be verified. Committing the un-shifted `    - c` would have written an indented code
    // block into the Page while the live view still called it a list item.
    const markdown = "# Notes\n\nSome intro.\n\n---\n\n- a\n  - b\n    - c\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const blocks = document.getSnapshot().blocks;
    const moved = blocks.find((block) => block.raw.includes("- c"))!;
    const before = blocks.find((block) => block.raw.startsWith("---"))!;

    const result = document.apply({
      type: "moveBlocks",
      blockIds: [moved.id],
      beforeId: before.id,
    });

    expect(result.snapshot.markdown).toBe(markdown);
    expect(document.undo().markdown).toBe(markdown);
  });

  it("leaves a paragraph move's own bytes untouched", () => {
    const result = move("one\n\ntwo\n\nthree\n", "three", "one");
    // The trailing blank line is `ensureBlockBoundary` normalising the new last Block, unrelated to
    // re-indenting; what matters is that no indentation was added or removed.
    expect(result.markdown).toBe("three\n\none\n\ntwo\n\n");
    expect(result.kinds).toEqual(["paragraph@-", "paragraph@-", "paragraph@-"]);
  });
});

describe("pasted Markdown keeps the depth the scanner measured", () => {
  it.each([
    ["two-space nesting", "- Parent\n  - Child\n    - Grandchild\n", [0, 1, 2]],
    ["four levels", "- a\n  - b\n    - c\n      - d\n", [0, 1, 2, 3]],
    ["ordered under bullet", "- a\n  1. b\n     - c\n", [0, 1, 2]],
  ])("pastes %s at the right depths", (_label, markdown, depths) => {
    const document = MarkdownBlockDocument.fromMarkdown("");
    const blockId = document.getSnapshot().blocks[0].id;
    const result = document.apply({
      type: "replaceText",
      blockId,
      range: { from: 0, to: 0 },
      text: markdown,
    });
    // A span classified on its own text loses its depth — `    - c` alone is an indented code
    // block — so pasting a nested list used to drop its deepest items to raw source.
    expect(result.snapshot.blocks.map((block) => block.depth)).toEqual(depths);
    expect(
      result.snapshot.blocks.every(
        (block) => block.kind === "bullet_list_item" || block.kind === "ordered_list_item"
      )
    ).toBe(true);
    expect(result.snapshot.markdown).toBe(markdown);
    // And it matches what opening the same bytes from disk produces.
    expect(
      MarkdownBlockDocument.fromMarkdown(markdown)
        .getSnapshot()
        .blocks.map((b) => b.depth)
    ).toEqual(depths);
  });

  it("still treats a genuine indented code block as raw", () => {
    const document = MarkdownBlockDocument.fromMarkdown("");
    const blockId = document.getSnapshot().blocks[0].id;
    const result = document.apply({
      type: "replaceText",
      blockId,
      range: { from: 0, to: 0 },
      text: "text\n\n    code line\n",
    });
    expect(result.snapshot.blocks.map((block) => block.kind)).toEqual(["paragraph", "unsupported"]);
    expect(result.snapshot.markdown).toBe("text\n\n    code line\n");
  });
});

describe("replaceBlocks converts a whole range in one revision", () => {
  it("re-prefixes every Block and keeps source-only Blocks byte-identical", () => {
    // This is the shape the Block-selection toolbar's Turn into produces: one command over the
    // whole range, so a multi-Block conversion is a single undo step.
    const markdown = "one\n\ntwo\n\n---\n\nthree\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const before = document.getSnapshot();
    const blockIds = before.blocks.map((block) => block.id);
    const converted = before.blocks
      .map((block) => (block.kind === "thematic_break" ? block.raw : `- ${block.raw.trim()}\n\n`))
      .join("");
    const result = document.apply({ type: "replaceBlocks", blockIds, markdown: converted });

    expect(result.snapshot.blocks.map((block) => block.kind)).toEqual([
      "bullet_list_item",
      "bullet_list_item",
      "thematic_break",
      "bullet_list_item",
    ]);
    expect(result.snapshot.revision).toBe(before.revision + 1);
    expect(document.undo().markdown).toBe(markdown);
  });
});

describe("setext headings", () => {
  const markdown = "Setext H1\n=========\n\nbody\n\n## ATX H2\n\nmore\n";

  it("reports the underlined Block as a heading with its own level", () => {
    const snapshot = MarkdownBlockDocument.fromMarkdown(markdown).getSnapshot();

    expect(snapshot.blocks.map((block) => [block.kind, block.level])).toEqual([
      ["heading", 1],
      ["paragraph", undefined],
      ["heading", 2],
      ["paragraph", undefined],
    ]);
    expect(snapshot.markdown).toBe(markdown);
  });

  it("keeps the underline attached when the heading text is edited", () => {
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const heading = document.getSnapshot().blocks[0];

    const result = document.apply({
      type: "replaceText",
      blockId: heading.id,
      range: { from: 7, to: 9 },
      text: "One",
    });

    expect(result.snapshot.markdown).toBe("Setext One\n=========\n\nbody\n\n## ATX H2\n\nmore\n");
    expect(result.snapshot.blocks[0]).toMatchObject({ kind: "heading", level: 1 });
  });

  it("drops the underline when the heading is turned into a paragraph", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Setext H2\n---\n\nbody\n");
    const heading = document.getSnapshot().blocks[0];

    const result = document.apply({ type: "setKind", blockId: heading.id, kind: "paragraph" });

    expect(result.snapshot.markdown).toBe("Setext H2\n\nbody\n");
    expect(result.snapshot.blocks.map((block) => block.kind)).toEqual(["paragraph", "paragraph"]);
  });

  it("writes an ATX marker when the heading level is set explicitly", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Setext H1\n===\n\nbody\n");
    const heading = document.getSnapshot().blocks[0];

    const result = document.apply({
      type: "setKind",
      blockId: heading.id,
      kind: "heading",
      level: 3,
    });

    expect(result.snapshot.markdown).toBe("### Setext H1\n\nbody\n");
    expect(result.snapshot.blocks[0]).toMatchObject({ kind: "heading", level: 3 });
  });

  it("starts an ordinary paragraph when Enter lands at the end of the heading", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Setext H1\n===\n\nbody\n");
    const heading = document.getSnapshot().blocks[0];

    const result = document.apply({
      type: "split",
      blockId: heading.id,
      at: "Setext H1\n===".length,
    });

    expect(result.snapshot.blocks.map((block) => [block.kind, block.level])).toEqual([
      ["heading", 1],
      ["paragraph", undefined],
      ["paragraph", undefined],
    ]);
    expect(result.snapshot.blocks[0].raw).toBe("Setext H1\n===\n\n");
  });

  it("merges the heading's text without carrying its underline into the Block above", () => {
    const document = MarkdownBlockDocument.fromMarkdown("Alpha\n\nSetext H1\n===\n");
    const heading = document.getSnapshot().blocks[1];

    const result = document.apply({ type: "mergeBackward", blockId: heading.id });

    expect(result.snapshot.markdown).toBe("AlphaSetext H1\n");
    expect(result.snapshot.blocks.map((block) => block.kind)).toEqual(["paragraph"]);
  });

  it("leaves Backspace inert at the start of the Block under the heading", () => {
    const markdown = "Setext H1\n===\n\nbody\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const body = document.getSnapshot().blocks[1];

    // Joining the text onto the underline would stop it being one, quietly demoting the heading.
    expect(document.apply({ type: "mergeBackward", blockId: body.id }).snapshot.markdown).toBe(
      markdown
    );
  });
});

describe("a move keeps the looseness of the list it touches", () => {
  const moveBlocks = (markdown: string, movedText: string, beforeText: string | null) => {
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const blocks = document.getSnapshot().blocks;
    const moved = blocks.find((block) => block.raw.includes(movedText));
    if (!moved) throw new Error(`no Block contains ${movedText}`);
    const beforeId =
      beforeText === null
        ? null
        : (blocks.find((block) => block.raw.includes(beforeText))?.id ?? null);
    return document.apply({ type: "moveBlocks", blockIds: [moved.id], beforeId }).snapshot.markdown;
  };

  it("keeps a loose list loose when one of its items moves", () => {
    // Alt+ArrowDown on the first item used to collapse both junctions it touched, rewriting a list
    // the user had deliberately spaced out into a tight one.
    expect(moveBlocks("- alpha\n\n- beta\n\n- gamma\n", "alpha", "gamma")).toBe(
      "- beta\n\n- alpha\n\n- gamma\n"
    );
  });

  it("keeps a tight list tight when an item lands in it from a looser junction", () => {
    // `- two` carried the blank line that separated the list from `After`; that separator belongs
    // to the boundary it left behind, not to the item.
    expect(moveBlocks("- one\n- two\n\nAfter\n", "two", "one")).toBe("- two\n- one\n\nAfter\n");
  });
});

describe("a drop that would reinterpret the Blocks under it is refused", () => {
  it("refuses a paragraph dropped between two nested list items", () => {
    // `  - beta two` keeps its two leading spaces, but a paragraph in front of it ends the list, so
    // those spaces stop meaning "child of beta" and the item silently jumps to the top level.
    const markdown = "- alpha\n- beta\n  - beta one\n  - beta two\n- gamma\n\nTail paragraph\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const blocks = document.getSnapshot().blocks;
    const moved = blocks.find((block) => block.raw.includes("Tail paragraph"))!;
    const before = blocks.find((block) => block.raw.includes("beta two"))!;

    const result = document.apply({
      type: "moveBlocks",
      blockIds: [moved.id],
      beforeId: before.id,
    });

    expect(result.snapshot.markdown).toBe(markdown);
    expect(document.undo().markdown).toBe(markdown);
  });

  it("still allows a paragraph dropped between two top-level list items", () => {
    const markdown = "- alpha\n- beta\n\nTail paragraph\n";
    const document = MarkdownBlockDocument.fromMarkdown(markdown);
    const blocks = document.getSnapshot().blocks;
    const moved = blocks.find((block) => block.raw.includes("Tail paragraph"))!;
    const before = blocks.find((block) => block.raw.includes("beta"))!;

    const result = document.apply({
      type: "moveBlocks",
      blockIds: [moved.id],
      beforeId: before.id,
    });

    // The blank line at EOF is the separate, still-open trailing-separator defect; what this pins
    // is that a drop whose neighbours all keep their meaning is not refused.
    expect(result.snapshot.markdown).toBe("- alpha\n\nTail paragraph\n\n- beta\n\n");
    expect(
      MarkdownBlockDocument.fromMarkdown(result.snapshot.markdown)
        .getSnapshot()
        .blocks.map((block) => `${block.kind}@${block.depth ?? "-"}`)
    ).toEqual(["bullet_list_item@0", "paragraph@-", "bullet_list_item@0"]);
  });
});
