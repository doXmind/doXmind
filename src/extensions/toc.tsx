import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { TocNodeView } from "@/components/editor/toc-node-view";

export interface TocOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tableOfContents: {
      setTableOfContents: () => ReturnType;
    };
  }
}

export const TableOfContents = Node.create<TocOptions>({
  name: "tableOfContents",

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  group: "block",

  atom: true,

  draggable: true,

  parseHTML() {
    return [
      {
        tag: 'div[data-type="table-of-contents"]',
      },
    ];
  },

  renderHTML() {
    return ["div", { "data-type": "table-of-contents" }, "Table of Contents"];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TocNodeView);
  },

  addCommands() {
    return {
      setTableOfContents:
        () =>
        ({ commands }) => {
          return commands.insertContent([{ type: this.name }, { type: "paragraph" }]);
        },
    };
  },
});
