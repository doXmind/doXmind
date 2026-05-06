/**
 * Inline Math Extension for TipTap
 *
 * Supports inline math expressions using $...$ syntax
 */

import { Node, mergeAttributes, InputRule, PasteRule } from "@tiptap/core";
import type { NodeType } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MathNodeView } from "@/components/editor/math/math-node-view";
import { createMathMigrationPlugin } from "./math-migration-plugin";

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
 * Triggers when user types a space or other character after closing $
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

const inlineMathInputRule = (type: NodeType) => {
  return new InputRule({
    // Match $...$ followed by space or at end of line
    // This triggers when user types space after closing $
    find: /(?<![\\$])\$([^$\n]+)\$(\s)?$/,
    handler: ({ state, range, match }) => {
      if (isInsideTableCell(state.doc, range.from)) return null;

      const latex = match[1];
      const trailingSpace = match[2];
      if (!latex?.trim()) return null;

      const { tr } = state;
      const start = range.from;
      const end = range.to;

      // Replace $...$ with inline math node
      tr.replaceWith(start, end - (trailingSpace ? 1 : 0), type.create({ latex: latex.trim() }));

      // If there was a trailing space, keep it as text
      if (trailingSpace) {
        tr.insertText(trailingSpace, end - 1);
      }
    },
  });
};

/**
 * Paste rule to convert $...$ to inline math when pasting
 * Matches single $ delimiters but not $$
 */
const inlineMathPasteRule = (type: NodeType) => {
  return new PasteRule({
    // Match $...$ but not $$...$$ (negative lookahead/lookbehind)
    find: /(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g,
    handler: ({ state, range, match }) => {
      if (isInsideTableCell(state.doc, range.from)) return null;

      const latex = match[1];
      if (!latex?.trim()) return null;

      const { tr } = state;
      tr.replaceWith(range.from, range.to, type.create({ latex: latex.trim() }));
    },
  });
};

export const InlineMath = Node.create<InlineMathOptions>({
  name: "inlineMath",

  group: "inline",

  inline: true,

  atom: true,

  // Markdown: $latex$
  markdownTokenName: "inlineMath",

  markdownTokenizer: {
    name: "inlineMath",
    level: "inline" as const,
    start(src: string) {
      const m = src.match(/(?<!\$)\$(?!\$)/);
      return m?.index ?? -1;
    },
    tokenize(src: string) {
      const match = src.match(/^(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/);
      if (match) {
        return { type: "inlineMath", raw: match[0], latex: match[1].trim() };
      }
      return undefined;
    },
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode("inlineMath", { latex: token.latex || "" });
  },

  renderMarkdown(node) {
    const latex = node.attrs?.latex || "";
    // Empty placeholder has no portable markdown form — skip it. The node
    // lives in the sidecar HTML and is restored from there on reopen.
    if (!latex.trim()) return "";
    return "$" + latex + "$";
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

  addPasteRules() {
    return [inlineMathPasteRule(this.type)];
  },

  addProseMirrorPlugins() {
    // Add migration plugin to convert existing $ delimiters in loaded content
    // Only add from this extension to avoid duplicates
    return [createMathMigrationPlugin()];
  },

  addKeyboardShortcuts() {
    return {
      // Ctrl/Cmd + Shift + M to insert inline math
      "Mod-Shift-m": () => this.editor.commands.insertInlineMath(),
    };
  },
});
