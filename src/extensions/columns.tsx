import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface ColumnsOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    columns: {
      setColumns: (count?: number) => ReturnType;
    };
  }
}

/**
 * Column node — a single column within a Columns container.
 * Not a standalone block; only valid as a child of `columns`.
 */
export const Column = Node.create({
  name: "column",

  content: "block+",

  isolating: true,

  defining: true,

  parseHTML() {
    return [{ tag: "div[data-column]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-column": "",
        class: "column",
      }),
      0,
    ];
  },

  renderMarkdown(node, h) {
    if (!node.content) return "";
    const childContent = h.renderChildren(node.content, "\n\n");
    return "<div data-column>\n\n" + childContent + "\n\n</div>";
  },
});

/**
 * Columns node — a flex container holding 2–5 Column children.
 * Inserted via `/2 columns`, `/3 columns`, etc. slash commands.
 */
export const Columns = Node.create<ColumnsOptions>({
  name: "columns",

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  group: "block",

  content: "column{2,5}",

  defining: true,

  renderMarkdown(node, h) {
    const count = (node.attrs?.columnCount as number) || 2;
    if (!node.content) return "";
    const childContent = h.renderChildren(node.content, "\n\n");
    return `<div data-columns="${count}">\n\n${childContent}\n\n</div>`;
  },

  addAttributes() {
    return {
      columnCount: {
        default: 2,
        parseHTML: (element) => parseInt(element.getAttribute("data-columns") || "2", 10),
        renderHTML: (attributes) => ({
          "data-columns": attributes.columnCount,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-columns]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: "columns-wrapper",
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setColumns:
        (count = 2) =>
        ({ commands }) => {
          const columns = Array.from({ length: count }, () => ({
            type: "column",
            content: [{ type: "paragraph" }],
          }));
          return commands.insertContent({
            type: this.name,
            attrs: { columnCount: count },
            content: columns,
          });
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Backspace at the start of the first block in the first column → unwrap all
      Backspace: () => {
        const { state } = this.editor;
        const { selection } = state;
        const { $from } = selection;

        // Need depth >= 3: doc > columns > column > block
        if ($from.depth < 3) return false;

        // Check if we're inside a column → columns structure
        const columnNode = $from.node(-1);
        const columnsNode = $from.node(-2);

        if (columnsNode?.type.name !== this.name || columnNode?.type.name !== "column") {
          return false;
        }

        // Only if cursor is at the very start (offset 0) of the current block
        if ($from.parentOffset !== 0) return false;

        // Only if we're in the first block of the first column
        const columnPos = $from.before(-1);
        const columnsPos = $from.before(-2);
        const firstColumnPos = columnsPos + 1;
        const firstBlockPos = firstColumnPos + 1;

        if (columnPos !== firstColumnPos || $from.before() !== firstBlockPos) {
          return false;
        }

        // Unwrap: collect all content from all columns and replace the columns node
        const { tr } = state;
        const columnsStart = columnsPos;
        const columnsEnd = columnsPos + columnsNode.nodeSize;

        // Gather all child blocks from all columns
        const blocks: ProseMirrorNode[] = [];
        columnsNode.forEach((col) => {
          col.forEach((block) => {
            blocks.push(block);
          });
        });

        // Replace the columns node with flattened content
        tr.replaceWith(columnsStart, columnsEnd, blocks);
        this.editor.view.dispatch(tr);
        return true;
      },
    };
  },
});
