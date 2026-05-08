/**
 * Block Math Extension for TipTap
 *
 * Supports block-level math expressions using $$...$$ syntax
 */

import { Node, mergeAttributes, InputRule, PasteRule } from "@tiptap/core";
import type { NodeType } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MathNodeView } from "@/components/editor/math/math-node-view";
import { containsCjk } from "./cjk";

export interface BlockMathOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockMath: {
      /**
       * Insert a block math expression
       */
      insertBlockMath: (latex?: string) => ReturnType;
    };
  }
}

/**
 * Input rule to convert $$...$$ to block math
 * Triggers when user types $$ followed by content and closing $$
 * Improved to trigger on space or at end of input
 */
/**
 * True when the position lives inside a table cell or header. Math auto-recognition
 * is disabled in that context — see docs/adr/0006-feature-scope-typora-notion.md.
 */
const isInsideTableCell = (doc: import("@tiptap/pm/model").Node, pos: number): boolean => {
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const name = $pos.node(depth).type.name;
    if (name === "tableCell" || name === "tableHeader") return true;
  }
  return false;
};

const blockMathInputRule = (type: NodeType) => {
  return new InputRule({
    // Match $$...$$ followed by space or at end of line
    find: /\$\$([\s\S]*?)\$\$(\s)?$/,
    handler: ({ state, range, match }) => {
      if (isInsideTableCell(state.doc, range.from)) return null;

      const latex = match[1] || "";
      const trailingSpace = match[2];
      if (containsCjk(latex)) return null;
      const { tr } = state;
      const start = range.from;
      const end = range.to;

      // Replace $$...$$ with block math node
      tr.replaceWith(start, end - (trailingSpace ? 1 : 0), type.create({ latex: latex.trim() }));

      // If there was a trailing space, keep it as text
      if (trailingSpace) {
        tr.insertText(trailingSpace, end - 1);
      }
    },
  });
};

/**
 * Paste rule to convert $$...$$ to block math when pasting
 * Matches block math including multiline content
 */
const blockMathPasteRule = (type: NodeType) => {
  return new PasteRule({
    find: /\$\$([\s\S]*?)\$\$/g,
    handler: ({ state, range, match }) => {
      if (isInsideTableCell(state.doc, range.from)) return null;

      const latex = match[1] || "";
      if (containsCjk(latex)) return null;
      const { tr } = state;

      tr.replaceWith(range.from, range.to, type.create({ latex: latex.trim() }));
    },
  });
};

/**
 * Input rule to start a block math when typing $$ at the start of a line
 */
const startBlockMathInputRule = (type: NodeType) => {
  return new InputRule({
    find: /^\$\$\s$/,
    handler: ({ state, range }) => {
      if (isInsideTableCell(state.doc, range.from)) return null;

      const { tr } = state;
      const start = range.from;
      const end = range.to;

      tr.replaceWith(start, end, type.create({ latex: "" }));
    },
  });
};

export const BlockMath = Node.create<BlockMathOptions>({
  name: "blockMath",

  group: "block",

  atom: true,

  // Markdown: $$\nlatex\n$$
  markdownTokenName: "blockMath",

  markdownTokenizer: {
    name: "blockMath",
    level: "block" as const,
    start: "$$",
    tokenize(src: string) {
      const match = src.match(/^\$\$([\s\S]*?)\$\$/);
      if (match) {
        return { type: "blockMath", raw: match[0], latex: match[1].trim() };
      }
      return undefined;
    },
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode("blockMath", { latex: token.latex || "" });
  },

  renderMarkdown(node) {
    const latex = node.attrs?.latex || "";
    // Empty placeholder has no portable markdown form — skip it. The node
    // lives in the sidecar HTML and is restored from there on reopen.
    if (!latex.trim()) return "";
    return "$$\n" + latex + "\n$$";
  },

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-latex") || "",
        renderHTML: (attributes) => ({
          "data-latex": attributes.latex,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="block-math"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "block-math",
        class: "block-math",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView, {
      as: "div",
      className: "block-math-wrapper",
    });
  },

  addCommands() {
    return {
      insertBlockMath:
        (latex = "") =>
        ({ commands }) => {
          return commands.insertContent([
            { type: this.name, attrs: { latex } },
            { type: "paragraph" },
          ]);
        },
    };
  },

  addInputRules() {
    return [blockMathInputRule(this.type), startBlockMathInputRule(this.type)];
  },

  addPasteRules() {
    return [blockMathPasteRule(this.type)];
  },

  addKeyboardShortcuts() {
    return {
      // Ctrl/Cmd + Shift + E to insert block math (E for Equation)
      "Mod-Shift-e": () => this.editor.commands.insertBlockMath(),
    };
  },
});
