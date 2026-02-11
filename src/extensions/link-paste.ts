/**
 * Link Paste Extension
 *
 * When the user selects text and pastes a URL, automatically
 * converts the selected text into a link with the pasted URL.
 * When no text is selected and a URL is pasted, inserts it
 * as a clickable link.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

const URL_REGEX = /^https?:\/\/[^\s<>]+$/i;

export const LinkPaste = Extension.create({
  name: "linkPaste",

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: new PluginKey("linkPaste"),
        props: {
          handlePaste(view, event) {
            const clipboardText = event.clipboardData?.getData("text/plain")?.trim();
            if (!clipboardText || !URL_REGEX.test(clipboardText)) {
              return false; // Not a URL, let default paste handle it
            }

            const { from, to } = view.state.selection;
            const hasSelection = from !== to;

            if (hasSelection) {
              // Text is selected: wrap it as a link
              editor.chain().focus().setLink({ href: clipboardText }).run();
              return true;
            }

            // No selection: insert the URL as a clickable link
            editor
              .chain()
              .focus()
              .insertContent({
                type: "text",
                text: clipboardText,
                marks: [
                  {
                    type: "link",
                    attrs: { href: clipboardText },
                  },
                ],
              })
              .run();
            return true;
          },
        },
      }),
    ];
  },
});
