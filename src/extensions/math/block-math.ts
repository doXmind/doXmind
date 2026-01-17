/**
 * Block Math Extension for TipTap
 *
 * Supports block-level math expressions using $$...$$ syntax
 */

import { Node, mergeAttributes, InputRule, PasteRule } from "@tiptap/core";
import type { NodeType } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MathNodeView } from "@/components/editor/math/math-node-view";

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
 * Note: Removed ^ anchor to allow block math mid-paragraph
 */
const blockMathInputRule = (type: NodeType) => {
  return new InputRule({
    find: /\$\$([^$]*)\$\$$/,
    handler: ({ state, range, match }) => {
      const latex = match[1] || "";
      const { tr } = state;
      const start = range.from;
      const end = range.to;

      tr.replaceWith(start, end, type.create({ latex }));
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
      const latex = match[1] || "";
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
          return commands.insertContent({
            type: this.name,
            attrs: { latex },
          });
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
