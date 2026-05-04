import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ToggleNodeView } from "@/components/editor/toggle-node-view";
import { ToggleBodyNodeView } from "@/components/editor/toggle-body-node-view";

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

/**
 * Notion-style toggle. Schema:
 *   toggle
 *     toggleSummary  ← the title (paragraph | heading), always visible
 *     toggleBody     ← nested children (block*), shown only when open
 *
 * The two-child schema mirrors Notion's internal model and lets CSS hide the
 * body cleanly without relying on nth-child position tricks.
 */

export const ToggleSummary = Node.create({
  name: "toggleSummary",

  group: "toggleChild",

  content: "(paragraph | heading)",

  defining: true,

  parseHTML() {
    return [{ tag: "div[data-toggle-summary]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-toggle-summary": "" }), 0];
  },

  // The summary's content is rendered inline as part of the toggle's <details><summary>.
  renderMarkdown(node, h) {
    const para = node.content?.[0];
    if (!para) return "";
    return h.renderChildren(para.content ?? [], "").trim();
  },
});

export const ToggleBody = Node.create({
  name: "toggleBody",

  group: "toggleChild",

  content: "block*",

  defining: true,

  parseHTML() {
    return [{ tag: "div[data-toggle-body]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-toggle-body": "" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleBodyNodeView);
  },

  renderMarkdown(node, h) {
    if (!node.content || node.content.length === 0) return "";
    return h.renderChildren(node.content, "\n\n").trim();
  },
});

export const Toggle = Node.create<ToggleOptions>({
  name: "toggle",

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  group: "block",

  content: "toggleSummary toggleBody",

  defining: true,

  renderMarkdown(node, h) {
    const summaryNode = node.content?.[0];
    const bodyNode = node.content?.[1];
    const summary = summaryNode ? h.renderChildren(summaryNode).trim() : "";
    const body = bodyNode ? h.renderChildren(bodyNode).trim() : "";
    if (!body) {
      return `<details>\n<summary>${summary}</summary>\n\n</details>`;
    }
    return `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
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
    };
  },

  parseHTML() {
    return [
      { tag: "div[data-toggle-open]" },
      {
        tag: "details",
        getAttrs: (element) => ({
          open: (element as HTMLDetailsElement).hasAttribute("open"),
        }),
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
            attrs: { open: true },
            content: [
              {
                type: "toggleSummary",
                content: [{ type: "paragraph" }],
              },
              { type: "toggleBody" },
            ],
          });
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Enter at end of the title moves the cursor into the body. If the body is
      // empty, insert a fresh paragraph there. Notion-style: the title stays a
      // single line; pressing Enter starts the first child block.
      Enter: () => {
        const { state } = this.editor;
        const { selection } = state;
        const { $from, empty } = selection;
        if (!empty) return false;

        // Walk up: paragraph → toggleSummary → toggle
        if ($from.depth < 3) return false;
        const summary = $from.node(-1);
        const toggleNode = $from.node(-2);
        if (summary.type.name !== "toggleSummary" || toggleNode.type.name !== this.name) {
          return false;
        }
        // Only intercept when cursor is at end of the title's text.
        if ($from.parentOffset !== $from.parent.content.size) return false;

        const togglePos = $from.before(-2);
        const summarySize = summary.nodeSize;
        // Position right after toggleBody's opening tag (its content start).
        const bodyContentStart = togglePos + 1 + summarySize + 1;
        const body = toggleNode.maybeChild(1);
        const bodyHasContent = !!body && body.childCount > 0;

        const chain = this.editor.chain();
        if (!bodyHasContent) {
          chain.insertContentAt(bodyContentStart, { type: "paragraph" });
        }
        chain.setTextSelection(bodyContentStart + 1).focus();
        return chain.run();
      },

      // Backspace at the start of an empty title unwraps the toggle.
      Backspace: () => {
        const { selection } = this.editor.state;
        const { $from, empty } = selection;
        if (!empty) return false;

        // depth: doc=0, toggle=1, toggleSummary=2, paragraph=3
        if ($from.depth < 3) return false;
        const summary = $from.node(-1);
        const parent = $from.node(-2);
        if (summary.type.name !== "toggleSummary" || parent.type.name !== this.name) {
          return false;
        }
        if ($from.parentOffset !== 0) return false;
        // Only unwrap when title is empty.
        if ($from.parent.content.size > 0) return false;

        return this.editor.commands.lift(this.name);
      },
    };
  },
});
