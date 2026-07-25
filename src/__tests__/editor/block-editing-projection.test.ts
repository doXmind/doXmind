import { describe, expect, it } from "vitest";

import {
  createBlockEditingProjection,
  splitDelimitedBlockSource,
} from "@/editor/markdown-block/block-editing-projection";
import {
  MarkdownBlockDocument,
  type MarkdownBlockView,
} from "@/editor/markdown-block/markdown-block-document";

function firstBlock(markdown: string) {
  return MarkdownBlockDocument.fromMarkdown(markdown).getSnapshot().blocks[0];
}

describe("BlockEditingProjection", () => {
  it("edits a paragraph payload while preserving its authored separator", () => {
    const projection = createBlockEditingProjection(firstBlock("Plain text\n\n"));

    expect(projection.editorText).toBe("Plain text");
    expect(projection.sourcePrefix).toBe("");
    expect(projection.sourceSuffix).toBe("\n\n");
    expect(projection.toSource("Changed")).toBe("Changed\n\n");
  });

  it("hides an ATX heading marker without normalizing its spacing or CRLF separator", () => {
    const projection = createBlockEditingProjection(firstBlock("### \tRoadmap 🚀\r\n\r\n"));

    expect(projection.editorText).toBe("Roadmap 🚀");
    expect(projection.sourcePrefix).toBe("### \t");
    expect(projection.sourceSuffix).toBe("\r\n\r\n");
    expect(projection.toSource("Launch 🚀")).toBe("### \tLaunch 🚀\r\n\r\n");
  });

  it("hides a nested list prefix while preserving its exact hierarchy bytes", () => {
    const blocks = MarkdownBlockDocument.fromMarkdown(
      "- Parent\r\n  - [x] Nested task\r\n"
    ).getSnapshot().blocks;
    const projection = createBlockEditingProjection(blocks[1]);

    expect(projection.editorText).toBe("Nested task");
    expect(projection.sourcePrefix).toBe("  - [x] ");
    expect(projection.toSource("Changed")).toBe("  - [x] Changed\r\n");
  });

  it("keeps an inline image semantic inside a list payload", () => {
    const projection = createBlockEditingProjection(
      firstBlock("- Inline image: ![Smoke pixel](assets/smoke.png).\n\n")
    );

    expect(projection.editorText).toBe("Inline image: ![Smoke pixel](assets/smoke.png).");
    expect(projection.sourcePrefix).toBe("- ");
  });

  it.each([
    {
      source: "  +\tBullet\n",
      prefix: "  +\t",
      payload: "Bullet",
    },
    {
      source: "007)\tOrdered\r\n",
      prefix: "007)\t",
      payload: "Ordered",
    },
    {
      source: "* \t[X]\tDone\r\n\r\n",
      prefix: "* \t[X]\t",
      payload: "Done",
    },
    {
      source: "  >\tQuoted\r\n\r\n",
      prefix: "  >\t",
      payload: "Quoted",
    },
  ])("preserves the exact structural prefix in $source", ({ source, prefix, payload }) => {
    const projection = createBlockEditingProjection(firstBlock(source));
    const suffix = source.slice(prefix.length + payload.length);

    expect(projection.editorText).toBe(payload);
    expect(projection.sourcePrefix).toBe(prefix);
    expect(projection.sourceSuffix).toBe(suffix);
    expect(projection.toSource("Changed")).toBe(`${prefix}Changed${suffix}`);
  });

  it.each(["[reference]: /target\r\n\r\n", "> first line\r\n> second line\r\n\r\n"])(
    "keeps a raw or structurally complex Page separator outside its editor",
    (source) => {
      const projection = createBlockEditingProjection(firstBlock(source));
      const separator = source.match(/(?:\r\n|\n|\r){2}$/)?.[0] ?? "";
      const editableSource = source.slice(0, -separator.length);

      expect(projection.editorText).toBe(editableSource);
      expect(projection.sourcePrefix).toBe("");
      expect(projection.sourceSuffix).toBe(separator);
      expect(projection.toSource("exact replacement")).toBe(`exact replacement${separator}`);
      expect(projection.editorOffsetToSource(source.length)).toBe(editableSource.length);
      expect(projection.sourceOffsetToEditor(source.length)).toBe(editableSource.length);
    }
  );

  it("maps emoji and selection ranges with UTF-16 offsets across prefix and CRLF suffix", () => {
    const source = "## 🚀 launch\r\n\r\n";
    const projection = createBlockEditingProjection(firstBlock(source));
    const prefixLength = "## ".length;
    const editorLength = "🚀 launch".length;

    expect(projection.editorOffsetToSource(0)).toBe(prefixLength);
    expect(projection.editorOffsetToSource(-100)).toBe(prefixLength);
    expect(projection.editorOffsetToSource("🚀".length)).toBe(prefixLength + "🚀".length);
    expect(projection.editorOffsetToSource(editorLength + 100)).toBe(prefixLength + editorLength);
    expect(projection.sourceOffsetToEditor(0)).toBe(0);
    expect(projection.sourceOffsetToEditor(prefixLength - 1)).toBe(0);
    expect(projection.sourceOffsetToEditor(prefixLength + "🚀".length)).toBe("🚀".length);
    expect(projection.sourceOffsetToEditor(source.length)).toBe(editorLength);
    expect(projection.editorRangeToSource({ from: 0, to: "🚀".length })).toEqual({
      from: prefixLength,
      to: prefixLength + "🚀".length,
    });
    expect(
      projection.sourceRangeToEditor({
        from: prefixLength - 1,
        to: source.length - 1,
      })
    ).toEqual({ from: 0, to: editorLength });
  });

  it.each([
    "Paragraph\n\n",
    "###### Heading\r\n\r\n",
    "- Bullet\n",
    "3. Ordered\r\n",
    "+ [ ] Task\n",
    "> Quote\r\n\r\n",
    "<custom raw>\r\n\r\n",
  ])("round-trips untouched editor text to the exact canonical source", (source) => {
    const block = firstBlock(source);
    const projection = createBlockEditingProjection(block);

    expect(projection.toSource(projection.editorText)).toBe(block.raw);
  });
});

describe("delimited Block payload projection", () => {
  const cases: ReadonlyArray<[string, string, string, string, string]> = [
    [
      "fenced code with an info string",
      "fenced_code",
      "```ts\nconst a = 1;\n```\n\n",
      "const a = 1;",
      "ts",
    ],
    ["bare fenced code", "fenced_code", "```\nplain\n```\n", "plain", ""],
    ["tilde fence", "fenced_code", "~~~py\nx = 1\n~~~\n", "x = 1", "py"],
    ["multi-line payload", "fenced_code", "```js\na\n\nb\n```\n", "a\n\nb", "js"],
    ["empty payload", "fenced_code", "```\n\n```\n", "", ""],
    ["unterminated fence", "fenced_code", "```ts\nconst a = 1;\n", "const a = 1;", "ts"],
    [
      "mermaid",
      "mermaid",
      "```mermaid\nflowchart LR\n  A --> B\n```\n",
      "flowchart LR\n  A --> B",
      "mermaid",
    ],
    ["CRLF fence", "fenced_code", "```ts\r\nconst a = 1;\r\n```\r\n", "const a = 1;", "ts"],
  ];

  it.each(cases)("projects %s to its payload and back", (_label, kind, raw, payload) => {
    const projection = createBlockEditingProjection({
      kind: kind as MarkdownBlockView["kind"],
      raw,
    });
    expect(projection.editorText).toBe(payload);
    // The delimiters must survive byte-for-byte, or an edit would re-cut the Block.
    expect(projection.toSource(projection.editorText)).toBe(raw);
  });

  it.each(cases)("exposes the info string of %s", (_label, kind, raw, _payload, info) => {
    expect(
      splitDelimitedBlockSource(kind as MarkdownBlockView["kind"], raw.trimEnd())?.infoString
    ).toBe(info);
  });

  it("rewrites only the payload", () => {
    const projection = createBlockEditingProjection({
      kind: "fenced_code",
      raw: "```ts\nold\n```\n\n",
    });
    expect(projection.toSource("new\nlines")).toBe("```ts\nnew\nlines\n```\n\n");
  });

  it("fails closed when a payload line could pass for the closing fence", () => {
    // Two candidate closing lines: projecting would let an edit move where the Block ends.
    const raw = "````\n```\ninner\n````\n";
    expect(splitDelimitedBlockSource("fenced_code", raw.trimEnd())).not.toBeNull();
    const ambiguous = "```\n```\n```\n";
    expect(splitDelimitedBlockSource("fenced_code", ambiguous.trimEnd())).toBeNull();
    const projection = createBlockEditingProjection({ kind: "fenced_code", raw: ambiguous });
    expect(projection.editorText).toBe(ambiguous.trimEnd());
  });

  it("leaves non-delimited kinds alone", () => {
    expect(splitDelimitedBlockSource("paragraph", "text")).toBeNull();
    expect(splitDelimitedBlockSource("table", "| a |")).toBeNull();
  });
});

describe("delimited Block payload projection survives deletion", () => {
  it.each([
    ["fenced_code", "```ts\nconst a = 1;\n```\n"],
    ["mermaid", "```mermaid\nflowchart LR\n  A --> B\n```\n"],
  ])("keeps %s one Block after its payload is deleted", (kind, markdown) => {
    const [block] = MarkdownBlockDocument.fromMarkdown(markdown).getSnapshot().blocks;
    const emptied = createBlockEditingProjection(block).toSource("");
    expect(
      MarkdownBlockDocument.fromMarkdown(emptied)
        .getSnapshot()
        .blocks.map((b) => b.kind)
    ).toEqual([kind]);
  });

  it("leaves block math delimited, because an empty $$ payload splits the Block", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown("$$\nE = mc^2\n$$\n").getSnapshot().blocks;
    // Projecting `$$` out would let a delete produce "$$\n\n$$" — a blank line between two
    // paragraphs — so the delimiters stay part of the editor text.
    expect(splitDelimitedBlockSource("block_math", "$$\nE = mc^2\n$$")).toBeNull();
    expect(createBlockEditingProjection(block).editorText).toBe("$$\nE = mc^2\n$$");
  });
});
