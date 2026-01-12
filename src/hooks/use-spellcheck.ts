"use client";

/**
 * useSpellcheck Hook
 *
 * Manages automatic spell checking for the TipTap editor using LanguageTool API.
 * Features:
 * - 2000ms debounce to respect API rate limits (20 req/min/IP)
 * - Text content caching to avoid redundant API calls
 * - AbortController for request cancellation
 * - Automatic position mapping from plain text to ProseMirror positions
 */

import { useCallback, useRef, useEffect } from "react";
import { Editor } from "@tiptap/react";
import {
  checkSpelling,
  hashText,
  type LanguageToolMatch,
} from "@/lib/languagetool";
import {
  extractTextWithPositions,
  mapOffsetToPosition,
  type SpellcheckMatch,
} from "@/extensions/spellcheck-extension";

// Configuration
const CONFIG = {
  DEBOUNCE_DELAY: 2000, // 2 seconds - respect LanguageTool rate limits
  MIN_TEXT_LENGTH: 10, // Minimum text length before checking
  MAX_TEXT_LENGTH: 10000, // LanguageTool limit per request
  CACHE_TTL: 60000, // Cache results for 1 minute
  MAX_REPLACEMENTS: 5, // Maximum suggestions to show per error
};

interface UseSpellcheckOptions {
  editor: Editor | null;
  enabled?: boolean;
}

interface CacheEntry {
  matches: SpellcheckMatch[];
  timestamp: number;
}

/**
 * Convert LanguageTool match to SpellcheckMatch with mapped positions
 */
function convertMatch(
  match: LanguageToolMatch,
  posMap: number[],
  index: number,
  docSize: number
): SpellcheckMatch | null {
  const from = mapOffsetToPosition(posMap, match.offset);
  const to = mapOffsetToPosition(posMap, match.offset + match.length);

  // Validate positions are within document bounds
  if (from < 0 || to > docSize || from >= to) {
    return null;
  }

  return {
    id: `spell-${index}-${match.offset}`,
    from,
    to,
    message: match.message,
    shortMessage: match.shortMessage || match.rule.category.name,
    replacements: match.replacements
      .slice(0, CONFIG.MAX_REPLACEMENTS)
      .map((r) => r.value),
    ruleId: match.rule.id,
    category: match.rule.category.id,
  };
}

export function useSpellcheck({
  editor,
  enabled = true,
}: UseSpellcheckOptions) {
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const lastTextHashRef = useRef<string>("");

  /**
   * Clear spellcheck decorations
   */
  const clearSpellcheck = useCallback(() => {
    if (editor) {
      editor.commands.clearSpellcheck();
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
   * Check document for spelling errors
   */
  const checkDocument = useCallback(async () => {
    if (!editor || !enabled) {
      return;
    }

    // Extract text with position mapping
    const { text, posMap } = extractTextWithPositions(editor.state.doc);

    // Skip if text is too short
    if (text.trim().length < CONFIG.MIN_TEXT_LENGTH) {
      clearSpellcheck();
      return;
    }

    // Truncate if too long
    const textToCheck = text.slice(0, CONFIG.MAX_TEXT_LENGTH);

    // Check cache
    const textHash = hashText(textToCheck);

    // Skip if content hasn't changed
    if (textHash === lastTextHashRef.current) {
      return;
    }

    const cached = cacheRef.current.get(textHash);
    if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_TTL) {
      // Use cached matches (positions should still be valid if text hash matches)
      const validMatches = cached.matches.filter(
        (match) => match.from < match.to
      );
      editor.commands.setSpellcheckMatches(validMatches);
      lastTextHashRef.current = textHash;
      return;
    }

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      const response = await checkSpelling(
        textToCheck,
        "auto",
        abortControllerRef.current.signal
      );

      // Get document size for validation
      const docSize = editor.state.doc.content.size;

      // Convert API matches to SpellcheckMatches with mapped positions
      const matches = response.matches
        .map((match, index) => convertMatch(match, posMap, index, docSize))
        .filter((match): match is SpellcheckMatch => match !== null);

      // Cache results
      cacheRef.current.set(textHash, {
        matches,
        timestamp: Date.now(),
      });

      // Limit cache size
      if (cacheRef.current.size > 50) {
        const oldestKey = cacheRef.current.keys().next().value;
        if (oldestKey) {
          cacheRef.current.delete(oldestKey);
        }
      }

      // Apply matches to editor
      editor.commands.setSpellcheckMatches(matches);
      lastTextHashRef.current = textHash;

      // Log detected language for debugging
      if (response.language.detectedLanguage) {
        console.log(
          `[Spellcheck] Detected language: ${response.language.detectedLanguage.name} (${response.language.detectedLanguage.code})`
        );
      }
    } catch (error) {
      // Ignore abort errors
      if ((error as Error).name !== "AbortError") {
        console.error("[Spellcheck] Error:", error);
      }
    }
  }, [editor, enabled, clearSpellcheck]);

  /**
   * Trigger spellcheck with debouncing
   */
  const triggerCheck = useCallback(() => {
    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new debounced timer
    debounceTimerRef.current = setTimeout(() => {
      checkDocument();
    }, CONFIG.DEBOUNCE_DELAY);
  }, [checkDocument]);

  /**
   * Handle editor updates
   */
  useEffect(() => {
    if (!editor || !enabled) {
      return;
    }

    const handleUpdate = () => {
      triggerCheck();
    };

    editor.on("update", handleUpdate);

    // Initial check
    checkDocument();

    return () => {
      editor.off("update", handleUpdate);

      // Cleanup
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [editor, enabled, triggerCheck, checkDocument]);

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
    triggerCheck,
    clearSpellcheck,
  };
}
