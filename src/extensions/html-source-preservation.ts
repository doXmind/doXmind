/**
 * Block-level source preservation for HTML documents (#139), the getHTML
 * analogue of the Markdown SourcePreservation (#149).
 *
 * Editing an `.html` file in TipTap and calling `getHTML()` re-serializes the
 * whole document, so even untouched top-level blocks get reformatted (attribute
 * order, quoting, whitespace) — the same corruption class #149 eliminated for
 * Markdown. This extension keeps each top-level block's original HTML from when
 * the document loaded and, on `getHTML()`, emits that verbatim for any block
 * whose serialization is unchanged; only edited/new blocks are re-serialized.
 *
 * Reuses the order-aware LCS core (`preserveSerialize`) from the Markdown
 * extension. The baseline is self-validated: enabled only if replaying it
 * reproduces the loaded HTML exactly. It is inert for non-HTML documents (no
 * baseline is set), so wrapping `getHTML()` globally is harmless.
 */

import { Extension } from "@tiptap/core";
import { DOMSerializer, type Schema } from "@tiptap/pm/model";
import { preserveSerialize, type SourceBlock } from "./source-preservation";

interface HtmlPreservationStorage {
  baseline: SourceBlock[] | null;
}

/** Serialize one top-level ProseMirror node (JSON) to its HTML string. */
function serializeNodeToHtml(schema: Schema, nodeJson: unknown): string {
  const node = schema.nodeFromJSON(nodeJson as never);
  const dom = DOMSerializer.fromSchema(schema).serializeNode(node);
  const container = document.createElement("div");
  container.appendChild(dom);
  return container.innerHTML;
}

/**
 * An empty paragraph — chiefly the trailing paragraph the TrailingNode
 * extension keeps for editing UX. Unlike Markdown (where it serializes to ""),
 * an empty `<p>` serializes to a non-empty `<p></p>`, so it must be dropped
 * explicitly or it breaks the block-count alignment.
 */
function isEmptyParagraph(nodeJson: unknown): boolean {
  const node = nodeJson as { type?: string; content?: unknown[] };
  return node.type === "paragraph" && (!node.content || node.content.length === 0);
}

/** Per-node HTML, dropping empty paragraphs (no source-block counterpart). */
function serializableHtmlBlocks(
  schema: Schema,
  nodes: unknown[]
): Array<{ node: unknown; serialized: string }> {
  const blocks: Array<{ node: unknown; serialized: string }> = [];
  for (const node of nodes) {
    if (isEmptyParagraph(node)) continue;
    const serialized = serializeNodeToHtml(schema, node);
    if (serialized.trim() === "") continue;
    blocks.push({ node, serialized });
  }
  return blocks;
}

/**
 * Split an HTML string into its top-level blocks, verbatim. Whitespace between
 * elements (e.g. the newlines in pretty-printed HTML) is folded into the
 * adjacent block's raw so concatenating every entry reproduces the input
 * byte-for-byte — one block per top-level element.
 */
export function splitHtmlTopLevel(html: string): string[] {
  if (typeof document === "undefined") return [];
  const template = document.createElement("template");
  template.innerHTML = html;
  const raws: string[] = [];
  let leading = "";
  for (const node of Array.from(template.content.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      raws.push(leading + (node as Element).outerHTML);
      leading = "";
    } else {
      // text/comment node (whitespace between elements, etc.)
      const text = node.textContent ?? "";
      if (raws.length) raws[raws.length - 1] += text;
      else leading += text;
    }
  }
  return raws;
}

/**
 * Self-validated baseline pairing each original top-level HTML block with the
 * loaded node's serialization. Returns null when blocks can't be aligned 1:1
 * or replaying wouldn't reproduce the loaded HTML.
 */
export function buildHtmlBaseline(
  html: string | null | undefined,
  loadedNodes: unknown[],
  schema: Schema
): SourceBlock[] | null {
  if (!html || !html.trim()) return null;
  const raws = splitHtmlTopLevel(html);
  const blocks = serializableHtmlBlocks(schema, loadedNodes);
  if (raws.length !== blocks.length || raws.length === 0) return null;

  const baseline: SourceBlock[] = raws.map((raw, k) => ({ raw, norm: blocks[k].serialized }));
  const current = blocks.map((b) => ({ norm: b.serialized, serialized: b.serialized }));
  const { output } = preserveSerialize(baseline, current);
  if (output.replace(/\s+$/, "") !== html.replace(/\s+$/, "")) return null;

  return baseline;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    htmlSourcePreservation: {
      /** Capture the original HTML of a freshly loaded `.html` document. */
      setHtmlBaseline: (html: string | null | undefined) => ReturnType;
    };
  }
}

export const HtmlSourcePreservation = Extension.create({
  name: "htmlSourcePreservation",

  addStorage(): HtmlPreservationStorage {
    return { baseline: null };
  },

  addCommands() {
    return {
      setHtmlBaseline:
        (html: string | null | undefined) =>
        ({ editor }) => {
          const storage = this.storage as HtmlPreservationStorage;
          try {
            const nodes = (editor.getJSON().content ?? []) as unknown[];
            storage.baseline = buildHtmlBaseline(html, nodes, editor.schema);
          } catch {
            storage.baseline = null;
          }
          return true;
        },
    };
  },

  onBeforeCreate() {
    const editor = this.editor;
    const name = this.name;
    const original = editor.getHTML.bind(editor);

    editor.getHTML = () => {
      try {
        const storage = (editor.storage as unknown as Record<string, HtmlPreservationStorage>)[
          name
        ];
        const baseline = storage?.baseline;
        if (!baseline || baseline.length === 0) return original();

        const nodes = (editor.getJSON().content ?? []) as unknown[];
        const current = serializableHtmlBlocks(editor.schema, nodes).map((b) => ({
          norm: b.serialized,
          serialized: b.serialized,
        }));
        const { output, nextBaseline } = preserveSerialize(baseline, current);
        storage.baseline = nextBaseline;
        return output;
      } catch {
        return original();
      }
    };
  },
});
