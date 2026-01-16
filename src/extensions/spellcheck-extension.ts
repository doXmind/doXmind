/**
 * Spellcheck Extension for TipTap
 *
 * Provides automatic spell checking with visual decorations (red wavy underlines)
 * using LanguageTool API. Supports click-to-fix functionality.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

// Spellcheck match from API mapped to editor positions
export interface SpellcheckMatch {
  id: string; // Unique identifier for this match
  from: number; // ProseMirror position start
  to: number; // ProseMirror position end
  message: string; // Full error description
  shortMessage: string; // Brief error type
  replacements: string[]; // Suggested corrections
  ruleId: string; // Rule ID for categorization
  category: string; // Error category (spelling, grammar, etc.)
}

// Plugin state interface
export interface SpellcheckPluginState {
  matches: SpellcheckMatch[];
  ignoredWords: Set<string>;
  enabled: boolean;
}

// Plugin key for accessing state
export const SpellcheckPluginKey = new PluginKey<SpellcheckPluginState>("spellcheck");

// Storage key for persisted ignored words
const IGNORED_WORDS_STORAGE_KEY = "spellcheck-ignored-words";

// Load ignored words from localStorage
function loadIgnoredWords(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = localStorage.getItem(IGNORED_WORDS_STORAGE_KEY);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

// Save ignored words to localStorage
function saveIgnoredWords(words: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(IGNORED_WORDS_STORAGE_KEY, JSON.stringify([...words]));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Extract plain text from ProseMirror document with position mapping.
 * Returns the text and a map from text index to document position.
 */
export function extractTextWithPositions(doc: PMNode): {
  text: string;
  posMap: number[];
} {
  let text = "";
  const posMap: number[] = [];

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        posMap.push(pos + i);
      }
      text += node.text;
    } else if (node.isBlock && text.length > 0 && !text.endsWith("\n")) {
      // Add newline for block boundaries (paragraphs, headings, etc.)
      posMap.push(pos);
      text += "\n";
    }
  });

  return { text, posMap };
}

/**
 * Map a plain text offset to ProseMirror document position.
 */
export function mapOffsetToPosition(posMap: number[], offset: number): number {
  if (posMap.length === 0) return 0;
  if (offset < 0) return posMap[0] ?? 0;
  if (offset >= posMap.length) {
    // For end positions, return position after the last character
    const lastPos = posMap[posMap.length - 1];
    return lastPos !== undefined ? lastPos + 1 : 0;
  }
  return posMap[offset] ?? 0;
}

// Declare custom commands for TypeScript
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    spellcheck: {
      setSpellcheckMatches: (matches: SpellcheckMatch[]) => ReturnType;
      clearSpellcheck: () => ReturnType;
      applyCorrection: (from: number, to: number, replacement: string) => ReturnType;
      ignoreWord: (word: string) => ReturnType;
      removeIgnoredWord: (word: string) => ReturnType;
      setSpellcheckEnabled: (enabled: boolean) => ReturnType;
    };
  }
}

export interface SpellcheckExtensionOptions {
  errorClass: string;
}

export const SpellcheckExtension = Extension.create<SpellcheckExtensionOptions>({
  name: "spellcheck",

  addOptions() {
    return {
      errorClass: "spellcheck-error",
    };
  },

  addStorage() {
    return {
      matches: [] as SpellcheckMatch[],
      enabled: true,
    };
  },

  addProseMirrorPlugins() {
    const { options, storage } = this;

    return [
      new Plugin<SpellcheckPluginState>({
        key: SpellcheckPluginKey,

        state: {
          init: () => ({
            matches: [],
            ignoredWords: loadIgnoredWords(),
            enabled: true,
          }),

          apply(tr, value) {
            const meta = tr.getMeta(SpellcheckPluginKey);

            if (meta) {
              const newState = { ...value };

              // Update matches
              if (meta.matches !== undefined) {
                // Filter out matches for ignored words
                const filteredMatches = meta.matches.filter((match: SpellcheckMatch) => {
                  // Get the word text from the match
                  const word = tr.doc.textBetween(match.from, match.to);
                  return !value.ignoredWords.has(word.toLowerCase());
                });
                newState.matches = filteredMatches;
                storage.matches = filteredMatches;
              }

              // Clear matches
              if (meta.clear) {
                newState.matches = [];
                storage.matches = [];
              }

              // Add ignored word
              if (meta.ignoreWord) {
                const newIgnored = new Set(value.ignoredWords);
                newIgnored.add(meta.ignoreWord.toLowerCase());
                saveIgnoredWords(newIgnored);
                newState.ignoredWords = newIgnored;
                // Remove matches for the newly ignored word
                newState.matches = newState.matches.filter((match) => {
                  const word = tr.doc.textBetween(match.from, match.to);
                  return word.toLowerCase() !== meta.ignoreWord.toLowerCase();
                });
                storage.matches = newState.matches;
              }

              // Remove ignored word
              if (meta.removeIgnoredWord) {
                const newIgnored = new Set(value.ignoredWords);
                newIgnored.delete(meta.removeIgnoredWord.toLowerCase());
                saveIgnoredWords(newIgnored);
                newState.ignoredWords = newIgnored;
              }

              // Toggle enabled
              if (meta.enabled !== undefined) {
                newState.enabled = meta.enabled;
                storage.enabled = meta.enabled;
                if (!meta.enabled) {
                  newState.matches = [];
                  storage.matches = [];
                }
              }

              return newState;
            }

            // If document changed, we need to invalidate positions
            // The hook will trigger a new check
            if (tr.docChanged && value.matches.length > 0) {
              // Try to map existing positions
              const mappedMatches = value.matches
                .map((match) => ({
                  ...match,
                  from: tr.mapping.map(match.from),
                  to: tr.mapping.map(match.to),
                }))
                .filter((match) => match.from < match.to);

              storage.matches = mappedMatches;
              return {
                ...value,
                matches: mappedMatches,
              };
            }

            return value;
          },
        },

        props: {
          decorations(state) {
            const pluginState = this.getState(state);
            if (!pluginState?.enabled || !pluginState.matches.length) {
              return DecorationSet.empty;
            }

            const decorations: Decoration[] = [];

            pluginState.matches.forEach((match) => {
              // Validate positions
              if (match.from >= 0 && match.to <= state.doc.content.size && match.from < match.to) {
                decorations.push(
                  Decoration.inline(match.from, match.to, {
                    class: options.errorClass,
                    "data-spellcheck-id": match.id,
                    "data-spellcheck-message": match.message,
                  })
                );
              }
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setSpellcheckMatches:
        (matches: SpellcheckMatch[]) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(SpellcheckPluginKey, { matches });
            dispatch(tr);
          }
          return true;
        },

      clearSpellcheck:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(SpellcheckPluginKey, { clear: true });
            dispatch(tr);
          }
          return true;
        },

      applyCorrection:
        (from: number, to: number, replacement: string) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.insertText(replacement, from, to);
            dispatch(tr);
          }
          return true;
        },

      ignoreWord:
        (word: string) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(SpellcheckPluginKey, { ignoreWord: word });
            dispatch(tr);
          }
          return true;
        },

      removeIgnoredWord:
        (word: string) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(SpellcheckPluginKey, { removeIgnoredWord: word });
            dispatch(tr);
          }
          return true;
        },

      setSpellcheckEnabled:
        (enabled: boolean) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(SpellcheckPluginKey, { enabled });
            dispatch(tr);
          }
          return true;
        },
    };
  },
});

/**
 * Helper function to get spellcheck state from editor
 */
export function getSpellcheckState(
  editor: { state: Parameters<typeof SpellcheckPluginKey.getState>[0] } | null
): SpellcheckPluginState | null {
  if (!editor) return null;
  return SpellcheckPluginKey.getState(editor.state) ?? null;
}
