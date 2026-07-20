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
 * - **Paste** — a `text/plain` payload is parsed as Markdown. Without this, the
 *   mark paste rules convert `**bold**` while `#`/`-`/`>` stay literal, which is
 *   neither plain-text paste nor Markdown paste. ⌘⇧V (paste and match style)
 *   opts out and inserts the text verbatim.
 *
 * A payload that also carries `text/html` is left to the normal rich path, which
 * owns paste sanitization (ADR-0011). Markdown parsed here reaches the DOM only
 * through the same node views, which sanitize at render.
 */

import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DOMParser as PMDOMParser, Slice } from "@tiptap/pm/model";
import type { Slice as PMSlice } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import { markdownToHtml } from "@/lib/markdown";
import { URL_REGEX } from "@/extensions/link-paste";

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

function isInCode(state: EditorState): boolean {
  const { $from, empty } = state.selection;
  if ($from.parent.type.spec.code) return true;
  const codeMark = state.schema.marks.code;
  if (!codeMark) return false;
  return empty ? Boolean(codeMark.isInSet(state.storedMarks || $from.marks())) : false;
}

export const MarkdownClipboard = Extension.create({
  name: "markdownClipboard",

  addProseMirrorPlugins() {
    const editor = this.editor;
    // ⌘⇧V yields a paste event indistinguishable from a plain ⌘V — the modifier
    // is only visible on the keydown that precedes it.
    let literalPasteRequested = false;

    return [
      new Plugin({
        key: new PluginKey("markdownClipboard"),
        props: {
          clipboardTextSerializer: (slice) => sliceToMarkdown(editor, slice),

          handleKeyDown(_view, event) {
            if (event.key === "v" || event.key === "V") {
              literalPasteRequested = (event.metaKey || event.ctrlKey) && event.shiftKey;
            }
            return false;
          },

          handlePaste(view, event) {
            const wantsLiteral = literalPasteRequested;
            literalPasteRequested = false;

            if (wantsLiteral) return false;
            if (event.clipboardData?.getData("text/html")) return false;

            const text = event.clipboardData?.getData("text/plain");
            if (!text || !text.trim()) return false;

            // A lone URL belongs to the link-paste extension, whichever plugin
            // ProseMirror consults first.
            if (URL_REGEX.test(text.trim())) return false;
            if (isInCode(view.state)) return false;

            const { schema, tr } = view.state;
            // DOMParser, not innerHTML: its document has no browsing context, so
            // hostile markup in the payload cannot load resources or fire event
            // handlers on the way to the schema (ADR-0011).
            const parsed = new DOMParser().parseFromString(markdownToHtml(text), "text/html");
            const fragment = PMDOMParser.fromSchema(schema).parse(parsed.body, {
              preserveWhitespace: false,
            }).content;
            if (fragment.childCount === 0) return false;

            // One paragraph means the payload was pure inline markdown; open the
            // slice on both sides so it merges into the current block instead of
            // splitting it.
            const inlineOnly =
              fragment.childCount === 1 && fragment.firstChild?.type === schema.nodes.paragraph;
            const slice = inlineOnly ? new Slice(fragment, 1, 1) : new Slice(fragment, 0, 0);

            event.preventDefault();
            view.dispatch(tr.replaceSelection(slice).scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
