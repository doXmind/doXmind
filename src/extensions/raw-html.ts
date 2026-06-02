/**
 * Raw-HTML passthrough block (issue #149).
 *
 * A raw-HTML block in Markdown (e.g. README's `<p align="center">…</p>` badge
 * row) used to import as several editor nodes — an image here, a link there,
 * the wrapping layout dropped. That broke block-level source preservation
 * (one source block ↔ many nodes) and lost the original markup on save.
 *
 * This node captures a raw-HTML block as a single atom whose `html` attribute
 * holds the original Markdown bytes verbatim. The importers (marked / Rust
 * pulldown-cmark / Python markdown) wrap each raw-HTML block in a
 * `<div data-raw-html="…">` sentinel, which parses into this node; the node
 * renders the HTML for display and re-emits it unchanged on save. With one
 * node per source block, source preservation keeps the block byte-identical.
 */

import { Node } from "@tiptap/core";

export interface RawHtmlOptions {
  HTMLAttributes: Record<string, unknown>;
}

function decodeEntities(value: string): string {
  if (typeof document === "undefined") return value;
  const el = document.createElement("textarea");
  el.innerHTML = value;
  return el.value;
}

export const RawHtml = Node.create<RawHtmlOptions>({
  name: "rawHtml",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  // marked emits a block-level `html` token for raw-HTML blocks.
  markdownTokenName: "html",

  parseMarkdown(token: { raw?: string; text?: string }, helpers) {
    const raw = (token.raw ?? token.text ?? "").replace(/\n+$/, "");
    if (!raw.trim()) return [];
    return helpers.createNode("rawHtml", { html: raw });
  },

  renderMarkdown(node) {
    const html = (node.attrs?.html as string) || "";
    return html.replace(/\n+$/, "");
  },

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      html: {
        default: "",
        parseHTML: (element) => {
          const attr = element.getAttribute("data-raw-html");
          if (attr !== null) return decodeEntities(attr);
          return element.innerHTML;
        },
        // Persist the original markup in the attribute so the node round-trips
        // through getHTML()/sidecar storage back into a rawHtml node on reload.
        renderHTML: (attributes) => ({ "data-raw-html": (attributes.html as string) || "" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-raw-html]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-type": "raw-html" }];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.setAttribute("data-type", "raw-html");
      dom.setAttribute("data-raw-html", (node.attrs.html as string) || "");
      dom.contentEditable = "false";
      dom.style.position = "relative";
      // Render the original markup so the user sees the real layout (centered
      // badges, etc.). innerHTML does not execute <script>; this is the user's
      // own local document, the same content any Markdown viewer would render.
      dom.innerHTML = (node.attrs.html as string) || "";
      return { dom };
    };
  },
});
