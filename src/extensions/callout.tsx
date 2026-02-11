import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { CalloutNodeView } from "@/components/editor/callout-node-view";

export type CalloutType = "info" | "warning" | "error" | "tip";

export interface CalloutOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attrs?: { type?: CalloutType }) => ReturnType;
      toggleCallout: (attrs?: { type?: CalloutType }) => ReturnType;
      setCalloutType: (type: CalloutType) => ReturnType;
    };
  }
}

export const Callout = Node.create<CalloutOptions>({
  name: "callout",

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  group: "block",

  content: "block+",

  defining: true,

  addAttributes() {
    return {
      type: {
        default: "info" as CalloutType,
        parseHTML: (element) => element.getAttribute("data-callout-type") || "info",
        renderHTML: (attributes) => ({
          "data-callout-type": attributes.type,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-callout-type]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-callout-type": HTMLAttributes["data-callout-type"] || "info",
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutNodeView);
  },

  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { type: attrs?.type || "info" },
            content: [{ type: "paragraph" }],
          });
        },
      toggleCallout:
        (attrs) =>
        ({ commands }) => {
          return commands.toggleWrap(this.name, { type: attrs?.type || "info" });
        },
      setCalloutType:
        (type) =>
        ({ commands }) => {
          return commands.updateAttributes(this.name, { type });
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Backspace at the start of a callout should unwrap it
      Backspace: () => {
        const { selection } = this.editor.state;
        const { $from } = selection;

        // Check if cursor is at the start of a callout's first child
        if ($from.depth >= 2) {
          const parentNode = $from.node(-1);
          if (parentNode.type.name === this.name && $from.parentOffset === 0) {
            // Only if we're in the first child block
            const parentPos = $from.before(-1);
            const firstChildPos = parentPos + 1;
            if ($from.before() === firstChildPos) {
              return this.editor.commands.lift(this.name);
            }
          }
        }

        return false;
      },
    };
  },
});
