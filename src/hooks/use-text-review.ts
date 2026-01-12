"use client";

import { useCallback, useRef } from "react";
import { Editor } from "@tiptap/react";
import {
  extractTextWithPositions,
  mapOffsetToPosition,
} from "@/extensions/spellcheck-extension";
import type {
  ReviewSuggestion,
  ReviewCategory,
} from "@/extensions/text-review-extension";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface UseTextReviewOptions {
  editor: Editor | null;
  fileId: string;
  onReviewStart?: () => void;
  onReviewComplete?: (count: number, summary: string) => void;
  onReviewError?: (error: string) => void;
}

interface ReviewResult {
  suggestions: ReviewSuggestion[];
  summary: string;
}

interface APISuggestion {
  category: string;
  type: string;
  original_text: string;
  replacement: string;
  explanation: string;
  start_offset: number;
  end_offset: number;
}

export function useTextReview({
  editor,
  fileId,
  onReviewStart,
  onReviewComplete,
  onReviewError,
}: UseTextReviewOptions) {
  const abortControllerRef = useRef<AbortController | null>(null);
  const isReviewingRef = useRef(false);

  const triggerReview = useCallback(async (): Promise<ReviewResult | null> => {
    if (!editor) {
      console.warn("[TextReview] No editor available");
      return null;
    }

    if (isReviewingRef.current) {
      console.warn("[TextReview] Review already in progress");
      return null;
    }

    // Cancel any previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    isReviewingRef.current = true;

    // Extract text with position mapping
    const { text, posMap } = extractTextWithPositions(editor.state.doc);

    if (text.trim().length < 20) {
      console.log("[TextReview] Document too short for review");
      isReviewingRef.current = false;
      return null;
    }

    // Set loading state
    editor.commands.setReviewLoading(true);
    onReviewStart?.();

    try {
      const response = await fetch(`${API_BASE}/api/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: text,
          file_id: fileId,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`Review request failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let result: { suggestions: APISuggestion[]; summary: string } | null =
        null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ") && !line.includes("[DONE]")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.result) {
                result = data.result;
              }
              if (data.error) {
                throw new Error(data.error);
              }
            } catch (e) {
              // Ignore parse errors for streaming chunks (not JSON)
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }
      }

      if (result) {
        const docSize = editor.state.doc.content.size;

        // Convert API suggestions to ReviewSuggestions with mapped positions
        const suggestions: ReviewSuggestion[] = result.suggestions
          .map((s: APISuggestion, index: number): ReviewSuggestion | null => {
            // Map text offsets to ProseMirror positions
            const from = mapOffsetToPosition(posMap, s.start_offset);
            const to = mapOffsetToPosition(posMap, s.end_offset);

            // Validate positions
            if (from >= to || to > docSize || from < 0) {
              console.warn(
                `[TextReview] Invalid position for suggestion: ${s.original_text}`,
                { from, to, docSize }
              );
              return null;
            }

            // Verify the category is valid
            const validCategories: ReviewCategory[] = [
              "correctness",
              "clarity",
              "tone",
              "engagement",
            ];
            const category = validCategories.includes(s.category as ReviewCategory)
              ? (s.category as ReviewCategory)
              : "correctness";

            return {
              id: `review-${index}-${s.start_offset}`,
              category,
              type: s.type || "general",
              from,
              to,
              originalText: s.original_text,
              replacement: s.replacement,
              explanation: s.explanation,
              status: "pending",
            };
          })
          .filter(
            (s: ReviewSuggestion | null): s is ReviewSuggestion => s !== null
          );

        // Set suggestions in editor
        editor.commands.setReviewSuggestions(suggestions, result.summary);

        const reviewResult: ReviewResult = {
          suggestions,
          summary: result.summary,
        };

        onReviewComplete?.(suggestions.length, result.summary);
        console.log(`[TextReview] Review complete: ${suggestions.length} suggestions`);

        isReviewingRef.current = false;
        return reviewResult;
      }

      isReviewingRef.current = false;
      return null;
    } catch (error) {
      isReviewingRef.current = false;

      if ((error as Error).name === "AbortError") {
        console.log("[TextReview] Review aborted");
        return null;
      }

      console.error("[TextReview] Error:", error);
      editor.commands.setReviewLoading(false);
      onReviewError?.((error as Error).message);
      return null;
    }
  }, [editor, fileId, onReviewStart, onReviewComplete, onReviewError]);

  const clearReview = useCallback(() => {
    // Cancel any in-progress request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    isReviewingRef.current = false;

    // Clear editor state
    editor?.commands.clearReview();
  }, [editor]);

  const acceptAll = useCallback(() => {
    editor?.commands.acceptAllSuggestions();
  }, [editor]);

  const dismissAll = useCallback(() => {
    editor?.commands.dismissAllSuggestions();
  }, [editor]);

  return {
    triggerReview,
    clearReview,
    acceptAll,
    dismissAll,
    isReviewing: isReviewingRef.current,
  };
}
