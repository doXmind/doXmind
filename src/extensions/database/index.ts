/**
 * Database Block Extension for TipTap
 *
 * An atom node that renders an inline Notion-style database with
 * Table and Board views. Data is stored in the backend; only the
 * databaseId reference lives inside the TipTap document.
 */

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { DatabaseNodeView } from "@/components/editor/database/database-node-view";

export interface DatabaseBlockOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    databaseBlock: {
      /** Insert a database block. Pass databaseId to embed an existing database, defaultViewType for auto-creation. */
      insertDatabaseBlock: (databaseId?: string, defaultViewType?: string) => ReturnType;
    };
  }
}

export const DatabaseBlock = Node.create<DatabaseBlockOptions>({
  name: "databaseBlock",

  group: "block",

  atom: true,

  // Markdown: <!-- database:uuid -->
  markdownTokenName: "databaseBlock",

  markdownTokenizer: {
    name: "databaseBlock",
    level: "block" as const,
    start: "<!--",
    tokenize(src: string) {
      const match = src.match(/^<!-- database:([a-f0-9-]+) -->\n?/);
      if (match) {
        return { type: "databaseBlock", raw: match[0], databaseId: match[1] };
      }
      return undefined;
    },
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode("databaseBlock", {
      databaseId: token.databaseId || null,
    });
  },

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      databaseId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-database-id"),
        renderHTML: (attributes) => ({
          "data-database-id": attributes.databaseId,
        }),
      },
      viewId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-view-id"),
        renderHTML: (attributes) => ({
          "data-view-id": attributes.viewId,
        }),
      },
      /** Ephemeral: used only during creation to auto-create with a specific view type */
      defaultViewType: {
        default: null,
        rendered: false,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="database-block"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "database-block",
        class: "database-block",
      }),
    ];
  },

  renderMarkdown(node) {
    const dbId = node.attrs?.databaseId || "unknown";
    return `<!-- database:${dbId} -->\n`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(DatabaseNodeView, {
      as: "div",
      className: "database-block-wrapper",
    });
  },

  addCommands() {
    return {
      insertDatabaseBlock:
        (databaseId, defaultViewType) =>
        ({ commands }) => {
          return commands.insertContent([
            {
              type: this.name,
              attrs: {
                databaseId: databaseId || null,
                defaultViewType: defaultViewType || null,
              },
            },
            { type: "paragraph" },
          ]);
        },
    };
  },
});
