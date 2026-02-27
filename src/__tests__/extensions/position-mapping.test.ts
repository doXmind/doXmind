/**
 * Tests for diff-review position mapping — structural diff for atom nodes.
 *
 * Verifies that findTextViaMarkdown correctly resolves ProseMirror positions for:
 * - Regular text changes (textContent diff fast path)
 * - Mermaid chart changes (structural diff fallback for atom nodes)
 * - Consecutive mermaid charts disambiguated via backend offset
 */
import { describe, it, expect, afterEach } from "vitest";
import { Schema, DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  findTextViaMarkdown,
  findAllTextInDocument,
  findTextInDocument,
  clearMarkdownCache,
} from "@/extensions/diff-review/position-mapping";
import { markdownToHtml } from "@/lib/markdown";
import {
  normalizeTableHtml,
  normalizeMermaidHtml,
} from "@/extensions/diff-review/replacement-utils";

// ---------------------------------------------------------------------------
// Minimal ProseMirror schema with paragraph, heading, and mermaid atom node.
// Mirrors the production schema's mermaid node (atom: true, no leafText).
// ---------------------------------------------------------------------------
const testSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      parseDOM: [{ tag: "p" }],
      toDOM() {
        return ["p", 0];
      },
    },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { level: { default: 1 } },
      parseDOM: [
        { tag: "h1", attrs: { level: 1 } },
        { tag: "h2", attrs: { level: 2 } },
        { tag: "h3", attrs: { level: 3 } },
      ],
      toDOM(node) {
        return [`h${node.attrs.level}`, 0];
      },
    },
    mermaidChart: {
      group: "block",
      atom: true,
      attrs: { code: { default: "" } },
      parseDOM: [
        {
          tag: 'div[data-type="mermaid-chart"]',
          getAttrs(dom) {
            return {
              code: (dom as HTMLElement).getAttribute("data-code") || "",
            };
          },
        },
      ],
      toDOM(node) {
        return [
          "div",
          {
            "data-type": "mermaid-chart",
            "data-code": node.attrs.code,
            class: "mermaid-chart",
          },
        ];
      },
    },
    text: { group: "inline" },
  },
  marks: {
    bold: {
      parseDOM: [{ tag: "strong" }],
      toDOM() {
        return ["strong", 0];
      },
    },
    italic: {
      parseDOM: [{ tag: "em" }],
      toDOM() {
        return ["em", 0];
      },
    },
  },
});

/** Parse markdown through the same pipeline as the production code. */
function parseMarkdownDoc(markdown: string): PMNode {
  const html = markdownToHtml(markdown);
  const el = document.createElement("div");
  el.innerHTML = html;
  normalizeTableHtml(el);
  normalizeMermaidHtml(el);
  return ProseMirrorDOMParser.fromSchema(testSchema).parse(el);
}

describe("position-mapping with atom nodes", () => {
  afterEach(() => {
    clearMarkdownCache();
  });

  // ============================================================================
  // Schema sanity checks
  // ============================================================================
  describe("test schema parsing", () => {
    it("parses plain text markdown", () => {
      const doc = parseMarkdownDoc("Hello World");
      expect(doc.content.childCount).toBe(1);
      expect(doc.content.child(0).type.name).toBe("paragraph");
      expect(doc.textContent).toBe("Hello World");
    });

    it("parses heading + paragraph", () => {
      const doc = parseMarkdownDoc("# Title\n\nSome text.");
      expect(doc.content.childCount).toBe(2);
      expect(doc.content.child(0).type.name).toBe("heading");
      expect(doc.content.child(1).type.name).toBe("paragraph");
      expect(doc.textContent).toBe("TitleSome text.");
    });

    it("parses mermaid code fence as atom node", () => {
      const md = "# Title\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nSome text.";
      const doc = parseMarkdownDoc(md);
      expect(doc.content.childCount).toBe(3);
      expect(doc.content.child(0).type.name).toBe("heading");
      expect(doc.content.child(1).type.name).toBe("mermaidChart");
      expect(doc.content.child(1).attrs.code).toContain("graph TD");
      expect(doc.content.child(2).type.name).toBe("paragraph");
    });

    it("mermaid atom node contributes nothing to textContent", () => {
      const md = "Before.\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nAfter.";
      const doc = parseMarkdownDoc(md);
      expect(doc.textContent).toBe("Before.After.");
    });

    it("parses consecutive mermaid blocks as separate nodes", () => {
      const md = [
        "# Title",
        "",
        "```mermaid",
        "graph TD",
        "  A --> B",
        "```",
        "",
        "```mermaid",
        "graph TD",
        "  C --> D",
        "```",
        "",
        "More text.",
      ].join("\n");

      const doc = parseMarkdownDoc(md);
      expect(doc.content.childCount).toBe(4);
      expect(doc.content.child(1).type.name).toBe("mermaidChart");
      expect(doc.content.child(2).type.name).toBe("mermaidChart");
      expect(doc.content.child(1).attrs.code).toContain("A");
      expect(doc.content.child(2).attrs.code).toContain("C");
    });
  });

  // ============================================================================
  // findTextInDocument — demonstrates atom limitation
  // ============================================================================
  describe("findTextInDocument limitation with atoms", () => {
    it("finds regular text", () => {
      const doc = parseMarkdownDoc("Hello World");
      expect(findTextInDocument(doc, "World")).not.toBeNull();
    });

    it("cannot find mermaid code via textContent search", () => {
      const md = "Before.\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nAfter.";
      const doc = parseMarkdownDoc(md);
      // Root cause of the bug: atom nodes are invisible to textContent
      expect(findTextInDocument(doc, "graph TD")).toBeNull();
      expect(findAllTextInDocument(doc, "graph TD")).toHaveLength(0);
    });
  });

  // ============================================================================
  // findTextViaMarkdown — regular text (fast path)
  // ============================================================================
  describe("findTextViaMarkdown — text changes", () => {
    it("finds position for text content", () => {
      const md = "Hello World. Some more text.";
      const doc = parseMarkdownDoc(md);
      const result = findTextViaMarkdown(doc, "Hello World", md, undefined, undefined, testSchema);
      expect(result).not.toBeNull();
      expect(result!.from).toBeGreaterThan(0);
      expect(result!.to).toBeGreaterThan(result!.from);
    });

    it("returns null for non-existent content", () => {
      const md = "Hello World.";
      const doc = parseMarkdownDoc(md);
      const result = findTextViaMarkdown(
        doc,
        "Does not exist",
        md,
        undefined,
        undefined,
        testSchema
      );
      expect(result).toBeNull();
    });

    it("returns null when schema is missing", () => {
      const doc = parseMarkdownDoc("Some text.");
      const result = findTextViaMarkdown(
        doc,
        "Some text",
        "Some text.",
        undefined,
        undefined,
        undefined
      );
      expect(result).toBeNull();
    });

    it("returns null for empty oldContent", () => {
      const doc = parseMarkdownDoc("Some text.");
      const result = findTextViaMarkdown(doc, "", "Some text.", undefined, undefined, testSchema);
      expect(result).toBeNull();
    });
  });

  // ============================================================================
  // findTextViaMarkdown — single mermaid chart (structural diff fallback)
  // ============================================================================
  describe("findTextViaMarkdown — single mermaid chart", () => {
    const md = [
      "Before text.",
      "",
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```",
      "",
      "After text.",
    ].join("\n");

    it("finds mermaid block position via structural diff", () => {
      const doc = parseMarkdownDoc(md);
      const oldContent = "```mermaid\ngraph TD\n  A --> B\n```";
      const result = findTextViaMarkdown(doc, oldContent, md, undefined, undefined, testSchema);
      expect(result).not.toBeNull();
      expect(result!.to).toBeGreaterThan(result!.from);
    });

    it("returned position maps to mermaid node", () => {
      const doc = parseMarkdownDoc(md);
      const oldContent = "```mermaid\ngraph TD\n  A --> B\n```";
      const result = findTextViaMarkdown(doc, oldContent, md, undefined, undefined, testSchema);
      expect(result).not.toBeNull();
      // Use resolve().nodeAfter since nodeAt doesn't work at block boundaries
      const node = doc.resolve(result!.from).nodeAfter;
      expect(node).not.toBeNull();
      expect(node!.type.name).toBe("mermaidChart");
    });
  });

  // ============================================================================
  // findTextViaMarkdown — consecutive mermaid charts (THE bug scenario)
  // ============================================================================
  describe("findTextViaMarkdown — consecutive mermaid charts", () => {
    const md = [
      "# Title",
      "",
      "Some text here.",
      "",
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```",
      "",
      "```mermaid",
      "graph TD",
      "  C --> D",
      "```",
      "",
      "More text.",
    ].join("\n");

    const firstMermaid = "```mermaid\ngraph TD\n  A --> B\n```";
    const secondMermaid = "```mermaid\ngraph TD\n  C --> D\n```";

    it("finds first mermaid block with offset", () => {
      const doc = parseMarkdownDoc(md);
      const offset = md.indexOf(firstMermaid);
      const result = findTextViaMarkdown(
        doc,
        firstMermaid,
        md,
        undefined,
        undefined,
        testSchema,
        offset
      );
      expect(result).not.toBeNull();
      const node = doc.resolve(result!.from).nodeAfter;
      expect(node).not.toBeNull();
      expect(node!.type.name).toBe("mermaidChart");
      expect(node!.attrs.code).toContain("A");
    });

    it("finds second mermaid block with offset", () => {
      const doc = parseMarkdownDoc(md);
      const offset = md.indexOf(secondMermaid);
      const result = findTextViaMarkdown(
        doc,
        secondMermaid,
        md,
        undefined,
        undefined,
        testSchema,
        offset
      );
      expect(result).not.toBeNull();
      const node = doc.resolve(result!.from).nodeAfter;
      expect(node).not.toBeNull();
      expect(node!.type.name).toBe("mermaidChart");
      expect(node!.attrs.code).toContain("C");
    });

    it("offset disambiguates — different positions returned", () => {
      const doc = parseMarkdownDoc(md);
      const firstOffset = md.indexOf(firstMermaid);
      const secondOffset = md.indexOf(secondMermaid);

      const result1 = findTextViaMarkdown(
        doc,
        firstMermaid,
        md,
        undefined,
        undefined,
        testSchema,
        firstOffset
      );
      const result2 = findTextViaMarkdown(
        doc,
        secondMermaid,
        md,
        undefined,
        undefined,
        testSchema,
        secondOffset
      );

      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      expect(result1!.from).not.toBe(result2!.from);
      expect(result1!.from).toBeLessThan(result2!.from);
    });

    it("textContent unchanged when mermaid removed (proves structural diff needed)", () => {
      const doc = parseMarkdownDoc(md);
      const withoutFirst = md.replace(firstMermaid, "");
      const docWithout = parseMarkdownDoc(withoutFirst);
      expect(doc.textContent).toBe(docWithout.textContent);
    });
  });

  // ============================================================================
  // findTextViaMarkdown — three mermaid blocks, edit middle
  // ============================================================================
  describe("findTextViaMarkdown — three mermaid blocks", () => {
    const md = [
      "Start.",
      "",
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```",
      "",
      "```mermaid",
      "sequenceDiagram",
      "  Alice ->> Bob: Hi",
      "```",
      "",
      "```mermaid",
      "graph TD",
      "  C --> D",
      "```",
      "",
      "End.",
    ].join("\n");

    it("finds middle mermaid block using offset", () => {
      const doc = parseMarkdownDoc(md);
      const middleMermaid = "```mermaid\nsequenceDiagram\n  Alice ->> Bob: Hi\n```";
      const offset = md.indexOf(middleMermaid);

      const result = findTextViaMarkdown(
        doc,
        middleMermaid,
        md,
        undefined,
        undefined,
        testSchema,
        offset
      );

      expect(result).not.toBeNull();
      const node = doc.resolve(result!.from).nodeAfter;
      expect(node).not.toBeNull();
      expect(node!.type.name).toBe("mermaidChart");
      expect(node!.attrs.code).toContain("sequenceDiagram");
    });
  });

  // ============================================================================
  // findTextViaMarkdown — mixed content
  // ============================================================================
  describe("findTextViaMarkdown — mixed content", () => {
    const md = [
      "# Title",
      "",
      "Introduction paragraph.",
      "",
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```",
      "",
      "Conclusion paragraph.",
    ].join("\n");

    it("text matching works alongside mermaid", () => {
      const doc = parseMarkdownDoc(md);
      const result = findTextViaMarkdown(
        doc,
        "Introduction paragraph.",
        md,
        undefined,
        undefined,
        testSchema
      );
      expect(result).not.toBeNull();
    });

    it("mermaid matching works alongside text", () => {
      const doc = parseMarkdownDoc(md);
      const oldContent = "```mermaid\ngraph TD\n  A --> B\n```";
      const result = findTextViaMarkdown(doc, oldContent, md, undefined, undefined, testSchema);
      expect(result).not.toBeNull();
    });
  });

  // ============================================================================
  // findTextViaMarkdown — excludePositions
  // ============================================================================
  describe("findTextViaMarkdown — excludePositions", () => {
    it("excludes structural diff result", () => {
      const md = ["Before.", "", "```mermaid", "graph TD", "  A --> B", "```", "", "After."].join(
        "\n"
      );

      const doc = parseMarkdownDoc(md);
      const oldContent = "```mermaid\ngraph TD\n  A --> B\n```";

      const result1 = findTextViaMarkdown(doc, oldContent, md, undefined, undefined, testSchema);
      expect(result1).not.toBeNull();

      const excludeSet = new Set([result1!.from]);
      const result2 = findTextViaMarkdown(doc, oldContent, md, excludeSet, undefined, testSchema);
      expect(result2).toBeNull();
    });
  });

  // ============================================================================
  // findTextViaMarkdown — markdownOffset validation
  // ============================================================================
  describe("findTextViaMarkdown — markdownOffset", () => {
    it("falls back when offset is past end", () => {
      const md = "Hello World.";
      const doc = parseMarkdownDoc(md);
      const result = findTextViaMarkdown(
        doc,
        "Hello World",
        md,
        undefined,
        undefined,
        testSchema,
        9999
      );
      expect(result).not.toBeNull();
    });

    it("falls back when offset content does not match", () => {
      const md = "AAA BBB CCC";
      const doc = parseMarkdownDoc(md);
      const result = findTextViaMarkdown(doc, "BBB", md, undefined, undefined, testSchema, 0);
      expect(result).not.toBeNull();
    });
  });
});
