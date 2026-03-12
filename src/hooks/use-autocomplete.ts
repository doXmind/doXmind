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

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Editor } from "@tiptap/react";
import { useEditorStore } from "@/stores/editor-store";
import { useFileStore } from "@/stores/file-store";
import {
  AUTOCOMPLETE_TRIGGER_EVENT,
  AUTOCOMPLETE_TRIGGER_LONG_EVENT,
} from "@/extensions/autocomplete-keymap";
import { BlockSelectionPluginKey } from "@/extensions/block-selection-extension";
import { api } from "@/lib/api";
import { editorLogger } from "@/lib/logger";
import { useBillingStore } from "@/stores/billing-store";
import type { AutocompleteMode } from "@/types";

const log = editorLogger.child("Autocomplete");

// Configuration
const CONFIG = {
  DEBOUNCE_DELAY: 750, // ms - industry best practice (GitHub Copilot uses 500-1000ms)
  MIN_TEXT_LENGTH: 2, // Minimum text length before triggering
  MIN_WORD_LENGTH: 2, // Minimum current word length to trigger completion
  MAX_CONTEXT_BEFORE: 4000, // Max chars before cursor
  MAX_CONTEXT_AFTER: 1000, // Max chars after cursor
  MIN_IDLE_TIME: 500, // ms - minimum idle time before triggering (prevents rapid triggers)
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
 * Triggers while typing to complete current word, or after punctuation/space.
 */
function shouldTrigger(editor: Editor): boolean {
  const { state } = editor;
  const { selection } = state;

  // Don't trigger if editor is not focused (e.g. block action menu open, drag in progress)
  if (!editor.view.hasFocus()) {
    return false;
  }

  // Don't trigger if there's a text selection
  if (!selection.empty) {
    return false;
  }

  // Don't trigger if block selection is active
  const blockSelectionState = BlockSelectionPluginKey.getState(state);
  if (blockSelectionState && blockSelectionState.selectedBlockIds.size > 0) {
    return false;
  }

  // Check the node at cursor position
  const $pos = state.doc.resolve(selection.from);
  const node = $pos.parent;

  // Don't trigger in code blocks
  if (node.type.name === "codeBlock") {
    return false;
  }

  // Don't trigger inside tables (walk ancestor chain for reliable detection)
  for (let d = $pos.depth; d >= 0; d--) {
    const ancestor = $pos.node(d).type.name;
    if (ancestor === "table" || ancestor === "tableCell" || ancestor === "tableHeader") {
      return false;
    }
  }

  // Don't trigger in headings (short, deliberate, structural content)
  if (node.type.name === "heading") {
    return false;
  }

  // Don't trigger in task items (personal, specific action items)
  if (node.type.name === "taskItem") {
    return false;
  }

  // Don't trigger in math blocks (requires precise notation)
  if (node.type.name === "blockMath" || node.type.name === "inlineMath") {
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

  // Get character before cursor
  const charBefore =
    selection.from > 0 ? state.doc.textBetween(selection.from - 1, selection.from) : "";

  // Trigger after space, newline, or at document start
  if (charBefore === " " || charBefore === "\n" || selection.from === 1) {
    return true;
  }

  // Trigger after Chinese/English punctuation (for next sentence prediction)
  // Chinese: 。！？，；：、
  // English: . ! ? , ; :
  const punctuationPattern = /[。！？，；：、.!?,;:]/;
  if (punctuationPattern.test(charBefore)) {
    return true;
  }

  return false;
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

/**
 * Detect if long mode should be used based on context (for adaptive mode)
 */
function shouldUseLongMode(editor: Editor, mode: AutocompleteMode): boolean {
  // If mode is explicitly set, use it
  if (mode === "short") return false;
  if (mode === "long") return true;

  // Adaptive mode: detect strategic points
  const { state } = editor;
  const pos = state.selection.from;

  // Get text before cursor (last 200 chars for pattern matching)
  const textBefore = state.doc.textBetween(Math.max(0, pos - 200), pos, "\n");
  const lines = textBefore.split("\n");
  const lastLine = lines[lines.length - 1] || "";
  const secondLastLine = lines.length > 1 ? lines[lines.length - 2] : "";

  // Trigger long mode at strategic points:
  // 1. After new heading (markdown)
  if (lastLine.match(/^#{1,6}\s+.*$/)) {
    return true;
  }

  // 2. After colon (likely starting a list or explanation)
  if (lastLine.trim().endsWith(":")) {
    return true;
  }

  // 3. Empty line after paragraph end (starting new section)
  if (lastLine === "" && secondLastLine.trim().endsWith(".")) {
    return true;
  }

  // 4. After list item marker (completing list)
  if (lastLine.match(/^[\s]*[-*+]\s+$/)) {
    return true;
  }

  // Default to short mode for normal typing
  return false;
}

export function useAutocomplete({
  editor,
  fileId,
  fileName,
  enabled = true,
}: UseAutocompleteOptions) {
  const [isLoading, setIsLoading] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorMoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchSuggestionRef = useRef<((forceMode?: "short" | "long") => Promise<void>) | null>(null);

  const { autocompleteEnabled, autocompleteTriggerMode, autocompleteMode } = useEditorStore();

  // Get files from file store (stable selector)
  const files = useFileStore((state) => state.files);

  // Memoize open file IDs to prevent infinite loops
  const openFileIds = useMemo(() => files.filter((f) => !f.isFolder).map((f) => f.id), [files]);

  // Combine store setting with prop (both must be true), and disable if AI locked
  const isAILocked = useBillingStore((s) => s.isAILocked)();
  const isEnabled = enabled && autocompleteEnabled && !isAILocked;

  // Track file switches to prevent autocomplete from triggering on file open.
  // setContent() dispatches a docChanged transaction which would otherwise
  // start the autocomplete debounce timer.
  const fileJustSwitchedRef = useRef(false);

  /**
   * Clear the current suggestion
   */
  const clearSuggestion = useCallback(() => {
    if (editor) {
      editor.commands.clearSuggestion();
    }

    // Abort in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Clear all timers
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (cursorMoveTimerRef.current) {
      clearTimeout(cursorMoveTimerRef.current);
      cursorMoveTimerRef.current = null;
    }
  }, [editor]);

  // When the file changes, suppress autocomplete triggers briefly.
  // setContent() runs inside queueMicrotask so the transaction fires AFTER
  // this effect. The 150ms window covers the microtask + any cascading events.
  useEffect(() => {
    fileJustSwitchedRef.current = true;

    // Abort in-flight request from previous file
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Clear any pending timers from the previous file
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (cursorMoveTimerRef.current) {
      clearTimeout(cursorMoveTimerRef.current);
      cursorMoveTimerRef.current = null;
    }

    const timer = setTimeout(() => {
      fileJustSwitchedRef.current = false;
    }, 150);

    return () => clearTimeout(timer);
  }, [fileId]);

  /**
   * Fetch suggestion from the API - SIMPLIFIED VERSION
   * @param forceMode Optional mode to force (overrides setting and detection)
   */
  const fetchSuggestion = useCallback(
    async (forceMode?: "short" | "long") => {
      if (!editor || !isEnabled) {
        return;
      }

      // Check trigger conditions
      if (!shouldTrigger(editor)) {
        return;
      }

      const { state } = editor;
      const pos = state.selection.from;
      const { textBefore, textAfter } = getContext(editor);

      // Check minimum text length
      if (textBefore.trim().length < CONFIG.MIN_TEXT_LENGTH) {
        return;
      }

      // Cancel previous in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      editor.commands.setLoading(true);

      try {
        const mode = forceMode || (shouldUseLongMode(editor, autocompleteMode) ? "long" : "short");

        log.debug(`Making autocomplete request (${mode} mode)`);

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
            mode,
            open_file_ids: openFileIds,
            include_context: true,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        // Show suggestion if we got one
        if (editor && data.suggestion) {
          // Re-check conditions — block selection may have activated during the API call
          if (!shouldTrigger(editor)) {
            return;
          }
          // Verify cursor is still at the same position as when we made the request
          const currentPos = editor.state.selection.from;
          if (currentPos !== pos) {
            log.debug("Cursor moved during request, discarding suggestion");
            return;
          }
          log.debug(`Showing suggestion: "${data.suggestion.substring(0, 50)}..."`);
          editor.commands.setSuggestion(data.suggestion, {
            textBefore,
            triggerMode: autocompleteTriggerMode,
          });
        }
      } catch (error) {
        // Silently ignore aborted requests
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        log.error("Autocomplete request failed", error);
      } finally {
        // Only clear loading if this controller is still the active one
        // (avoids clearing loading state for a newer request)
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
          setIsLoading(false);
          if (editor && !editor.isDestroyed) {
            editor.commands.setLoading(false);
          }
        }
      }
    },
    [editor, isEnabled, fileId, fileName, autocompleteTriggerMode, autocompleteMode, openFileIds]
  );

  /**
   * Trigger autocomplete with debouncing (for auto mode)
   */
  const triggerAutocomplete = useCallback(() => {
    // Clear existing timer and start new one
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      fetchSuggestion();
    }, CONFIG.DEBOUNCE_DELAY);
  }, [fetchSuggestion]);

  /**
   * Manual trigger (Alt+/ shortcut) - triggers immediately without debounce
   */
  const manualTrigger = useCallback(() => {
    if (!editor || !isEnabled) return;

    // Clear all timers and trigger immediately
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (cursorMoveTimerRef.current) {
      clearTimeout(cursorMoveTimerRef.current);
      cursorMoveTimerRef.current = null;
    }

    fetchSuggestion();
  }, [editor, isEnabled, fetchSuggestion]);

  /**
   * Manual long mode trigger (Cmd+Shift+Space) - forces long mode
   */
  const manualTriggerLong = useCallback(() => {
    if (!editor || !isEnabled) return;

    // Clear all timers and trigger immediately with long mode
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (cursorMoveTimerRef.current) {
      clearTimeout(cursorMoveTimerRef.current);
      cursorMoveTimerRef.current = null;
    }

    fetchSuggestion("long");
  }, [editor, isEnabled, fetchSuggestion]);

  /**
   * Keep fetchSuggestionRef up to date without triggering effect re-runs
   */
  useEffect(() => {
    fetchSuggestionRef.current = fetchSuggestion;
  }, [fetchSuggestion]);

  /**
   * Handle editor updates - SIMPLIFIED VERSION
   * Uses ref pattern to avoid re-registering listener when fetchSuggestion changes
   */
  useEffect(() => {
    if (!editor || !isEnabled || autocompleteTriggerMode !== "auto") {
      return;
    }

    // Handler for typing (document changes)
    const handleTransaction = ({
      transaction,
    }: {
      transaction: { docChanged: boolean; selectionSet: boolean };
    }) => {
      // Skip during file switch — setContent() dispatches docChanged + selectionSet
      // transactions that would falsely trigger autocomplete
      if (fileJustSwitchedRef.current) return;

      // Don't trigger autocomplete when block selection is active — clear pending timers
      const blockSelState = BlockSelectionPluginKey.getState(editor.state);
      if (blockSelState && blockSelState.selectedBlockIds.size > 0) {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        if (cursorMoveTimerRef.current) {
          clearTimeout(cursorMoveTimerRef.current);
          cursorMoveTimerRef.current = null;
        }
        return;
      }

      // Clear cursor move timer when user types
      if (cursorMoveTimerRef.current) {
        clearTimeout(cursorMoveTimerRef.current);
        cursorMoveTimerRef.current = null;
      }

      if (transaction.docChanged) {
        // User is typing - clear existing debounce timer
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }

        // Start new debounce timer - call via ref to always use latest version
        debounceTimerRef.current = setTimeout(() => {
          fetchSuggestionRef.current?.();
        }, CONFIG.DEBOUNCE_DELAY);
      } else if (transaction.selectionSet) {
        // User moved cursor without typing (click or arrow keys)
        if (!editor) return;
        const { state } = editor;

        // Abort in-flight request — cursor has moved, any pending result is stale
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
          editor.commands.setLoading(false);
        }

        // Never trigger autocomplete when text is selected — also clear any pending timer
        if (!state.selection.empty) {
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
          }
          return;
        }

        // Only trigger if cursor is at a "meaningful" position (end of line, after punctuation)
        const pos = state.selection.from;

        // Check if cursor is at a meaningful position
        const textBefore = state.doc.textBetween(Math.max(0, pos - 20), pos, "");
        const isEndOfLine = textBefore.endsWith("\n") || pos === state.doc.content.size;
        const isAfterSentence = /[.!?。！？]\s*$/.test(textBefore);
        const isAfterColon = /[:：]\s*$/.test(textBefore);

        // Only trigger at strategic points to avoid annoyance
        if (isEndOfLine || isAfterSentence || isAfterColon) {
          if (cursorMoveTimerRef.current) {
            clearTimeout(cursorMoveTimerRef.current);
          }

          cursorMoveTimerRef.current = setTimeout(() => {
            fetchSuggestionRef.current?.();
          }, CONFIG.DEBOUNCE_DELAY + 250); // Slightly longer delay for cursor moves (1000ms)
        }
      }
    };

    editor.on("transaction", handleTransaction);

    return () => {
      editor.off("transaction", handleTransaction);

      // Abort in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      // Cleanup timers on unmount
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (cursorMoveTimerRef.current) {
        clearTimeout(cursorMoveTimerRef.current);
        cursorMoveTimerRef.current = null;
      }
    };
  }, [editor, isEnabled, autocompleteTriggerMode]);

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

    const handleManualTriggerLong = () => {
      manualTriggerLong();
    };

    window.addEventListener(AUTOCOMPLETE_TRIGGER_EVENT, handleManualTrigger);
    window.addEventListener(AUTOCOMPLETE_TRIGGER_LONG_EVENT, handleManualTriggerLong);

    return () => {
      window.removeEventListener(AUTOCOMPLETE_TRIGGER_EVENT, handleManualTrigger);
      window.removeEventListener(AUTOCOMPLETE_TRIGGER_LONG_EVENT, handleManualTriggerLong);
    };
  }, [editor, isEnabled, manualTrigger, manualTriggerLong]);

  return {
    isLoading,
    clearSuggestion,
    triggerAutocomplete,
    manualTrigger,
  };
}
