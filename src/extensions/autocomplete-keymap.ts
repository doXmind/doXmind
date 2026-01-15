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
import { AutocompletePluginKey } from "./autocomplete-extension";

// Custom event name for manual autocomplete trigger
export const AUTOCOMPLETE_TRIGGER_EVENT = "autocomplete:manual-trigger";

export const AutocompleteKeymap = Extension.create({
  name: "autocompleteKeymap",

  addKeyboardShortcuts() {
    return {
      // Alt+/: Manual trigger autocomplete (like IntelliJ IDEA)
      // This doesn't conflict with Windows IME
      "Alt-/": () => {
        window.dispatchEvent(new CustomEvent(AUTOCOMPLETE_TRIGGER_EVENT));
        return true;
      },

      // Tab: Accept the full suggestion
      Tab: ({ editor }) => {
        const pluginState = AutocompletePluginKey.getState(editor.state);
        if (pluginState?.suggestion) {
          return editor.commands.acceptSuggestion();
        }
        // Let other handlers process Tab if no suggestion
        return false;
      },

      // Ctrl/Cmd + Right Arrow: Accept one word
      "Mod-Right": ({ editor }) => {
        const pluginState = AutocompletePluginKey.getState(editor.state);
        if (pluginState?.suggestion) {
          return editor.commands.acceptWordSuggestion();
        }
        // Let other handlers process the key if no suggestion
        return false;
      },

      // Escape: Cancel the suggestion
      Escape: ({ editor }) => {
        const pluginState = AutocompletePluginKey.getState(editor.state);
        if (pluginState?.suggestion) {
          return editor.commands.clearSuggestion();
        }
        return false;
      },

      // Arrow Up: Cancel suggestion
      ArrowUp: ({ editor }) => {
        const pluginState = AutocompletePluginKey.getState(editor.state);
        if (pluginState?.suggestion) {
          editor.commands.clearSuggestion();
        }
        // Don't block the default behavior
        return false;
      },

      // Arrow Down: Cancel suggestion
      ArrowDown: ({ editor }) => {
        const pluginState = AutocompletePluginKey.getState(editor.state);
        if (pluginState?.suggestion) {
          editor.commands.clearSuggestion();
        }
        return false;
      },

      // Arrow Left: Cancel suggestion
      ArrowLeft: ({ editor }) => {
        const pluginState = AutocompletePluginKey.getState(editor.state);
        if (pluginState?.suggestion) {
          editor.commands.clearSuggestion();
        }
        return false;
      },

      // Note: ArrowRight is not included here because:
      // 1. Mod-Right is used for word-by-word acceptance
      // 2. Regular Right might be used to navigate, which should cancel
      ArrowRight: ({ editor }) => {
        const pluginState = AutocompletePluginKey.getState(editor.state);
        if (pluginState?.suggestion) {
          // Regular right arrow cancels the suggestion
          editor.commands.clearSuggestion();
        }
        return false;
      },
    };
  },
});
