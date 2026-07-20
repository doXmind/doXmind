/**
 * Markdown clipboard.
 *
 * The editor's document language is Markdown, so both clipboard flavors are
 * kept in that language:
 *
 * - **Copy** — the `text/plain` flavor is the Markdown of the copied slice, not
 *   ProseMirror's `textBetween` flattening. The default loses every structural
 *   cue (ordinals, bullets, `>`, `#`, table pipes) and drops atom blocks such as
 *   math and mermaid entirely, because they carry no text nodes. The `text/html`
 *   flavor is left to ProseMirror so pasting into Word/Docs still lands rich.
 *
 * Paste is deliberately NOT reinterpreted here. Parsing every `text/plain`
 * payload as Markdown collapses the line structure of ordinary text — an
 * address block pasted from Notes becomes one run-on paragraph, and text
 * containing angle brackets is captured as raw HTML — which is a worse failure
 * than the inconsistency it set out to fix. Making plain-text paste coherent
 * needs an explicit opt-in, not a silent reinterpretation.
 */

import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Slice as PMSlice } from "@tiptap/pm/model";

/**
 * Serialize a clipboard slice to markdown. Falls back to the flattened text if
 * the markdown manager is unavailable (editor built without the Markdown
 * extension), which is the pre-existing behavior.
 */
export function sliceToMarkdown(editor: Editor, slice: PMSlice): string {
  const manager = editor.storage.markdown?.manager;
  if (!manager) return slice.content.textBetween(0, slice.content.size, "\n\n");

  const content: Record<string, unknown>[] = [];
  slice.content.forEach((node) => content.push(node.toJSON()));
  if (content.length === 0) return "";

  // A slice cut inside one textblock still arrives wrapped in that block. Emit
  // it without the block scaffolding so copying three words out of a heading
  // does not paste a `#` alongside them.
  const single = content.length === 1 ? slice.content.firstChild : null;
  if (single && single.isTextblock && slice.openStart > 0 && slice.openEnd > 0) {
    const inline: Record<string, unknown>[] = [];
    single.content.forEach((node) => inline.push(node.toJSON()));
    if (inline.length === 0) return "";
    return manager
      .serialize({ type: "doc", content: [{ type: "paragraph", content: inline }] })
      .trim();
  }

  return manager.serialize({ type: "doc", content }).trim();
}

export const MarkdownClipboard = Extension.create({
  name: "markdownClipboard",

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: new PluginKey("markdownClipboard"),
        props: {
          clipboardTextSerializer: (slice) => sliceToMarkdown(editor, slice),
        },
      }),
    ];
  },
});
