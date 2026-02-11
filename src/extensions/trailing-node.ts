import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export interface TrailingNodeOptions {
  /** Node types that should NOT trigger a trailing paragraph */
  notAfter: string[];
}

/**
 * Ensures the document always ends with an empty paragraph node.
 * Prevents cursor trapping when the last element is a block element
 * like an image, table, code block, math block, etc.
 */
export const TrailingNode = Extension.create<TrailingNodeOptions>({
  name: "trailingNode",

  addOptions() {
    return {
      notAfter: ["paragraph"],
    };
  },

  addProseMirrorPlugins() {
    const notAfter = this.options.notAfter;

    return [
      new Plugin({
        key: new PluginKey("trailingNode"),
        appendTransaction: (_transactions, _oldState, newState) => {
          const { doc, tr, schema } = newState;
          const lastNode = doc.lastChild;

          if (!lastNode) return;

          if (notAfter.includes(lastNode.type.name)) {
            return;
          }

          const paragraphType = schema.nodes.paragraph;
          if (paragraphType) {
            return tr.insert(doc.content.size, paragraphType.create());
          }
        },
      }),
    ];
  },
});
