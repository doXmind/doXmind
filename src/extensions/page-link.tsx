import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { PageLinkNodeView } from "@/components/editor/page-link-node-view";
import {
  documentHrefForPage,
  pageLinkAttrsFromParagraph,
  renderPageMarkdownLink,
  resolvePageId,
} from "@/lib/editor-navigation";

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
        // Resolves to null when the element carries no id, leaving the
        // paragraph rule below free to supply one; returning "" here would
        // overwrite whatever that rule found.
        parseHTML: (element) =>
          resolvePageId(
            element.getAttribute("data-page-id"),
            element.getAttribute("data-page-href")
          ),
        renderHTML: (attributes) => ({ "data-page-id": attributes.pageId }),
      },
      pageTitle: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-page-title") || null,
        renderHTML: (attributes) => ({ "data-page-title": attributes.pageTitle }),
      },
      pageIcon: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-page-icon") || null,
        renderHTML: (attributes) => ({ "data-page-icon": attributes.pageIcon }),
      },
      // Path to the target relative to the document holding this node — the
      // link that goes into the portable `.md`. Kept alongside pageId because
      // an id only means something inside this workspace.
      pageHref: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-page-href") || null,
        renderHTML: (attributes) =>
          attributes.pageHref ? { "data-page-href": attributes.pageHref } : {},
      },
    };
  },

  renderMarkdown(node) {
    return renderPageMarkdownLink(node.attrs ?? {});
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="page-link"]',
      },
      {
        // A paragraph that is nothing but a link to another workspace document
        // is how a page link comes back from markdown alone (external edit, no
        // sidecar). Restricted to the top level so link-only list items and
        // table cells keep their own structure.
        tag: "p",
        context: "doc/",
        priority: 1100,
        getAttrs: (element) =>
          element instanceof HTMLElement ? pageLinkAttrsFromParagraph(element) : false,
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
                pageHref: documentHrefForPage(attrs.pageId),
              },
            },
            { type: "paragraph" },
          ]);
        },
    };
  },
});
