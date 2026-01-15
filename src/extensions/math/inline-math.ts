/**
 * Inline Math Extension for TipTap
 *
 * Supports inline math expressions using $...$ syntax
 */

import { Node, mergeAttributes, InputRule } from "@tiptap/core";
import type { NodeType } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MathNodeView } from "@/components/editor/math/math-node-view";

export interface InlineMathOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    inlineMath: {
      /**
       * Insert an inline math expression
       */
      insertInlineMath: (latex?: string) => ReturnType;
    };
  }
}

/**
 * Input rule to convert $...$ to inline math
 * Matches text between single $ delimiters (not $$)
 */
const inlineMathInputRule = (type: NodeType) => {
  return new InputRule({
    find: /(?<![\\$])\$([^$]+)\$$/,
    handler: ({ state, range, match }) => {
      const latex = match[1];
      if (!latex) return null;

      const { tr } = state;
      const start = range.from;
      const end = range.to;

      tr.replaceWith(start, end, type.create({ latex }));
    },
  });
};

export const InlineMath = Node.create<InlineMathOptions>({
  name: "inlineMath",

  group: "inline",

  inline: true,

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
        tag: 'span[data-type="inline-math"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "inline-math",
        class: "inline-math",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView, {
      as: "span",
      className: "inline-math-wrapper",
    });
  },

  addCommands() {
    return {
      insertInlineMath:
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
    return [inlineMathInputRule(this.type)];
  },

  addKeyboardShortcuts() {
    return {
      // Ctrl/Cmd + Shift + M to insert inline math
      "Mod-Shift-m": () => this.editor.commands.insertInlineMath(),
    };
  },
});
