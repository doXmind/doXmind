import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { WebBookmarkNodeView } from "@/components/editor/web-bookmark-node-view";

export interface WebBookmarkOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    webBookmark: {
      setWebBookmark: (attrs: {
        url: string;
        title?: string;
        description?: string | null;
        faviconUrl?: string | null;
        imageUrl?: string | null;
      }) => ReturnType;
    };
  }
}

export const WebBookmark = Node.create<WebBookmarkOptions>({
  name: "webBookmark",

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
      url: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-url") || "",
        renderHTML: (attributes) => ({ "data-url": attributes.url }),
      },
      title: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-title") || "",
        renderHTML: (attributes) => ({ "data-title": attributes.title }),
      },
      description: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-description") || null,
        renderHTML: (attributes) => ({ "data-description": attributes.description }),
      },
      faviconUrl: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-favicon-url") || null,
        renderHTML: (attributes) => ({ "data-favicon-url": attributes.faviconUrl }),
      },
      imageUrl: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-image-url") || null,
        renderHTML: (attributes) => ({ "data-image-url": attributes.imageUrl }),
      },
    };
  },

  renderMarkdown(node) {
    const title = node.attrs?.title || node.attrs?.url || "Link";
    const url = node.attrs?.url || "";
    return `[${title}](${url})`;
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="web-bookmark"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "web-bookmark",
      }),
      HTMLAttributes["data-title"] || HTMLAttributes["data-url"] || "Bookmark",
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(WebBookmarkNodeView);
  },

  addCommands() {
    return {
      setWebBookmark:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent([
            {
              type: this.name,
              attrs: {
                url: attrs.url,
                title: attrs.title || "",
                description: attrs.description || null,
                faviconUrl: attrs.faviconUrl || null,
                imageUrl: attrs.imageUrl || null,
              },
            },
            { type: "paragraph" },
          ]);
        },
    };
  },
});
