import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { PageLinkNodeView } from "@/components/editor/page-link-node-view";

export interface PageLinkOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageLink: {
      setPageLink: (attrs: {
        pageId: string;
        pageTitle: string;
        pageIcon?: string | null;
      }) => ReturnType;
    };
  }
}

export const PageLink = Node.create<PageLinkOptions>({
  name: "pageLink",

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  group: "block",

  atom: true,

  draggable: true,

  addAttributes() {
    return {
      pageId: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-page-id") || "",
        renderHTML: (attributes) => ({ "data-page-id": attributes.pageId }),
      },
      pageTitle: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-page-title") || "",
        renderHTML: (attributes) => ({ "data-page-title": attributes.pageTitle }),
      },
      pageIcon: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-page-icon") || null,
        renderHTML: (attributes) => ({ "data-page-icon": attributes.pageIcon }),
      },
    };
  },

  renderMarkdown(node) {
    const title = node.attrs?.pageTitle || "Untitled";
    return title;
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="page-link"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "page-link",
      }),
      HTMLAttributes["data-page-title"] || "Untitled",
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageLinkNodeView);
  },

  addCommands() {
    return {
      setPageLink:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent([
            {
              type: this.name,
              attrs: {
                pageId: attrs.pageId,
                pageTitle: attrs.pageTitle,
                pageIcon: attrs.pageIcon || null,
              },
            },
            { type: "paragraph" },
          ]);
        },
    };
  },
});
