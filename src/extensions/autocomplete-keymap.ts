/**
 * Autocomplete Keymap Extension for TipTap
 *
 * Handles keyboard shortcuts for autocomplete interactions:
 * - Tab: Accept full suggestion
 * - Ctrl/Cmd + Right: Accept one word
 * - Escape: Cancel suggestion
 * - Arrow keys: Cancel suggestion
 * - Alt+/: Manual trigger (similar to IntelliJ IDEA)
 *
 * Note: Ctrl+Space is NOT used because Windows IME intercepts it for input method switching.
 * See: https://learn.microsoft.com/en-us/answers/questions/4010602/how-to-remove-ctrl-space-command
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { AutocompletePluginKey } from "./autocomplete-extension";
import { telemetry } from "@/lib/telemetry";

// Custom event name for manual autocomplete trigger
export const AUTOCOMPLETE_TRIGGER_EVENT = "autocomplete:manual-trigger";

// Plugin key for the keymap
const AutocompleteKeymapPluginKey = new PluginKey("autocompleteKeymap");

export const AutocompleteKeymap = Extension.create({
  name: "autocompleteKeymap",

  // Use ProseMirror plugin for Tab key - more reliable than addKeyboardShortcuts
  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: AutocompleteKeymapPluginKey,
        props: {
          // handleKeyDown runs BEFORE other key handlers, giving us first priority
          handleKeyDown(view, event) {
            const pluginState = AutocompletePluginKey.getState(view.state);

            // Tab: Accept the full suggestion
            if (
              event.key === "Tab" &&
              !event.shiftKey &&
              !event.ctrlKey &&
              !event.altKey &&
              !event.metaKey
            ) {
              if (pluginState?.suggestion) {
                event.preventDefault();
                event.stopPropagation();

                // Track acceptance for telemetry (RLHF training data)
                const latency = pluginState.shownAt ? Date.now() - pluginState.shownAt : undefined;

                telemetry.trackAutocomplete({
                  event_type: "autocomplete_accepted",
                  suggestion_id: pluginState.suggestionId || crypto.randomUUID(),
                  text_before: pluginState.textBefore || "",
                  suggestion: pluginState.suggestion,
                  user_action: "accept",
                  accepted_text: pluginState.suggestion,
                  latency_ms: latency,
                  trigger_mode: pluginState.triggerMode || "auto",
                });

                // Insert the text directly using ProseMirror transaction
                // We dispatch directly to view instead of using TipTap commands
                // because commands don't execute reliably from handleKeyDown
                const { state } = view;
                let tr = state.tr;
                tr = tr.insertText(pluginState.suggestion, state.selection.from);
                tr = tr.setMeta(AutocompletePluginKey, {
                  suggestion: null,
                  position: null,
                  suggestionId: undefined,
                  textBefore: undefined,
                  shownAt: undefined,
                  triggerMode: undefined,
                });
                view.dispatch(tr);
                return true;
              }
            }

            // Ctrl/Cmd + Right Arrow: Accept one word
            if (event.key === "ArrowRight" && (event.ctrlKey || event.metaKey)) {
              if (pluginState?.suggestion) {
                event.preventDefault();
                editor.chain().focus().acceptWordSuggestion().run();
                return true;
              }
            }

            // Escape: Cancel the suggestion
            if (event.key === "Escape") {
              if (pluginState?.suggestion) {
                event.preventDefault();
                editor.chain().focus().clearSuggestion().run();
                return true;
              }
            }

            // Arrow keys: Cancel suggestion (but don't block default behavior)
            if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
              // Don't handle Mod+Right here (handled above)
              if (event.key === "ArrowRight" && (event.ctrlKey || event.metaKey)) {
                return false;
              }
              if (pluginState?.suggestion) {
                editor.chain().clearSuggestion().run();
              }
            }

            return false;
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      // Alt+/: Manual trigger autocomplete (like IntelliJ IDEA)
      // This doesn't conflict with Windows IME
      "Alt-/": () => {
        window.dispatchEvent(new CustomEvent(AUTOCOMPLETE_TRIGGER_EVENT));
        return true;
      },
    };
  },
});
