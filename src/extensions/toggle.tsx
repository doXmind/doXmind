import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ToggleNodeView } from "@/components/editor/toggle-node-view";

export interface ToggleOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    toggle: {
      setToggle: () => ReturnType;
    };
  }
}

export const Toggle = Node.create<ToggleOptions>({
  name: "toggle",

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  group: "block",

  content: "block+",

  defining: true,

  // Markdown: HTML <details>/<summary> tags
  renderMarkdown(node, h) {
    const summary = (node.attrs?.summary as string) || "Toggle heading";
    if (!node.content) return "";
    const childContent = h.renderChildren(node.content, "\n\n");
    return "<details>\n<summary>" + summary + "</summary>\n\n" + childContent + "\n\n</details>";
  },

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (element) => element.getAttribute("data-toggle-open") !== "false",
        renderHTML: (attributes) => ({
          "data-toggle-open": attributes.open ? "true" : "false",
        }),
      },
      summary: {
        default: "Toggle heading",
        parseHTML: (element) => element.getAttribute("data-toggle-summary") || "Toggle heading",
        renderHTML: (attributes) => ({
          "data-toggle-summary": attributes.summary,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-toggle-open]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleNodeView);
  },

  addCommands() {
    return {
      setToggle:
        () =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { open: true, summary: "Toggle heading" },
            content: [{ type: "paragraph" }],
          });
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Backspace at the start of a toggle's first child should unwrap it
      Backspace: () => {
        const { selection } = this.editor.state;
        const { $from } = selection;

        if ($from.depth >= 2) {
          const parentNode = $from.node(-1);
          if (parentNode.type.name === this.name && $from.parentOffset === 0) {
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
