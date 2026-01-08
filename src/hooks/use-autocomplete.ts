"use client";

import { useState, useCallback, useRef } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { debounce } from "@/lib/utils";

export function useAutocomplete() {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const { autocompleteEnabled } = useEditorStore();

  const getSuggestion = useCallback(
    async (textBefore: string, textAfter: string, fileName: string) => {
      if (!autocompleteEnabled || textBefore.length < 10) {
        setSuggestion(null);
        return;
      }

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
          },
          body: JSON.stringify({
            text_before: textBefore,
            text_after: textAfter,
            file_name: fileName,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error("Failed to get suggestion");
        }

        const data = await response.json();
        setSuggestion(data.suggestion || null);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error("Autocomplete error:", error);
        }
        setSuggestion(null);
      } finally {
        setIsLoading(false);
      }
    },
    [autocompleteEnabled]
  );

  const debouncedGetSuggestion = useCallback(
    debounce(getSuggestion, 500),
    [getSuggestion]
  );

  const clearSuggestion = useCallback(() => {
    setSuggestion(null);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  return {
    suggestion,
    isLoading,
    getSuggestion: debouncedGetSuggestion,
    clearSuggestion,
  };
}
