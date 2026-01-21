"use client";

/**
 * useAutocomplete Hook
 *
 * Manages autocomplete suggestions for the TipTap editor.
 * Features:
 * - Simple word completion (current word + at most 1 more word)
 * - Triggers while typing to complete current word
 * - 300ms debounce to avoid too frequent requests
 * - Request cancellation via AbortController
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { Editor } from "@tiptap/react";
import { useEditorStore } from "@/stores/editor-store";
import { AutocompletePluginKey } from "@/extensions/autocomplete-extension";
import { AUTOCOMPLETE_TRIGGER_EVENT } from "@/extensions/autocomplete-keymap";
import { api } from "@/lib/api";
import { editorLogger } from "@/lib/logger";

const log = editorLogger.child("Autocomplete");

// Configuration
const CONFIG = {
  DEBOUNCE_DELAY: 300, // ms - longer debounce since we trigger on every keystroke
  MIN_TEXT_LENGTH: 2, // Minimum text length before triggering
  MIN_WORD_LENGTH: 2, // Minimum current word length to trigger completion
  MAX_CONTEXT_BEFORE: 4000, // Max chars before cursor
  MAX_CONTEXT_AFTER: 1000, // Max chars after cursor
};

interface UseAutocompleteOptions {
  editor: Editor | null;
  fileId: string;
  fileName: string;
  /** Whether autocomplete is enabled (default: true). Set to false on mobile. */
  enabled?: boolean;
}

/**
 * Check if autocomplete should be triggered based on editor state.
 * Now triggers while typing to complete current word.
 */
function shouldTrigger(editor: Editor): boolean {
  const { state } = editor;
  const { selection } = state;

  // Don't trigger if there's a text selection
  if (!selection.empty) {
    return false;
  }

  // Check the node at cursor position
  const $pos = state.doc.resolve(selection.from);
  const node = $pos.parent;

  // Don't trigger in code blocks
  if (node.type.name === "codeBlock") {
    return false;
  }

  // Get text in current paragraph up to cursor
  const startOfNode = $pos.start();
  const textInNode = state.doc.textBetween(startOfNode, selection.from, "");

  // Find the current word being typed (characters after last space/punctuation)
  const currentWordMatch = textInNode.match(/[\w\u4e00-\u9fff]+$/);
  const currentWord = currentWordMatch ? currentWordMatch[0] : "";

  // Trigger if we're typing a word with at least MIN_WORD_LENGTH characters
  // This enables completion of the current word
  if (currentWord.length >= CONFIG.MIN_WORD_LENGTH) {
    return true;
  }

  // Also trigger after space/newline (for next word prediction)
  const charBefore = selection.from > 0
    ? state.doc.textBetween(selection.from - 1, selection.from)
    : "";

  return charBefore === " " || charBefore === "\n" || selection.from === 1;
}

/**
 * Extract context around the cursor
 */
function getContext(editor: Editor): { textBefore: string; textAfter: string } {
  const { state } = editor;
  const pos = state.selection.from;

  const textBefore = state.doc.textBetween(
    Math.max(0, pos - CONFIG.MAX_CONTEXT_BEFORE),
    pos,
    "\n" // Use newline as block separator
  );

  const textAfter = state.doc.textBetween(
    pos,
    Math.min(state.doc.content.size, pos + CONFIG.MAX_CONTEXT_AFTER),
    "\n"
  );

  return { textBefore, textAfter };
}

export function useAutocomplete({ editor, fileId, fileName, enabled = true }: UseAutocompleteOptions) {
  const [isLoading, setIsLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPositionRef = useRef<number | null>(null);

  const { autocompleteEnabled, autocompleteTriggerMode } = useEditorStore();

  // Combine store setting with prop (both must be true)
  const isEnabled = enabled && autocompleteEnabled;

  /**
   * Clear the current suggestion
   */
  const clearSuggestion = useCallback(() => {
    if (editor) {
      editor.commands.clearSuggestion();
    }

    // Cancel pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Clear debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, [editor]);

  /**
   * Fetch suggestion from the API
   */
  const fetchSuggestion = useCallback(async () => {
    if (!editor || !isEnabled) {
      return;
    }

    // Check trigger conditions
    if (!shouldTrigger(editor)) {
      clearSuggestion();
      return;
    }

    const { state } = editor;
    const pos = state.selection.from;

    // Get context
    const { textBefore, textAfter } = getContext(editor);

    // Check minimum text length
    if (textBefore.trim().length < CONFIG.MIN_TEXT_LENGTH) {
      clearSuggestion();
      return;
    }

    // Store current position for validation
    lastPositionRef.current = pos;

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setIsLoading(true);

    try {
      const response = await fetch("/api/autocomplete/suggest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...api.getAuthorizationHeaders(),
        },
        body: JSON.stringify({
          text_before: textBefore,
          text_after: textAfter,
          file_id: fileId,
          file_name: fileName,
          cursor_position: pos,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      // Validate that cursor position hasn't changed
      if (editor && data.suggestion) {
        const currentPos = editor.state.selection.from;
        if (currentPos === pos) {
          editor.commands.setSuggestion(data.suggestion);
        }
      }
    } catch (error) {
      // Ignore abort errors
      if ((error as Error).name !== "AbortError") {
        log.error("Autocomplete request failed", error);
      }
    } finally {
      setIsLoading(false);
    }
  }, [editor, isEnabled, fileId, fileName, clearSuggestion]);

  /**
   * Trigger autocomplete with debouncing (for auto mode)
   */
  const triggerAutocomplete = useCallback(() => {
    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new debounced timer
    debounceTimerRef.current = setTimeout(() => {
      fetchSuggestion();
    }, CONFIG.DEBOUNCE_DELAY);
  }, [fetchSuggestion]);

  /**
   * Manual trigger (for manual mode, called by keyboard shortcut)
   * No debouncing - triggers immediately
   */
  const manualTrigger = useCallback(() => {
    if (!editor || !isEnabled) {
      return;
    }
    // Immediately fetch suggestion without debouncing
    fetchSuggestion();
  }, [editor, isEnabled, fetchSuggestion]);

  /**
   * Handle editor updates
   */
  useEffect(() => {
    if (!editor || !isEnabled) {
      return;
    }

    const handleUpdate = () => {
      // Clear existing suggestion when user types
      const pluginState = AutocompletePluginKey.getState(editor.state);
      if (pluginState?.suggestion) {
        // Suggestion was already cleared by the plugin on docChanged
        // Just cancel pending requests
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
      }

      // Only auto-trigger in auto mode
      if (autocompleteTriggerMode === "auto") {
        triggerAutocomplete();
      }
    };

    const handleSelectionUpdate = () => {
      // Clear suggestion if selection changes significantly
      const pluginState = AutocompletePluginKey.getState(editor.state);
      if (pluginState?.suggestion && pluginState.position !== null) {
        const currentPos = editor.state.selection.from;
        if (currentPos !== pluginState.position) {
          clearSuggestion();
        }
      }
    };

    editor.on("update", handleUpdate);
    editor.on("selectionUpdate", handleSelectionUpdate);

    return () => {
      editor.off("update", handleUpdate);
      editor.off("selectionUpdate", handleSelectionUpdate);
      clearSuggestion();
    };
  }, [editor, isEnabled, autocompleteTriggerMode, triggerAutocomplete, clearSuggestion]);

  /**
   * Listen for manual trigger events from keyboard shortcuts
   */
  useEffect(() => {
    if (!editor || !isEnabled) {
      return;
    }

    const handleManualTrigger = () => {
      manualTrigger();
    };

    window.addEventListener(AUTOCOMPLETE_TRIGGER_EVENT, handleManualTrigger);

    return () => {
      window.removeEventListener(AUTOCOMPLETE_TRIGGER_EVENT, handleManualTrigger);
    };
  }, [editor, isEnabled, manualTrigger]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    isLoading,
    clearSuggestion,
    triggerAutocomplete,
    manualTrigger,
  };
}
