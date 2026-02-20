/**
 * Autocomplete Extension for TipTap
 *
 * Displays ghost text (inline suggestions) at the cursor position
 * using ProseMirror's Decoration system.
 *
 * Includes telemetry for tracking:
 * - Suggestions shown
 * - Suggestions accepted (full or partial)
 * - Suggestions dismissed
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { telemetry } from "@/lib/telemetry";
import { useEditorStore } from "@/stores/editor-store";
import { BlockSelectionPluginKey } from "./block-selection-extension";

// Plugin state interface
export interface AutocompletePluginState {
  suggestion: string | null;
  position: number | null;
  loading: boolean; // Whether autocomplete is fetching
  suggestionId?: string; // For telemetry tracking
  textBefore?: string; // Context for RLHF training
  shownAt?: number; // Timestamp when shown (for latency)
  triggerMode?: "auto" | "manual";
}

// Plugin key for accessing state
export const AutocompletePluginKey = new PluginKey<AutocompletePluginState>("autocomplete");

// Declare custom commands for TypeScript
// Telemetry options for setting suggestions
export interface SetSuggestionOptions {
  suggestion: string | null;
  textBefore?: string;
  triggerMode?: "auto" | "manual";
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    autocomplete: {
      /**
       * Set the autocomplete suggestion
       */
      setSuggestion: (
        suggestion: string | null,
        options?: Omit<SetSuggestionOptions, "suggestion">
      ) => ReturnType;
      /**
       * Accept the full suggestion
       */
      acceptSuggestion: () => ReturnType;
      /**
       * Accept one word from the suggestion
       */
      acceptWordSuggestion: () => ReturnType;
      /**
       * Clear the suggestion
       */
      clearSuggestion: () => ReturnType;
      /**
       * Set loading state for autocomplete
       */
      setLoading: (loading: boolean) => ReturnType;
    };
  }
}

export const AutocompleteExtension = Extension.create({
  name: "autocomplete",

  addProseMirrorPlugins() {
    const _editor = this.editor;

    return [
      new Plugin<AutocompletePluginState>({
        key: AutocompletePluginKey,

        state: {
          init: () => ({
            suggestion: null,
            position: null,
            loading: false,
            suggestionId: undefined,
            textBefore: undefined,
            shownAt: undefined,
            triggerMode: undefined,
          }),

          apply(tr, value) {
            // Check for meta updates
            const meta = tr.getMeta(AutocompletePluginKey);
            if (meta !== undefined) {
              return meta;
            }

            // Clear suggestion if block selection is being activated
            const blockMeta = tr.getMeta(BlockSelectionPluginKey);
            if (blockMeta?.selectedBlockIds?.size > 0 && value.suggestion) {
              const latency = value.shownAt ? Date.now() - value.shownAt : undefined;
              telemetry.trackAutocomplete({
                event_type: "autocomplete_dismissed",
                suggestion_id: value.suggestionId || crypto.randomUUID(),
                text_before: value.textBefore || "",
                suggestion: value.suggestion,
                user_action: "dismiss",
                trigger_mode: value.triggerMode || "auto",
                latency_ms: latency,
              });
              return {
                suggestion: null,
                position: null,
                loading: value.loading,
                suggestionId: undefined,
                textBefore: undefined,
                shownAt: undefined,
                triggerMode: undefined,
              };
            }

            // Clear suggestion if document changed (user is typing)
            if (tr.docChanged && value.suggestion) {
              // Track dismissal (user typed something else)
              const latency = value.shownAt ? Date.now() - value.shownAt : undefined;
              telemetry.trackAutocomplete({
                event_type: "autocomplete_dismissed",
                suggestion_id: value.suggestionId || crypto.randomUUID(),
                text_before: value.textBefore || "",
                suggestion: value.suggestion,
                user_action: "dismiss",
                trigger_mode: value.triggerMode || "auto",
                latency_ms: latency,
              });
              return {
                suggestion: null,
                position: null,
                loading: value.loading,
                suggestionId: undefined,
                textBefore: undefined,
                shownAt: undefined,
                triggerMode: undefined,
              };
            }

            // Clear suggestion if selection changed (cursor moved or text selected)
            if (tr.selectionSet && value.position !== null) {
              const newPos = tr.selection.from;
              const hasSelection = tr.selection.from !== tr.selection.to;
              // Clear if cursor moved away from suggestion position OR text is selected
              if (newPos !== value.position || hasSelection) {
                if (value.suggestion) {
                  // Track dismissal (cursor moved away)
                  const latency = value.shownAt ? Date.now() - value.shownAt : undefined;
                  telemetry.trackAutocomplete({
                    event_type: "autocomplete_dismissed",
                    suggestion_id: value.suggestionId || crypto.randomUUID(),
                    text_before: value.textBefore || "",
                    suggestion: value.suggestion,
                    user_action: "dismiss",
                    trigger_mode: value.triggerMode || "auto",
                    latency_ms: latency,
                  });
                }
                return {
                  suggestion: null,
                  position: null,
                  loading: value.loading,
                  suggestionId: undefined,
                  textBefore: undefined,
                  shownAt: undefined,
                  triggerMode: undefined,
                };
              }
            }

            return value;
          },
        },

        props: {
          decorations(state) {
            const pluginState = this.getState(state);
            const decorations: Decoration[] = [];

            // Show ghost text if there's a suggestion
            if (pluginState?.suggestion && pluginState.position !== null) {
              const ghostWidget = Decoration.widget(
                pluginState.position,
                () => {
                  // Create container for ghost text and keyboard hints
                  const container = document.createElement("span");
                  container.className = "autocomplete-suggestion";
                  container.setAttribute("contenteditable", "false");

                  // Ghost text
                  const textSpan = document.createElement("span");
                  textSpan.className = "autocomplete-ghost-text";
                  textSpan.textContent = pluginState.suggestion;

                  // Keyboard hints container
                  const hintsContainer = document.createElement("span");
                  hintsContainer.className = "autocomplete-hints";

                  // Tab hint (accept)
                  const tabHint = document.createElement("kbd");
                  tabHint.className = "autocomplete-tab-hint";
                  tabHint.textContent = "Tab";

                  // Separator
                  const separator = document.createElement("span");
                  separator.className = "autocomplete-hint-separator";
                  separator.textContent = "/";

                  // Esc hint (dismiss)
                  const escHint = document.createElement("kbd");
                  escHint.className = "autocomplete-esc-hint";
                  escHint.textContent = "Esc";

                  hintsContainer.appendChild(tabHint);
                  hintsContainer.appendChild(separator);
                  hintsContainer.appendChild(escHint);

                  container.appendChild(textSpan);
                  container.appendChild(hintsContainer);

                  return container;
                },
                {
                  side: 1, // Show after the cursor
                  key: "autocomplete-ghost",
                }
              );
              decorations.push(ghostWidget);
            }

            // Show loading indicator while fetching (only if no suggestion yet)
            if (pluginState?.loading && !pluginState.suggestion) {
              const loadingWidget = Decoration.widget(
                state.selection.from,
                () => {
                  const container = document.createElement("span");
                  container.className = "autocomplete-loading";
                  container.setAttribute("contenteditable", "false");
                  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                  svg.setAttribute("viewBox", "0 0 16 16");
                  svg.setAttribute("fill", "none");
                  svg.classList.add("autocomplete-loading-spinner");
                  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                  circle.setAttribute("cx", "8");
                  circle.setAttribute("cy", "8");
                  circle.setAttribute("r", "6");
                  circle.setAttribute("stroke", "currentColor");
                  circle.setAttribute("stroke-opacity", "0.2");
                  circle.setAttribute("stroke-width", "2");
                  const arc = document.createElementNS("http://www.w3.org/2000/svg", "path");
                  arc.setAttribute("d", "M14 8a6 6 0 0 0-6-6");
                  arc.setAttribute("stroke", "currentColor");
                  arc.setAttribute("stroke-width", "2");
                  arc.setAttribute("stroke-linecap", "round");
                  svg.appendChild(circle);
                  svg.appendChild(arc);
                  container.appendChild(svg);
                  return container;
                },
                { side: 1, key: "autocomplete-loading" }
              );
              decorations.push(loadingWidget);
            }

            if (decorations.length === 0) {
              return DecorationSet.empty;
            }

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setSuggestion:
        (suggestion: string | null, options?: Omit<SetSuggestionOptions, "suggestion">) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            const pos = tr.selection.from;
            const suggestionId = suggestion ? crypto.randomUUID() : undefined;

            // Track suggestion shown event
            if (suggestion) {
              telemetry.trackAutocomplete({
                event_type: "autocomplete_shown",
                suggestion_id: suggestionId!,
                text_before: options?.textBefore || "",
                suggestion,
                user_action: "accept", // Will be updated if dismissed
                trigger_mode: options?.triggerMode || "auto",
              });
            }

            tr.setMeta(AutocompletePluginKey, {
              suggestion,
              position: suggestion ? pos : null,
              loading: false,
              suggestionId,
              textBefore: options?.textBefore,
              shownAt: suggestion ? Date.now() : undefined,
              triggerMode: options?.triggerMode,
            });
            dispatch(tr);
          }
          return true;
        },

      acceptSuggestion:
        () =>
        ({ tr, state, dispatch }) => {
          const pluginState = AutocompletePluginKey.getState(state);

          if (!pluginState?.suggestion || pluginState.position === null || !dispatch) {
            return false;
          }

          // Track full acceptance for RLHF
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

          // Record last AI operation for undo tracking
          useEditorStore.getState().setLastAIOperation({
            type: "autocomplete",
            timestamp: Date.now(),
            content: pluginState.suggestion,
          });

          // Track onboarding step
          import("@/stores/onboarding-store")
            .then(({ useOnboardingStore }) => {
              useOnboardingStore.getState().completeStep("autocomplete");
            })
            .catch(() => {});

          // Insert the suggestion text at the SAVED position (where it was displayed)
          // NOT at current cursor position, to avoid position mismatch
          tr.insertText(pluginState.suggestion, pluginState.position);

          // Clear the suggestion
          tr.setMeta(AutocompletePluginKey, {
            suggestion: null,
            position: null,
            loading: false,
            suggestionId: undefined,
            textBefore: undefined,
            shownAt: undefined,
            triggerMode: undefined,
          });

          dispatch(tr);
          return true;
        },

      acceptWordSuggestion:
        () =>
        ({ tr, state, dispatch }) => {
          const pluginState = AutocompletePluginKey.getState(state);

          if (!pluginState?.suggestion || pluginState.position === null || !dispatch) {
            return false;
          }

          // Extract first word (including trailing space if present)
          const match = pluginState.suggestion.match(/^\S+\s*/);
          if (!match) {
            return false;
          }

          const word = match[0];
          const remaining = pluginState.suggestion.slice(word.length);

          // Track partial acceptance
          const latency = pluginState.shownAt ? Date.now() - pluginState.shownAt : undefined;

          telemetry.trackAutocomplete({
            event_type: "autocomplete_partial",
            suggestion_id: pluginState.suggestionId || crypto.randomUUID(),
            text_before: pluginState.textBefore || "",
            suggestion: pluginState.suggestion,
            user_action: "partial",
            accepted_text: word,
            latency_ms: latency,
            trigger_mode: pluginState.triggerMode || "auto",
          });

          // Insert the word at the SAVED position (where suggestion was displayed)
          const insertPos = pluginState.position;
          tr.insertText(word, insertPos);

          // Update suggestion with remaining text (keeping same ID for tracking)
          tr.setMeta(AutocompletePluginKey, {
            suggestion: remaining || null,
            position: remaining ? insertPos + word.length : null,
            loading: false,
            suggestionId: remaining ? pluginState.suggestionId : undefined,
            textBefore: remaining ? (pluginState.textBefore || "") + word : undefined,
            shownAt: remaining ? pluginState.shownAt : undefined,
            triggerMode: pluginState.triggerMode,
          });

          dispatch(tr);
          return true;
        },

      clearSuggestion:
        () =>
        ({ tr, state, dispatch }) => {
          const pluginState = AutocompletePluginKey.getState(state);

          // Track explicit clear as dismissal
          if (pluginState?.suggestion) {
            const latency = pluginState.shownAt ? Date.now() - pluginState.shownAt : undefined;
            telemetry.trackAutocomplete({
              event_type: "autocomplete_dismissed",
              suggestion_id: pluginState.suggestionId || crypto.randomUUID(),
              text_before: pluginState.textBefore || "",
              suggestion: pluginState.suggestion,
              user_action: "dismiss",
              trigger_mode: pluginState.triggerMode || "auto",
              latency_ms: latency,
            });
          }

          if (dispatch) {
            tr.setMeta(AutocompletePluginKey, {
              suggestion: null,
              position: null,
              loading: false,
              suggestionId: undefined,
              textBefore: undefined,
              shownAt: undefined,
              triggerMode: undefined,
            });
            dispatch(tr);
          }
          return true;
        },

      setLoading:
        (loading: boolean) =>
        ({ tr, state, dispatch }) => {
          if (dispatch) {
            const pluginState = AutocompletePluginKey.getState(state);
            tr.setMeta(AutocompletePluginKey, {
              ...(pluginState || {
                suggestion: null,
                position: null,
                loading: false,
              }),
              loading,
            });
            dispatch(tr);
          }
          return true;
        },
    };
  },
});

/**
 * Helper function to get current suggestion from editor state
 */
export function getSuggestion(editor: { state: { doc: unknown } } | null): string | null {
  if (!editor) return null;
  const pluginState = AutocompletePluginKey.getState(
    editor.state as Parameters<typeof AutocompletePluginKey.getState>[0]
  );
  return pluginState?.suggestion ?? null;
}

/**
 * Helper function to check if there's an active suggestion
 */
export function hasSuggestion(editor: { state: { doc: unknown } } | null): boolean {
  return getSuggestion(editor) !== null;
}
