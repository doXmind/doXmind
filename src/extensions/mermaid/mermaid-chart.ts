/**
 * Mermaid Chart Extension for TipTap
 *
 * Supports block-level Mermaid diagrams with edit/preview modes.
 * Follows the same pattern as BlockMath extension.
 */

import { Node, mergeAttributes, InputRule, PasteRule } from "@tiptap/core";
import type { NodeType } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MermaidNodeView } from "@/components/editor/mermaid/mermaid-node-view";

export interface MermaidChartOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mermaidChart: {
      /**
       * Insert a mermaid chart block
       */
      insertMermaidChart: (code?: string) => ReturnType;
    };
  }
}

/**
 * Paste rule to convert ```mermaid code fences to mermaid blocks when pasting
 */
const mermaidPasteRule = (type: NodeType) => {
  return new PasteRule({
    find: /```mermaid\n([\s\S]*?)```/g,
    handler: ({ state, range, match }) => {
      const code = match[1] || "";
      const { tr } = state;

      tr.replaceWith(range.from, range.to, type.create({ code: code.trim() }));
    },
  });
};

/**
 * Input rule to start a mermaid chart when typing :::mermaid at the start of a line
 */
const startMermaidInputRule = (type: NodeType) => {
  return new InputRule({
    find: /^:::mermaid\s$/,
    handler: ({ state, range }) => {
      const { tr } = state;
      tr.replaceWith(range.from, range.to, type.create({ code: "" }));
    },
  });
};

export const MermaidChart = Node.create<MermaidChartOptions>({
  name: "mermaidChart",

  group: "block",

  atom: true,

  // Markdown: ```mermaid\n...\n``` (shares "code" token with CodeBlock)
  markdownTokenName: "code",

  parseMarkdown(token, helpers) {
    if (token.lang !== "mermaid") return [];
    return helpers.createNode("mermaidChart", { code: token.text || "" });
  },

  renderMarkdown(node) {
    const code = node.attrs?.code || "";
    // Empty placeholder has no portable markdown form — skip it. The node
    // lives in the sidecar HTML and is restored from there on reopen.
    if (!code.trim()) return "";
    return "```mermaid\n" + code + "\n```";
  },

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      code: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-code") || "",
        renderHTML: (attributes) => ({
          "data-code": attributes.code,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="mermaid-chart"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "mermaid-chart",
        class: "mermaid-chart",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidNodeView, {
      as: "div",
      className: "mermaid-chart-wrapper",
    });
  },

  addCommands() {
    return {
      insertMermaidChart:
        (code = "") =>
        ({ commands }) => {
          return commands.insertContent([
            { type: this.name, attrs: { code } },
            { type: "paragraph" },
          ]);
        },
    };
  },

  addInputRules() {
    return [startMermaidInputRule(this.type)];
  },

  addPasteRules() {
    return [mermaidPasteRule(this.type)];
  },
});
