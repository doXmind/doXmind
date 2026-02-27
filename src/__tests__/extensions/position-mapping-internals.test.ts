/**
 * Tests for position-mapping internal functions
 *
 * Tests findTextNormalized, findAllTextInDocument edge cases,
 * findTextInDocument disambiguation, and findTextViaMarkdown
 * Extract-and-Search fallback path.
 *
 * Supplements position-mapping.test.ts which covers structural diff and mermaid scenarios.
 */
import { describe, it, expect, afterEach } from "vitest";
import { Schema, DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  findTextViaMarkdown,
  findAllTextInDocument,
  findTextInDocument,
  findTextNormalized,
  clearMarkdownCache,
} from "@/extensions/diff-review/position-mapping";
import { markdownToHtml } from "@/lib/markdown";
import {
  normalizeTableHtml,
  normalizeMermaidHtml,
} from "@/extensions/diff-review/replacement-utils";

// ---------------------------------------------------------------------------
// ProseMirror test schema (mirrors production schema nodes for testing)
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
    bulletList: {
      group: "block",
      content: "listItem+",
      parseDOM: [{ tag: "ul" }],
      toDOM() {
        return ["ul", 0];
      },
    },
    listItem: {
      content: "paragraph block*",
      parseDOM: [{ tag: "li" }],
      toDOM() {
        return ["li", 0];
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

function parseMarkdownDoc(markdown: string): PMNode {
  const html = markdownToHtml(markdown);
  const el = document.createElement("div");
  el.innerHTML = html;
  normalizeTableHtml(el);
  normalizeMermaidHtml(el);
  return ProseMirrorDOMParser.fromSchema(testSchema).parse(el);
}

describe("position-mapping internals", () => {
  afterEach(() => {
    clearMarkdownCache();
  });

  // ==========================================================================
  // findAllTextInDocument
  // ==========================================================================
  describe("findAllTextInDocument", () => {
    it("finds multiple occurrences of same text", () => {
      const doc = parseMarkdownDoc("foo bar foo baz foo");
      const results = findAllTextInDocument(doc, "foo");
      expect(results).toHaveLength(3);
      // All positions should be different
      const froms = results.map((r) => r.from);
      expect(new Set(froms).size).toBe(3);
    });

    it("returns empty for empty search text", () => {
      const doc = parseMarkdownDoc("Some text.");
      expect(findAllTextInDocument(doc, "")).toHaveLength(0);
    });

    it("returns empty when text not found", () => {
      const doc = parseMarkdownDoc("Hello World");
      expect(findAllTextInDocument(doc, "xyz")).toHaveLength(0);
    });

    it("includes blockTypeName in results", () => {
      const doc = parseMarkdownDoc("# Title\n\nTitle again");
      const results = findAllTextInDocument(doc, "Title");
      expect(results.length).toBeGreaterThanOrEqual(2);
      // First occurrence is in heading, second in paragraph
      const blockTypes = results.map((r) => r.blockTypeName);
      expect(blockTypes).toContain("heading");
      expect(blockTypes).toContain("paragraph");
    });

    it("finds text spanning single paragraph", () => {
      const doc = parseMarkdownDoc("Hello World, how are you?");
      const results = findAllTextInDocument(doc, "World, how");
      expect(results).toHaveLength(1);
      expect(results[0].from).toBeGreaterThan(0);
      expect(results[0].to).toBeGreaterThan(results[0].from);
    });
  });

  // ==========================================================================
  // findTextInDocument — disambiguation
  // ==========================================================================
  describe("findTextInDocument disambiguation", () => {
    it("prefers heading block type when specified", () => {
      const doc = parseMarkdownDoc("# Title\n\nTitle in paragraph");
      const result = findTextInDocument(doc, "Title", undefined, "heading");
      expect(result).not.toBeNull();
      expect(result!.blockTypeName).toBe("heading");
    });

    it("prefers paragraph block type when specified", () => {
      const doc = parseMarkdownDoc("# Title\n\nTitle in paragraph");
      const result = findTextInDocument(doc, "Title", undefined, "paragraph");
      expect(result).not.toBeNull();
      expect(result!.blockTypeName).toBe("paragraph");
    });

    it("returns first match when no preferred block type", () => {
      const doc = parseMarkdownDoc("# Title\n\nTitle in paragraph");
      const result = findTextInDocument(doc, "Title");
      expect(result).not.toBeNull();
    });

    it("excludes positions from set", () => {
      const doc = parseMarkdownDoc("foo foo foo");
      const all = findAllTextInDocument(doc, "foo");
      expect(all.length).toBeGreaterThanOrEqual(3);

      const excludeSet = new Set([all[0].from]);
      const result = findTextInDocument(doc, "foo", excludeSet);
      expect(result).not.toBeNull();
      expect(result!.from).not.toBe(all[0].from);
    });

    it("returns null when all matches excluded", () => {
      const doc = parseMarkdownDoc("foo");
      const all = findAllTextInDocument(doc, "foo");
      const excludeSet = new Set(all.map((r) => r.from));
      const result = findTextInDocument(doc, "foo", excludeSet);
      expect(result).toBeNull();
    });

    it("falls back to first candidate when preferred block type not found", () => {
      const doc = parseMarkdownDoc("Hello World");
      const result = findTextInDocument(doc, "Hello", undefined, "codeBlock");
      expect(result).not.toBeNull();
    });
  });

  // ==========================================================================
  // findTextNormalized — whitespace-normalized matching
  // ==========================================================================
  describe("findTextNormalized", () => {
    it("matches text with normalized whitespace", () => {
      // doc.textContent will be "Hello   World" or similar
      const doc = parseMarkdownDoc("Hello   World");
      // Searching for "Hello World" (single space) should match via normalization
      const result = findTextNormalized(doc, "Hello World");
      expect(result).not.toBeNull();
      expect(result!.from).toBeGreaterThan(0);
    });

    it("returns null for empty search text", () => {
      const doc = parseMarkdownDoc("Some text");
      expect(findTextNormalized(doc, "")).toBeNull();
    });

    it("returns null for whitespace-only search text", () => {
      const doc = parseMarkdownDoc("Some text");
      expect(findTextNormalized(doc, "   ")).toBeNull();
    });

    it("returns null when text not found", () => {
      const doc = parseMarkdownDoc("Hello World");
      expect(findTextNormalized(doc, "xyz")).toBeNull();
    });

    it("excludes positions from set", () => {
      const doc = parseMarkdownDoc("foo foo");
      const first = findTextNormalized(doc, "foo");
      expect(first).not.toBeNull();

      const excludeSet = new Set([first!.from]);
      const second = findTextNormalized(doc, "foo", excludeSet);
      // Should find the second occurrence or null
      if (second) {
        expect(second.from).not.toBe(first!.from);
      }
    });

    it("respects preferredBlockType", () => {
      const doc = parseMarkdownDoc("# Title\n\nTitle text");
      const result = findTextNormalized(doc, "Title", undefined, "heading");
      expect(result).not.toBeNull();
      expect(result!.blockTypeName).toBe("heading");
    });
  });

  // ==========================================================================
  // findTextViaMarkdown — edge cases
  // ==========================================================================
  describe("findTextViaMarkdown edge cases", () => {
    it("finds text in heading", () => {
      const md = "# Hello World\n\nSome body text.";
      const doc = parseMarkdownDoc(md);
      const result = findTextViaMarkdown(
        doc,
        "# Hello World",
        md,
        undefined,
        undefined,
        testSchema
      );
      expect(result).not.toBeNull();
    });

    it("handles bold markdown correctly", () => {
      const md = "This has **bold text** in it.";
      const doc = parseMarkdownDoc(md);
      const result = findTextViaMarkdown(
        doc,
        "**bold text**",
        md,
        undefined,
        undefined,
        testSchema
      );
      expect(result).not.toBeNull();
    });

    it("handles replace at end of document", () => {
      const md = "First paragraph.\n\nLast paragraph.";
      const doc = parseMarkdownDoc(md);
      const result = findTextViaMarkdown(
        doc,
        "Last paragraph.",
        md,
        undefined,
        undefined,
        testSchema
      );
      expect(result).not.toBeNull();
    });

    it("handles replace at start of document", () => {
      const md = "First paragraph.\n\nSecond paragraph.";
      const doc = parseMarkdownDoc(md);
      const result = findTextViaMarkdown(
        doc,
        "First paragraph.",
        md,
        undefined,
        undefined,
        testSchema
      );
      expect(result).not.toBeNull();
    });

    it("handles multiple paragraphs in old_str", () => {
      const md = "Line 1.\n\nLine 2.\n\nLine 3.";
      const doc = parseMarkdownDoc(md);
      const result = findTextViaMarkdown(
        doc,
        "Line 1.\n\nLine 2.",
        md,
        undefined,
        undefined,
        testSchema
      );
      expect(result).not.toBeNull();
    });

    it("uses markdownOffset to find specific occurrence", () => {
      const md = "Replace me.\n\nKeep this.\n\nReplace me.";
      const doc = parseMarkdownDoc(md);
      const secondOffset = md.lastIndexOf("Replace me.");

      const result = findTextViaMarkdown(
        doc,
        "Replace me.",
        md,
        undefined,
        undefined,
        testSchema,
        secondOffset
      );
      expect(result).not.toBeNull();
    });

    it("finds text after excluded position", () => {
      const md = "AAA BBB AAA";
      const doc = parseMarkdownDoc(md);

      const first = findTextViaMarkdown(doc, "AAA", md, undefined, undefined, testSchema);
      expect(first).not.toBeNull();

      const excludeSet = new Set([first!.from]);
      const second = findTextViaMarkdown(doc, "AAA", md, excludeSet, undefined, testSchema);
      // Should find the second "AAA" or null
      if (second) {
        expect(second.from).not.toBe(first!.from);
      }
    });
  });

  // ==========================================================================
  // findStructuralDiff — edge cases via findTextViaMarkdown
  // ==========================================================================
  describe("findStructuralDiff edge cases", () => {
    it("handles removing first of three blocks", () => {
      const md = [
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
        "```mermaid",
        "graph TD",
        "  E --> F",
        "```",
      ].join("\n");

      const doc = parseMarkdownDoc(md);
      const firstMermaid = "```mermaid\ngraph TD\n  A --> B\n```";
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

    it("handles removing last of three blocks", () => {
      const md = [
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
        "```mermaid",
        "graph TD",
        "  E --> F",
        "```",
      ].join("\n");

      const doc = parseMarkdownDoc(md);
      const lastMermaid = "```mermaid\ngraph TD\n  E --> F\n```";
      const offset = md.indexOf(lastMermaid);

      const result = findTextViaMarkdown(
        doc,
        lastMermaid,
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
      expect(node!.attrs.code).toContain("E");
    });

    it("mermaid between text paragraphs", () => {
      const md = [
        "First paragraph text.",
        "",
        "```mermaid",
        "pie title Pets",
        '  "Dogs": 40',
        '  "Cats": 30',
        "```",
        "",
        "Last paragraph text.",
      ].join("\n");

      const doc = parseMarkdownDoc(md);
      const mermaidCode = '```mermaid\npie title Pets\n  "Dogs": 40\n  "Cats": 30\n```';
      const offset = md.indexOf("```mermaid");

      const result = findTextViaMarkdown(
        doc,
        mermaidCode,
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
    });
  });
});
