import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { PageMentionNodeView } from "@/components/editor/page-mention-node-view";
import {
  documentHrefForPage,
  renderPageMarkdownLink,
  resolvePageId,
} from "@/lib/editor-navigation";

export interface PageMentionOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageMention: {
      setPageMention: (attrs: {
        pageId: string;
        pageTitle: string;
        pageIcon?: string | null;
      }) => ReturnType;
    };
  }
}

/**
 * Inline page mention (Notion's @-page reference). Distinct from the
 * block-level PageLink card: this is an inline atom that flows with the text.
 * Markdown form is a relative link to the target document; the rich node is
 * restored from the sidecar HTML on reopen. Unlike PageLink there is no
 * markdown-side parse rule — an inline link in the middle of a sentence is
 * indistinguishable from any other link, and claiming those as atoms would
 * make ordinary prose uneditable.
 */
export const PageMention = Node.create<PageMentionOptions>({
  name: "pageMention",

  group: "inline",

  inline: true,

  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      pageId: {
        default: "",
        parseHTML: (element) =>
          resolvePageId(
            element.getAttribute("data-page-id"),
            element.getAttribute("data-page-href")
          ),
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
      // See PageLink: the portable half of the reference.
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
        tag: 'span[data-type="page-mention"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "page-mention",
      }),
      HTMLAttributes["data-page-title"] || "Untitled",
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageMentionNodeView, { as: "span" });
  },

  addCommands() {
    return {
      setPageMention:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              pageId: attrs.pageId,
              pageTitle: attrs.pageTitle,
              pageIcon: attrs.pageIcon || null,
              pageHref: documentHrefForPage(attrs.pageId),
            },
          });
        },
    };
  },
});
