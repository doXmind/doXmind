/**
 * HTML-comment passthrough block.
 *
 * A block-level `<!-- … -->` has no rendered output, so a DOM-driven import
 * simply dropped it: the comment never became a node, and the next save wrote
 * a document that no longer contained it. Comments carry instructions meant for
 * other tools — license headers, `<!-- prettier-ignore -->`,
 * `<!-- markdownlint-disable -->`, TOC markers — so that was silent,
 * unrecoverable loss, and the missing node also broke the 1:1 block alignment
 * source preservation needs, reflowing the rest of the file.
 *
 * Same shape as `raw-html.ts`: the importers wrap each comment block in a
 * `<div data-html-comment="…">` sentinel holding the original bytes, this node
 * parses that sentinel as one atom, and `renderMarkdown` re-emits it verbatim.
 * External-reference placeholders (`<!-- pdf-block … -->`) are the same syntax
 * but belong to their own nodes, so the importers leave those alone and the
 * tokenizer below declines them.
 */

import { Node } from "@tiptap/core";
import { CUSTOM_BLOCK_PLACEHOLDER_REGEX } from "@/extensions/registry";

export interface HtmlCommentOptions {
  HTMLAttributes: Record<string, unknown>;
}

/** True when `raw` is exactly one block-level HTML comment and nothing else. */
export function isHtmlCommentBlock(raw: string): boolean {
  const trimmed = raw.trim();
  return (
    trimmed.startsWith("<!--") &&
    trimmed.endsWith("-->") &&
    // A second `-->` means the block holds more than the one comment (e.g. a
    // comment followed by markup); that is raw HTML, not a comment block.
    trimmed.indexOf("-->") === trimmed.length - 3
  );
}

/** True when the comment is an external-reference placeholder owned elsewhere. */
export function isCustomBlockPlaceholderComment(raw: string): boolean {
  return CUSTOM_BLOCK_PLACEHOLDER_REGEX.test(raw.trim());
}

function decodeEntities(value: string): string {
  if (typeof document === "undefined") return value;
  const el = document.createElement("textarea");
  el.innerHTML = value;
  return el.value;
}

export const HtmlComment = Node.create<HtmlCommentOptions>({
  name: "htmlComment",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  markdownTokenName: "htmlComment",

  // Registered as an extension tokenizer so it runs ahead of marked's generic
  // `html` tokenizer (which rawHtml claims). Placeholders are declined here so
  // the pdf-block / excel-block tokenizers still see them.
  markdownTokenizer: {
    name: "htmlComment",
    level: "block" as const,
    start: "<!--",
    tokenize(src: string) {
      const match = /^<!--[\s\S]*?-->[ \t]*(?:\n|$)/.exec(src);
      if (!match) return undefined;
      if (isCustomBlockPlaceholderComment(match[0])) return undefined;
      return { type: "htmlComment", raw: match[0], html: match[0].trimEnd() };
    },
  },

  parseMarkdown(token: { html?: string; raw?: string }, helpers) {
    const html = (token.html ?? token.raw ?? "").trimEnd();
    if (!html) return [];
    return helpers.createNode("htmlComment", { html });
  },

  renderMarkdown(node) {
    return ((node.attrs?.html as string) || "").replace(/\n+$/, "");
  },

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      html: {
        default: "",
        parseHTML: (element) => decodeEntities(element.getAttribute("data-html-comment") || ""),
        renderHTML: (attributes) => ({ "data-html-comment": (attributes.html as string) || "" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-html-comment]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-type": "html-comment" }];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.setAttribute("data-type", "html-comment");
      dom.setAttribute("data-html-comment", (node.attrs.html as string) || "");
      dom.contentEditable = "false";
      // textContent, not innerHTML: the comment is shown as source, and its
      // bytes are arbitrary untrusted markup that must never be parsed.
      dom.textContent = (node.attrs.html as string) || "";
      dom.style.whiteSpace = "pre-wrap";
      dom.style.fontFamily = "var(--font-mono, monospace)";
      dom.style.fontSize = "0.85em";
      dom.style.opacity = "0.55";
      return { dom };
    };
  },
});
